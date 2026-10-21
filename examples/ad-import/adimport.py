"""Turns a flat ad image into an editable template, driven by a spec.json per ad.

    python adimport.py build  ads/<name>   # source.jpg + spec.json -> background.jpg, canvas.json, preview.png
    python adimport.py import ads/<name>   # adds a test category + published template to data/db.json

All coordinates in spec.json are pixels of source.jpg. See README.md for the spec format.
"""
import argparse, base64, datetime, io, json, os, random, shutil, urllib.request, uuid
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
PT = 25.4 / 72   # mm per pt
LINE = 1.25      # Konva lineHeight used by the editor

# the Google fonts the app loads (src/lib/canvas.ts); downloaded on first use, not committed
FONT_URLS = {
    'Secular One': 'https://github.com/google/fonts/raw/main/ofl/secularone/SecularOne-Regular.ttf',
    'Heebo': 'https://github.com/google/fonts/raw/main/ofl/heebo/Heebo%5Bwght%5D.ttf',
    'Frank Ruhl Libre': 'https://github.com/google/fonts/raw/main/ofl/frankruhllibre/FrankRuhlLibre%5Bwght%5D.ttf',
    'Assistant': 'https://github.com/google/fonts/raw/main/ofl/assistant/Assistant%5Bwght%5D.ttf',
}


def font_file(family):
    path = os.path.join(HERE, 'fonts', family.replace(' ', '') + '.ttf')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(FONT_URLS[family], path)
    return path


def pil_font(family, weight, size):
    f = ImageFont.truetype(font_file(family), size)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass  # static font (Secular One): one weight only
    return f


def measure(text, family, weight):
    """ink width/height of `text` per 1px of font size"""
    x0, y0, x1, y1 = pil_font(family, weight, 200).getbbox(text)
    return (x1 - x0) / 200, (y1 - y0) / 200


# ---------- reading the source image ----------

def ink(gray, box, t=22):
    """mask of pixels in `box` that stand out from the local background (median of the area)"""
    x0, y0, x1, y1 = box
    reg = gray[y0:y1, x0:x1]
    k = 101 if min(reg.shape) > 101 else (min(reg.shape) // 2) * 2 - 1
    bg = cv2.medianBlur(np.clip(reg, 0, 255).astype(np.uint8), k).astype(np.int16)
    diff = np.abs(reg - bg)
    return diff > t, diff


def tighten(gray, box, pad=4, grow=80, gap=16):
    """fit a rough box (horizontal text) to the text's actual ink: shrink it, and extend it along the
    line while more letters follow (a gap wider than `gap` px, more than a word space, ends the line)"""
    x0, y0, x1, y1 = box
    W = gray.shape[1]
    b = [max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(gray.shape[0], y1 + pad)]
    m, _ = ink(gray, b)
    rows = np.where(m.sum(1) >= 2)[0]
    if not len(rows):
        return box
    ty0, ty1 = b[1] + int(rows[0]), b[1] + int(rows[-1]) + 1
    sx0, sx1 = max(0, x0 - grow), min(W, x1 + grow)
    m, _ = ink(gray, (sx0, ty0, sx1, ty1))
    on = m.sum(0) >= 2
    inner = np.where(on[x0 - sx0:x1 - sx0])[0]
    if not len(inner):
        return box
    lo, hi = x0 - sx0 + int(inner[0]), x0 - sx0 + int(inner[-1])
    i = lo - 1
    while i >= 0 and lo - i <= gap:  # walk left; any ink within `gap` px continues the line
        if on[i]:
            lo = i
        i -= 1
    i = hi + 1
    while i < len(on) and i - hi <= gap:
        if on[i]:
            hi = i
        i += 1
    return [sx0 + lo, ty0, sx0 + hi + 1, ty1]


def sample_color(img, gray, box):
    """text colour: median of the pixels that differ most from the background (skips anti-aliasing)"""
    m, diff = ink(gray, box)
    if m.sum() < 10:
        return '#000000'
    strong = diff >= np.percentile(diff[m], 60)
    x0, y0, x1, y1 = box
    r, g, b = np.median(img[y0:y1, x0:x1][m & strong], axis=0)[::-1]  # BGR -> RGB
    return '#%02X%02X%02X' % (int(r), int(g), int(b))


def inside(box, rect):
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return rect[0] <= cx <= rect[2] and rect[1] <= cy <= rect[3]


# ---------- steps ----------

def clean(img, gray, spec, boxes):
    """Erases text from the background. Text on a rect is left: the rect covers it in the editor."""
    regions = spec.get('erase')
    if regions is None:  # default: every text that is not on a solid box, with some margin
        # union of the rough and the tightened box: faint letter edges can fall outside the tight one
        both = [[min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
                for a, b in zip((t['box'] for t in spec['texts']), boxes)]
        regions = [[b[0] - 8, b[1] - 8, b[2] + 8, b[3] + 8] for b in both
                   if not any(inside(b, r['box']) for r in spec.get('rects', []))]
    mask = np.zeros(gray.shape, np.uint8)
    for x0, y0, x1, y1 in regions:
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(gray.shape[1], x1), min(gray.shape[0], y1)
        m, _ = ink(gray, (x0, y0, x1, y1))
        m = cv2.dilate(m.astype(np.uint8) * 255, np.ones((7, 7), np.uint8))
        mask[y0:y1, x0:x1] = np.maximum(mask[y0:y1, x0:x1], m)
    out = cv2.inpaint(img, mask, 9, cv2.INPAINT_TELEA)

    # text covering most of its area (e.g. huge titles) defeats the median trick; on a smooth
    # gradient fill each column by blending the clean rows above and below instead
    out = out.astype(np.float32)
    rng = np.random.default_rng(1)
    for x0, x1, ya, yb in spec.get('fill_columns', []):
        top = out[ya - 4:ya].mean(axis=0)[x0:x1]
        bot = out[yb:yb + 4].mean(axis=0)[x0:x1]
        t = np.linspace(0, 1, yb - ya)[:, None, None]
        out[ya:yb, x0:x1] = top[None] * (1 - t) + bot[None] * t
        out[ya:yb, x0:x1] += rng.normal(0, 1.5, out[ya:yb, x0:x1].shape)  # grain, so it does not look flat
    return np.clip(out, 0, 255).astype(np.uint8)


def to_canvas(spec, img, gray, boxes, bg_asset_id):
    h_px, w_px = gray.shape
    page = spec['page']
    s = page['width_mm'] / w_px  # mm per source px
    mm = lambda v: round(v * s, 2)
    els = [dict(id=str(uuid.uuid4()), type='image', x_mm=0, y_mm=0, w_mm=page['width_mm'], h_mm=page['height_mm'],
                rotation=0, z=0, asset_id=bg_asset_id, label='רקע')]
    for r in spec.get('rects', []):
        x0, y0, x1, y1 = r['box']
        els.append(dict(id=str(uuid.uuid4()), type='rect', x_mm=mm(x0), y_mm=mm(y0), w_mm=mm(x1 - x0),
                        h_mm=mm(y1 - y0), rotation=0, z=len(els), fill=r['fill']))
    for t, (x0, y0, x1, y1) in zip(spec['texts'], boxes):
        rot = t.get('rotation', 0)
        fam, wt = t.get('font', 'Heebo'), t.get('weight', 400)
        along, across = ((y1 - y0), (x1 - x0)) if rot else ((x1 - x0), (y1 - y0))  # px along / across the line
        wr, hr = measure(t['text'], fam, wt)
        fs_px = min(along / wr, across / hr)  # font size (source px) that fits both ways
        box_w = along * 1.15 + 10             # slack so a slightly wider browser font never wraps
        box_h = fs_px * LINE
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        # Konva rotates around the top-left corner
        if rot == 90:     # reads bottom to top: the box runs down, its height goes left
            bx, by = cx + box_h / 2, cy - box_w / 2
        elif rot == -90:  # reads top to bottom: the box runs up, its height goes right
            bx, by = cx - box_h / 2, cy + box_w / 2
        else:
            bx, by = cx - box_w / 2, cy - box_h / 2
        color = t.get('color') or sample_color(img, gray, (x0, y0, x1, y1))
        els.append(dict(id=str(uuid.uuid4()), type='text', x_mm=mm(bx), y_mm=mm(by), w_mm=mm(box_w), rotation=rot,
                        z=len(els), text=t['text'], align='center', editable=True, label=t.get('label', 'טקסט'),
                        font=dict(family=fam, weight=wt, size_pt=round(fs_px * s / PT, 1), color=color)))
    return dict(schema_version=1, page=page, elements=els)


def preview(doc, background):
    """rough render (no bidi shaping, so Hebrew is reversed by hand) just to check sizes and positions"""
    im = background.convert('RGB')
    k = im.width / doc['page']['width_mm']
    d = ImageDraw.Draw(im)
    for e in doc['elements']:
        if e['type'] == 'rect':
            d.rectangle([e['x_mm'] * k, e['y_mm'] * k, (e['x_mm'] + e['w_mm']) * k, (e['y_mm'] + e['h_mm']) * k], fill=e['fill'])
        if e['type'] != 'text':
            continue
        fs = e['font']['size_pt'] * PT * k
        f = pil_font(e['font']['family'], e['font']['weight'], max(1, round(fs)))
        w, h = e['w_mm'] * k, fs * LINE
        layer = Image.new('RGBA', (int(w), int(h)), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((w / 2, h / 2), e['text'][::-1], font=f, fill=e['font']['color'], anchor='mm')
        if e['rotation'] == 90:
            layer = layer.rotate(-90, expand=True)
            im.paste(layer, (int(e['x_mm'] * k - h), int(e['y_mm'] * k)), layer)
        elif e['rotation'] == -90:
            layer = layer.rotate(90, expand=True)
            im.paste(layer, (int(e['x_mm'] * k), int(e['y_mm'] * k - w)), layer)
        else:
            im.paste(layer, (int(e['x_mm'] * k), int(e['y_mm'] * k)), layer)
    return im


def build(folder):
    spec = json.load(open(os.path.join(folder, 'spec.json'), encoding='utf8'))
    img = cv2.imread(os.path.join(folder, 'source.jpg'))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)
    boxes = [tighten(gray, t['box']) if spec.get('tighten') else t['box'] for t in spec['texts']]

    bg = clean(img, gray, spec, boxes)
    cv2.imwrite(os.path.join(folder, 'background.jpg'), bg, [cv2.IMWRITE_JPEG_QUALITY, 92])
    # canvas.json keeps the placeholder asset id "BACKGROUND"; `import` swaps in the real one
    doc = to_canvas(spec, img, gray, boxes, 'BACKGROUND')
    with open(os.path.join(folder, 'canvas.json'), 'w', encoding='utf8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    prev = preview(doc, Image.open(os.path.join(folder, 'background.jpg')))
    prev.save(os.path.join(folder, 'preview.png'))
    # side by side with the original, for checking (not committed)
    src = Image.open(os.path.join(folder, 'source.jpg')).convert('RGB')
    side = Image.new('RGB', (src.width * 2 + 20, src.height), 'white')
    side.paste(src, (0, 0))
    side.paste(prev, (src.width + 20, 0))
    side.resize((side.width // 2, side.height // 2)).save(os.path.join(folder, 'compare.png'))
    print('built', folder, '-', len(doc['elements']), 'elements')


def import_ad(folder):
    spec = json.load(open(os.path.join(folder, 'spec.json'), encoding='utf8'))
    data = os.path.join(REPO, 'data')
    db_path = os.path.join(data, 'db.json')
    uploads = os.path.join(data, 'uploads')
    os.makedirs(uploads, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    empty = {'categories': [], 'images': [], 'projects': [], 'users': [], 'sessions': []}
    db = {**empty, **json.load(open(db_path, encoding='utf8'))} if os.path.exists(db_path) else empty

    cat = dict(id=str(uuid.uuid4()), name=spec.get('category') or 'מודעות - בדיקה ' + str(random.randint(100, 999)),
               description='קטגוריית בדיקה לייבוא מודעות', createdAt=now)
    asset_id = str(uuid.uuid4())
    shutil.copy(os.path.join(folder, 'background.jpg'), os.path.join(uploads, asset_id + '.jpg'))
    w, h = Image.open(os.path.join(folder, 'background.jpg')).size
    asset = dict(id=asset_id, categoryId=cat['id'], name=spec.get('background_name', 'רקע'), file=asset_id + '.jpg',
                 width=w, height=h, createdAt=now)

    doc = json.load(open(os.path.join(folder, 'canvas.json'), encoding='utf8'))
    for e in doc['elements']:
        e['id'] = str(uuid.uuid4())  # fresh ids, so an ad can be imported more than once
        if e['type'] == 'image' and e['asset_id'] == 'BACKGROUND':
            e['asset_id'] = asset_id

    # gallery thumbnail; the editor replaces it with a real render on the first save
    buf = io.BytesIO()
    prev = Image.open(os.path.join(folder, 'preview.png')).convert('RGB')
    prev.resize((600, round(600 * prev.height / prev.width))).save(buf, 'JPEG', quality=70)
    owner = next((p.get('ownerId', '') for p in db['projects'] if p.get('kind') == 'template'), '')
    project = dict(id=str(uuid.uuid4()), kind='template', ownerId=owner, status='published', name=spec['name'],
                   canvas=doc, thumbnail='data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(),
                   createdAt=now, updatedAt=now)

    db['categories'].append(cat)
    db['images'].append(asset)
    db['projects'].append(project)
    os.makedirs(data, exist_ok=True)
    tmp = db_path + '.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, db_path)
    print('category:', cat['name'])
    print('template: /editor/' + project['id'])


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('command', choices=['build', 'import'])
    p.add_argument('folder', help='an ad folder, e.g. ads/streimel')
    a = p.parse_args()
    folder = a.folder if os.path.isabs(a.folder) else os.path.join(os.getcwd(), a.folder)
    if not os.path.isdir(folder):
        folder = os.path.join(HERE, a.folder)
    (build if a.command == 'build' else import_ad)(folder)
