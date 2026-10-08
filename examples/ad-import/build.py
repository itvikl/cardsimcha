"""Turn the measured ad layout (source pixels) into a CanvasDoc (mm) + a preview."""
import json, os, urllib.request, uuid
from PIL import Image, ImageDraw, ImageFont

SRC_W, SRC_H = 1131, 1600
PAGE_W, PAGE_H = 210, 297
S = PAGE_W / SRC_W                 # mm per source px
PT = 25.4 / 72                     # mm per pt
LINE = 1.25                        # Konva lineHeight used by the editor
HERE = os.path.dirname(os.path.abspath(__file__))
# the same Google fonts the app loads; downloaded on first run (not committed)
FONT_URLS = {
    'Secular One': 'https://github.com/google/fonts/raw/main/ofl/secularone/SecularOne-Regular.ttf',
    'Heebo': 'https://github.com/google/fonts/raw/main/ofl/heebo/Heebo%5Bwght%5D.ttf',
}

def font_file(family):
    path = os.path.join(HERE, 'fonts', family.replace(' ', '') + '.ttf')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(FONT_URLS[family], path)
    return path

def pil_font(family, weight, size):
    f = ImageFont.truetype(font_file(family), size)
    if family == 'Heebo':
        f.set_variation_by_axes([weight])
    return f

def measure(text, family, weight):
    """ink width/height of `text` per 1px of font size"""
    f = pil_font(family, weight, 200)
    x0, y0, x1, y1 = f.getbbox(text)
    return (x1 - x0) / 200, (y1 - y0) / 200

rects = [  # x0,y0,x1,y1,fill
    (204, 0, 413, 719, '#F6AA4A'),
    (68, 840, 417, 951, '#FAFBFF'),
    (68, 965, 417, 1072, '#FAFBFF'),
    (68, 1088, 417, 1197, '#F6AA4A'),
    (445, 1320, 1016, 1361, '#F6AA4A'),
]
DARK, LIGHT, WHITE = '#45301F', '#F7B868', '#FFFFFF'
texts = [  # text, ink box (x0,y0,x1,y1), rotation, family, weight, color, label
    ('בית שמש', (235, 60, 375, 598), 90, 'Secular One', 400, DARK, 'עיר (כותרת)'),
    ('יום ראשון', (270, 607, 400, 648), 0, 'Secular One', 400, DARK, 'יום (בכותרת)'),
    ('אולם קוסוב ויזניץ', (210, 655, 402, 700), 0, 'Secular One', 400, DARK, 'אולם (בכותרת)'),
    ('ורוד השטריימלך', (72, 100, 190, 720), 90, 'Secular One', 400, LIGHT, 'שם העסק'),
    ('ביום ראשון זה קורה', (578, 188, 921, 222), 0, 'Secular One', 400, LIGHT, 'שורת פתיחה'),
    ('לרגל השקת הקולקציה החדשה', (92, 735, 410, 770), 0, 'Heebo', 400, LIGHT, 'הסבר שורה 1'),
    ('אנחנו מרוקנים את המדפים ופותחים', (68, 775, 415, 815), 0, 'Heebo', 400, WHITE, 'הסבר שורה 2'),
    ('במחירים', (85, 852, 410, 940), 0, 'Secular One', 400, DARK, 'מבצע שורה 1'),
    ('נדירים', (120, 975, 360, 1062), 0, 'Secular One', 400, DARK, 'מבצע שורה 2'),
    ('ביותר', (150, 1100, 335, 1187), 0, 'Secular One', 400, DARK, 'מבצע שורה 3'),
    ('5 שעות של מחירים מטורפים בבית שמש', (463, 1327, 995, 1355), 0, 'Secular One', 400, DARK, 'פס כתום'),
    ('מגוון שטריימלעך מפוארים ואיכותיים', (580, 1378, 905, 1402), 0, 'Heebo', 400, LIGHT, 'תיאור שורה 1'),
    ('במבחר דגמים וסגנונות בשיטת שלם וקח', (518, 1405, 930, 1428), 0, 'Heebo', 400, LIGHT, 'תיאור שורה 2'),
    ('יום ראשון', (870, 1450, 1043, 1505), 0, 'Secular One', 400, WHITE, 'יום'),
    ('כ״ד אלול', (660, 1450, 862, 1505), 0, 'Secular One', 400, LIGHT, 'תאריך'),
    ('18:00 - 23:00', (413, 1450, 655, 1505), 0, 'Secular One', 400, WHITE, 'שעות'),
    ('אולם קוסוב ויזניץ', (755, 1520, 1050, 1555), 0, 'Secular One', 400, LIGHT, 'אולם'),
    ('רח׳ האדמו״ר מבעלזא 4', (413, 1520, 745, 1555), 0, 'Secular One', 400, WHITE, 'כתובת'),
]

def build(bg_asset_id):
    els = []
    z = 0
    els.append(dict(id=str(uuid.uuid4()), type='image', x_mm=0, y_mm=0, w_mm=PAGE_W, h_mm=PAGE_H,
                    rotation=0, z=z, asset_id=bg_asset_id, label='רקע'))
    for x0, y0, x1, y1, fill in rects:
        z += 1
        els.append(dict(id=str(uuid.uuid4()), type='rect', x_mm=round(x0*S, 2), y_mm=round(y0*S, 2),
                        w_mm=round((x1-x0)*S, 2), h_mm=round((y1-y0)*S, 2), rotation=0, z=z, fill=fill))
    for text, (x0, y0, x1, y1), rot, fam, wt, color, label in texts:
        z += 1
        along, across = ((y1-y0), (x1-x0)) if rot else ((x1-x0), (y1-y0))   # px along / across the line
        wr, hr = measure(text, fam, wt)
        fs_px = min(along / wr, across / hr)          # font size (source px) that fits both ways
        box_w = along * 1.15 + 10                     # slack so a slightly wider browser font never wraps
        box_h = fs_px * LINE
        cx, cy = (x0+x1)/2, (y0+y1)/2
        if rot == 90:   # Konva rotates around the top-left corner: box runs down, its height goes left
            bx, by = cx + box_h/2, cy - box_w/2
        else:
            bx, by = cx - box_w/2, cy - box_h/2
        els.append(dict(id=str(uuid.uuid4()), type='text', x_mm=round(bx*S, 2), y_mm=round(by*S, 2),
                        w_mm=round(box_w*S, 2), rotation=rot, z=z, text=text, align='center',
                        editable=True, label=label,
                        font=dict(family=fam, weight=wt, size_pt=round(fs_px*S/PT, 1), color=color)))
    return dict(schema_version=1, page=dict(width_mm=PAGE_W, height_mm=PAGE_H, background='#2A1D14'), elements=els)

def preview(doc, out):
    """rough render (no bidi shaping, so Hebrew is reversed by hand) just to check sizes/positions"""
    k = SRC_W / PAGE_W
    im = Image.open(os.path.join(HERE, 'background.jpg')).convert('RGB')
    d = ImageDraw.Draw(im)
    for e in doc['elements']:
        if e['type'] == 'rect':
            d.rectangle([e['x_mm']*k, e['y_mm']*k, (e['x_mm']+e['w_mm'])*k, (e['y_mm']+e['h_mm'])*k], fill=e['fill'])
        if e['type'] != 'text':
            continue
        fs = e['font']['size_pt'] * PT * k
        f = pil_font(e['font']['family'], e['font']['weight'], max(1, round(fs)))
        w, h = e['w_mm']*k, fs*LINE
        layer = Image.new('RGBA', (int(w), int(h)), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((w/2, h/2), e['text'][::-1], font=f, fill=e['font']['color'], anchor='mm')
        if e['rotation'] == 90:
            layer = layer.rotate(-90, expand=True)
            im.paste(layer, (int(e['x_mm']*k - h), int(e['y_mm']*k)), layer)
        else:
            im.paste(layer, (int(e['x_mm']*k), int(e['y_mm']*k)), layer)
    im.save(out)

if __name__ == '__main__':
    # canvas.json keeps the placeholder asset id "BACKGROUND"; import.py swaps in the real one
    doc = build('BACKGROUND')
    with open(os.path.join(HERE, 'canvas.json'), 'w', encoding='utf8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    preview(doc, os.path.join(HERE, 'preview.png'))
