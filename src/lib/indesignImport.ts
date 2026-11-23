import * as fontkit from 'fontkit';
import sharp, { type OverlayOptions } from 'sharp';
import { FIELD_LOCKS, LOCKED, PAGE_PRESETS } from './canvas';
import type { CanvasDoc, TextElement } from './types';

/**
 * A template from an InDesign "Export HTML" (Publish Online) folder. Nothing is guessed: the export says where each
 * line stands, in which font, size, colour and leading.
 * - background: the page's picture, with every frame's graphics laid on it (a frame, a badge, an icon picture);
 *   a glyph the template can't draw as text (a quote mark in a font the export left out, an icon letter) is lifted
 *   from the finished render in its colour
 * - content: each text frame a customer field, in its place; a frame whose lines change style is split (a badge's
 *   bold first lines and its light ones)
 * The export's fonts come with it (font/): the caller adds the ones it lacks, see `fontsUsed`.
 */

/** the export's files, by path inside it (any folder above publication-web-resources is dropped) */
export type ExportFiles = Map<string, Buffer>;

/** a frame: its first corner, size, turn and mirror (scale -1), in pt */
type Frame = { id: string; x: number; y: number; w: number; h: number; rot: number; sx: number; sy: number; bg?: string };

/** the box a frame's corners span once mirrored and turned about its first corner, from that corner */
function corners(f: Frame) {
  const rad = (f.rot * Math.PI) / 180;
  const pts = [
    [0, 0],
    [f.w, 0],
    [0, f.h],
    [f.w, f.h],
  ].map(([x, y]) => [x * Math.sign(f.sx || 1), y * Math.sign(f.sy || 1)]);
  const xs = pts.map(([x, y]) => x * Math.cos(rad) - y * Math.sin(rad));
  const ys = pts.map(([x, y]) => x * Math.sin(rad) + y * Math.cos(rad));
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** the part of a picture at (left, top) that lies on a W x H page, or null when none does */
async function clip(input: Buffer, left: number, top: number, W: number, H: number): Promise<OverlayOptions | null> {
  const m = await sharp(input).metadata();
  const w = m.width ?? 0;
  const h = m.height ?? 0;
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(W, left + w);
  const y1 = Math.min(H, top + h);
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === left && y0 === top && x1 === left + w && y1 === top + h) return { input, left, top };
  const part = await sharp(input).extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
  return { input: part, left: x0, top: y0 };
}
type Style = { color: string; family: string; size: number; weight: number };
type Span = { cls: string; text: string; top: number; left: number };
type Block = { frame: Frame; img?: string; dy: number; scale: number; spans: Span[] };
type Line = { text: string; x: number; y: number; width: number; style: Style };
type Text = { frame: Frame; lines: (Line | null)[]; step: number; style: Style };
type FontFile = { path: string; data: Buffer; font: fontkit.Font; css: string; family: string; weight: number };

export type ExportFont = { family: string; weight: number; file: string; data: Buffer };

const MM = 25.4 / 72;
const hebrew = /[֐-׿]/;
const letters = /[\p{L}\p{N}]/u;
const num = (s: string | undefined, d = 0) => (s === undefined ? d : parseFloat(s));
const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&');
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** "Ploni DL 1.1 AAA Medium" and its sisters are one family, Ploni, by weight */
export const appFamily = (css: string) =>
  /^ploni/i.test(css) ? 'Ploni' : css.replace(/\s+(bold|regular)$/i, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim();

/** the built-in font nearest a family the site doesn't have */
const FALLBACK: Record<string, { family: string; weight?: number }> = {
  Ploni: { family: 'Heebo' },
  'BA Franknatan': { family: 'Frank Ruhl Libre', weight: 700 },
  Haim: { family: 'Secular One', weight: 400 },
  'BA Arzey Halevanon': { family: 'Frank Ruhl Libre', weight: 900 },
};
const HEEBO = [400, 500, 700, 800];
function fallback(family: string, weight: number) {
  const f = FALLBACK[family] ?? { family: 'Heebo' };
  if (f.weight) return { family: f.family, weight: f.weight };
  return { family: f.family, weight: HEEBO.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a)) };
}

/** the export's paths from publication-web-resources down, whatever folder the archive put it in */
export function exportFiles(entries: Iterable<[string, Buffer]>): ExportFiles {
  const all = [...entries].map(([p, d]) => [p.replace(/\\/g, '/'), d] as const);
  const html = all.find(([p]) => /(^|\/)publication-web-resources\/html\/publication[^/]*\.html$/.test(p));
  if (!html) throw new ExportError('בקובץ אין ייצוא HTML של InDesign (חסרה התיקייה publication-web-resources)');
  const root = html[0].slice(0, html[0].indexOf('publication-web-resources/'));
  const out: ExportFiles = new Map();
  for (const [p, d] of all) if (p.startsWith(root) && !p.endsWith('/')) out.set(p.slice(root.length), d);
  return out;
}

export class ExportError extends Error {}

/** a page box: `<div style="…overflow:hidden…translate(x,y)…width;height;background-color:white">` */
const PAGE_BOX = /<div style="position:absolute;overflow:hidden;[^"]*?transform:translate\(([-\d.]+)px,([-\d.]+)px\);width:([\d.]+)px;height:([\d.]+)px;background-color:white">/g;

/** one page of the export: an HTML file, and which page box in it (a spread has two) */
export type PageRef = { html: string; box: number };

/** the export's pages in order: publication.html, then publication-1.html, -2… and each spread's left page first */
export function exportPages(files: ExportFiles): PageRef[] {
  const order = (p: string) => Number(/publication-(\d+)\.html$/.exec(p)?.[1] ?? 0);
  return [...files.keys()]
    .filter((p) => /^publication-web-resources\/html\/publication[^/]*\.html$/.test(p))
    .sort((a, b) => order(a) - order(b))
    .flatMap((html) => {
      const n = [...files.get(html)!.toString('utf8').matchAll(PAGE_BOX)].length;
      return Array.from({ length: Math.max(1, n) }, (_, box) => ({ html, box }));
    });
}

/** a page of the export, parsed, ready to become a template */
export class InDesignExport {
  readonly page: CanvasDoc['page'];
  private readonly pageW: number;
  private readonly pageH: number;
  private readonly rules = new Map<string, Record<string, string>>();
  /** each frame's inline background picture, read from the CSS by selector (its "data:…;base64" holds a ';') */
  private readonly backgrounds = new Map<string, string>();
  private blocks: Block[] = [];
  private readonly fonts: FontFile[] = [];
  readonly texts: Text[] = [];
  private readonly decor: Text[] = [];
  /** the finished render (Thumbnails/Share) shows the first page only */
  private readonly firstPage: boolean;

  constructor(
    private readonly files: ExportFiles,
    ref: PageRef = exportPages(files)[0] ?? { html: '', box: 0 },
  ) {
    const source = files.get(ref.html)?.toString('utf8');
    if (!source) throw new ExportError('חסר publication.html בייצוא');
    const css = files.get('publication-web-resources/css/idGeneratedStyles.css')?.toString('utf8');
    if (!css) throw new ExportError('חסר idGeneratedStyles.css בייצוא');
    this.firstPage = ref.html.endsWith('/publication.html') && ref.box === 0;

    // InDesign gives frames that look alike one rule: "#_idContainer000, #_idContainer025 { … }"
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const decl: Record<string, string> = {};
      for (const d of m[2].split(';')) {
        const at = d.indexOf(':');
        if (at > 0) decl[d.slice(0, at).trim()] = d.slice(at + 1).trim();
      }
      const bg = /background-image:url\(([^)]*)\)/.exec(m[2])?.[1];
      for (const sel of m[1].split(',').map((s) => s.trim())) {
        this.rules.set(sel, { ...this.rules.get(sel), ...decl });
        if (bg) this.backgrounds.set(sel, bg);
      }
    }

    // this page's part of the HTML: from its page box to the next
    const boxes = [...source.matchAll(PAGE_BOX)];
    const box = boxes[ref.box];
    const html = box ? source.slice(box.index, boxes[ref.box + 1]?.index ?? source.length) : source;

    const parts = html.split(/<div id="(_idContainer\d+)"/).slice(1);
    for (let i = 0; i < parts.length; i += 2) {
      const body = parts[i + 1];
      const inner = /translate\(0px,([-\d.]+)px\) rotate\(0deg\) scale\(([\d.]+)\)/.exec(body);
      const spans = [...body.matchAll(/<span id="[^"]+" class="([^"]+)" style="position:absolute;top:([-\d.]+)px;left:([-\d.]+)px;">([\s\S]*?)<\/span>/g)].map(
        (m) => ({ cls: m[1], top: num(m[2]), left: num(m[3]), text: unescape(m[4]) }),
      );
      this.blocks.push({ frame: this.frame(parts[i]), img: /<img[^>]* src="([^"]+)"/.exec(body)?.[1], dy: num(inner?.[1]), scale: num(inner?.[2], 1), spans });
    }

    this.pageW = num(box?.[3], 595.28);
    const pageH = (this.pageH = num(box?.[4], 841.89));
    // InDesign's px are pt (595.28 x 841.89 is A4); a spread's inner page can carry a pt of bleed: a size within
    // a mm of a preset is the preset
    const mm = { width_mm: Math.round(this.pageW * MM * 10) / 10, height_mm: Math.round(pageH * MM * 10) / 10 };
    const preset = PAGE_PRESETS.find((p) => Math.abs(p.width_mm - mm.width_mm) <= 1 && Math.abs(p.height_mm - mm.height_mm) <= 1);
    this.page = preset ? { width_mm: preset.width_mm, height_mm: preset.height_mm } : mm;

    for (const [p, data] of files) {
      if (!/^font\/[^/]+\.(otf|ttf)$/i.test(p)) continue;
      try {
        const font = fontkit.create(data) as fontkit.Font;
        // the site takes weights 100–900 in hundreds; a font can say 950 (an extra-black display face)
        const raw = (font as unknown as { 'OS/2'?: { usWeightClass: number } })['OS/2']?.usWeightClass ?? 400;
        const weight = Math.min(900, Math.max(100, Math.round(raw / 100) * 100));
        this.fonts.push({ path: p, data, font, css: font.familyName, family: appFamily(font.familyName), weight });
      } catch {
        // a font file that doesn't read: its texts fall back to a built-in font
      }
    }

    // a frame left on the pasteboard, beside the page, is not part of the design
    this.blocks = this.blocks.filter((b) => {
      const c = corners(b.frame);
      return b.frame.x + c.x1 > 0.5 && b.frame.y + c.y1 > 0.5 && b.frame.x + c.x0 < this.pageW - 0.5 && b.frame.y + c.y0 < this.pageH - 0.5;
    });

    // nor is a text whose letters all lie off the page (its frame can reach onto it)
    const onPage = (t: Text) =>
      t.frame.rot !== 0 ||
      (t.lines.filter(Boolean) as Line[]).some((l) => {
        const x = t.frame.x + l.x;
        const y = t.frame.y + l.y;
        return x + l.width > 0 && x < this.pageW && y + l.style.size > 0 && y < this.pageH;
      });

    for (const b of this.blocks) {
      for (const t of this.textsOf(b).filter(onPage)) {
        const all = (t.lines.filter(Boolean) as Line[]).map((l) => l.text).join('');
        // nothing to read (a quote mark in a font the export left out, an icon letter): it is drawing, not text
        if (!letters.test(all) || !this.fontFor(t.style) || /[-]/.test(all)) this.decor.push(t);
        else this.texts.push(t);
      }
    }
  }

  /** the export's fonts the texts use: the caller adds those it lacks before `build` */
  fontsUsed(): ExportFont[] {
    const used = new Set(this.texts.map((t) => this.fontFor(t.style)!.path));
    return this.fonts.filter((f) => used.has(f.path)).map((f) => ({ family: f.family, weight: f.weight, file: f.path.slice(5), data: f.data }));
  }

  private frame(id: string): Frame {
    const r = this.rules.get(`#${id}`) ?? {};
    const t = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*rotate\(([-\d.]+)deg\)(?:\s*skew\([^)]*\))?(?:\s*scale\(([-\d.]+),\s*([-\d.]+)\))?/.exec(r.transform ?? '');
    const bg = this.backgrounds.get(`#${id}`);
    let rot = num(t?.[3]);
    if (rot > 180) rot -= 360;
    return { id, x: num(t?.[1]), y: num(t?.[2]), w: num(r.width), h: num(r.height), rot, sx: num(t?.[4], 1), sy: num(t?.[5], 1), ...(bg && { bg }) };
  }

  private style(cls: string): Style {
    const r = this.rules.get(`span.${cls}`) ?? {};
    const w = r['font-weight'];
    return {
      color: (r.color ?? '#000000').toUpperCase(),
      family: (r['font-family'] ?? '').split(',')[0].replace(/"/g, '').trim(),
      size: num(r['font-size']),
      weight: w === 'bold' ? 700 : w === 'normal' || !w ? 400 : num(w),
    };
  }

  private fontFor(s: Style) {
    return this.fonts.find((f) => f.css === s.family) ?? null;
  }

  /** the line's width in pt in its own font, or an estimate when the export left the font out */
  private measure(text: string, s: Style) {
    const f = this.fontFor(s)?.font;
    if (!f) return text.length * s.size * 0.5;
    return (f.layout(text).positions.reduce((a, p) => a + p.xAdvance, 0) / f.unitsPerEm) * s.size;
  }

  private isPage(b: Block) {
    // the picture that covers the page (a spread's inner page may start a pt before its edge)
    const f = b.frame;
    return !!b.img && !f.rot && f.x <= 1 && f.y <= 1 && f.x + f.w >= this.pageW - 1 && f.y + f.h >= this.pageH - 1;
  }

  /** a frame's lines, top to bottom, in reading order; an empty line where the leading skips one */
  private linesOf(b: Block): { lines: (Line | null)[]; step: number } {
    const byTop = new Map<number, Span[]>();
    for (const s of b.spans) {
      // a span of spaces alone is no line (it only skews the leading)
      if (!s.text.trim()) continue;
      const k = Math.round(s.top * 100);
      byTop.set(k, [...(byTop.get(k) ?? []), s]);
    }
    const tops = [...byTop.keys()].sort((a, c) => a - c);
    // the leading is the gap most lines keep (a gap of two is a blank line between)
    const gaps = tops.slice(1).map((t, i) => Math.round(t - tops[i]) / 100);
    // lines closer than 60% of the letters' size overlap: such a gap is a superscript or a stray span, not the leading
    const em = Math.max(0, ...b.spans.filter((s) => s.text.trim()).map((s) => this.style(s.cls).size));
    const real = gaps.filter((g) => g >= em * 0.6);
    const tally = new Map<number, number>();
    for (const g of real.length ? real : gaps) tally.set(g, (tally.get(g) ?? 0) + 1);
    const step = gaps.length ? [...tally].sort((a, c) => c[1] - a[1] || a[0] - c[0])[0][0] : 0;
    const lines: (Line | null)[] = [];
    tops.forEach((k, i) => {
      if (i && step) for (let n = Math.min(4, Math.round((k - tops[i - 1]) / 100 / step)); n > 1; n--) lines.push(null);
      const spans = byTop.get(k)!;
      // the export cuts a right-to-left line where the direction changes and places the pieces as seen:
      // read right to left, unless there is no Hebrew in it
      const rtl = spans.some((s) => hebrew.test(s.text));
      spans.sort((a, c) => (rtl ? c.left - a.left : a.left - c.left));
      // the line's style is the one most of its letters take (a phone number's dots are another colour)
      const count = new Map<string, number>();
      for (const s of spans) count.set(s.cls, (count.get(s.cls) ?? 0) + s.text.replace(/\s/g, '').length);
      const st = this.style([...count].sort((a, c) => c[1] - a[1])[0][0]);
      // span places and font sizes are in the frame's units, drawn at `s`
      const s = b.scale;
      const left = Math.min(...spans.map((p) => p.left)) * s;
      const right = Math.max(...spans.map((p) => (p.left + this.measure(p.text, this.style(p.cls))) * s));
      const text = spans.map((p) => p.text).join('').trim();
      lines.push({ text, x: left, y: b.dy + (k / 100) * s, width: right - left, style: { ...st, size: st.size * s } });
    });
    return { lines, step: step * b.scale };
  }

  /**
   * A frame set in columns (two donors side by side) is a frame per column: the spans' runs across the frame,
   * merged where they touch, leave more than an em between columns.
   */
  private columnsOf(b: Block): Block[] {
    const runs = b.spans
      .filter((s) => s.text.trim())
      .map((s) => ({ s, a: s.left, z: s.left + this.measure(s.text, this.style(s.cls)), em: this.style(s.cls).size }))
      .sort((p, q) => p.a - q.a);
    const cols: { z: number; spans: Span[] }[] = [];
    for (const r of runs) {
      const last = cols[cols.length - 1];
      if (last && r.a <= last.z + r.em) {
        last.z = Math.max(last.z, r.z);
        last.spans.push(r.s);
      } else cols.push({ z: r.z, spans: [r.s] });
    }
    return cols.length > 1 ? cols.map((c) => ({ ...b, spans: c.spans })) : [b];
  }

  /** a frame's lines, split into columns, and where the style changes from one line to the next */
  private textsOf(frame: Block): Text[] {
    return this.columnsOf(frame).flatMap((b) => this.runsOf(b));
  }

  private runsOf(b: Block): Text[] {
    const { lines, step } = this.linesOf(b);
    const out: Text[] = [];
    let cur: (Line | null)[] = [];
    const key = (l: Line) => `${l.style.family}|${l.style.size}|${l.style.color}|${l.style.weight}`;
    const flush = () => {
      while (cur.length && !cur[cur.length - 1]) cur.pop();
      const first = cur.find(Boolean) as Line | undefined;
      if (first) out.push({ frame: b.frame, lines: cur, step, style: first.style });
      cur = [];
    };
    for (const l of lines) {
      const last = [...cur].reverse().find(Boolean) as Line | undefined;
      if (l && last && key(l) !== key(last)) flush();
      if (l || cur.length) cur.push(l);
    }
    flush();
    return out;
  }

  /** an image the HTML points at (relative to html/) or carries inline */
  private picture(src: string): Buffer {
    const m = /^data:image\/\w+;base64,(.*)$/.exec(src);
    if (m) return Buffer.from(m[1], 'base64');
    const rel = src.replace(/^['"]|['"]$/g, '').replace(/^\.\.\//, '');
    const data = this.files.get(`publication-web-resources/${rel}`);
    if (!data) throw new ExportError(`חסרה בייצוא התמונה ${rel}`);
    return data;
  }

  /** a glyph lifted from the finished render: the pixels of its colour inside its box, everything else clear */
  private async lift(render: Buffer, rw: number, rh: number, box: { x: number; y: number; w: number; h: number }, color: string, scale: number) {
    const k = rw / this.pageW;
    const left = Math.max(0, Math.round(box.x * k));
    const top = Math.max(0, Math.round(box.y * k));
    const width = Math.min(rw - left, Math.round(box.w * k));
    const height = Math.min(rh - top, Math.round(box.h * k));
    if (width < 1 || height < 1) return null;
    const { data } = await sharp(render).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [cr, cg, cb] = rgb(color);
    const rgba = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      const d = Math.hypot(data[p * 3] - cr, data[p * 3 + 1] - cg, data[p * 3 + 2] - cb);
      rgba.set([cr, cg, cb, Math.round(255 * Math.max(0, Math.min(1, 1 - (d - 40) / 110)))], p * 4);
    }
    const input = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .resize(Math.max(1, Math.round(box.w * scale)), Math.max(1, Math.round(box.h * scale)))
      .png()
      .toBuffer();
    return { input, left: Math.round(box.x * scale), top: Math.round(box.y * scale) };
  }

  /** the page's picture with every frame's graphics on it, as JPEG */
  async background(): Promise<{ data: Buffer; width: number; height: number }> {
    // the page's picture, or a white page 150 dpi wide when the design is all frames
    const base = this.blocks.find((b) => this.isPage(b));
    const pic = base
      ? this.picture(base.img!)
      : await sharp({ create: { width: Math.round((this.pageW / 72) * 150), height: Math.round((this.pageH / 72) * 150), channels: 3, background: '#FFFFFF' } }).png().toBuffer();
    const { width: W = 0, height: H = 0 } = await sharp(pic).metadata();
    const scale = W / this.pageW;
    const layers: OverlayOptions[] = [];
    for (const b of this.blocks) {
      if (b === base) continue;
      for (const src of [b.frame.bg, b.img]) {
        if (!src) continue;
        const w = Math.max(1, Math.round(b.frame.w * scale));
        const h = Math.max(1, Math.round(b.frame.h * scale));
        // CSS mirrors (scale -1) and turns the frame about its first corner; sharp does the same to the picture and
        // then sits it in the box its turned corners span, which is where CSS puts it
        let img = sharp(this.picture(src)).resize(w, h, { fit: 'fill' });
        if (b.frame.sy < 0) img = img.flip();
        if (b.frame.sx < 0) img = img.flop();
        let input = await img.png().toBuffer();
        if (b.frame.rot) input = await sharp(input).rotate(b.frame.rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        const box = corners(b.frame);
        const layer = await clip(input, Math.round((b.frame.x + box.x0) * scale), Math.round((b.frame.y + box.y0) * scale), W, H);
        if (layer) layers.push(layer);
      }
    }
    const render = this.files.get('publication-web-resources/Thumbnails/Share/share.png');
    if (render && this.firstPage && this.decor.length) {
      const { width: RW = 0, height: RH = 0 } = await sharp(render).metadata();
      for (const t of this.decor) {
        for (const l of t.lines) {
          if (!l) continue;
          // roomy above and below (a quote mark sits high), tight to the sides (a phone number beside its icon stays text)
          const side = l.style.size * 0.06;
          const pad = l.style.size * 0.25;
          const box = { x: t.frame.x + l.x - side, y: t.frame.y + l.y - pad, w: Math.max(l.width, l.style.size * 0.5) + 2 * side, h: l.style.size + 2 * pad };
          const glyph = await this.lift(render, RW, RH, box, l.style.color, scale);
          if (glyph) layers.push(glyph);
        }
      }
    }
    const data = await sharp(pic).flatten({ background: '#FFFFFF' }).composite(layers).jpeg({ quality: 92 }).toBuffer();
    const m = await sharp(data).metadata();
    return { data, width: m.width ?? 0, height: m.height ?? 0 };
  }

  /**
   * The template's card. `available` says which "family|weight" the site has (after adding the export's fonts);
   * a text in another falls back to the nearest built-in font.
   */
  build(opts: { assetId: string; newId: () => string; available: (family: string, weight: number) => boolean }) {
    const report: string[] = [];
    const seen = new Set<string>();
    const content: TextElement[] = this.texts.map((t) => {
      const lines = t.lines.filter(Boolean) as Line[];
      const st = t.style;
      // within what the editor draws (0.5–3 times the size)
      const lh = t.step && t.lines.length > 1 ? Math.min(3, Math.max(0.5, Math.round((t.step / st.size) * 1000) / 1000)) : 1.25;
      const minX = Math.min(...lines.map((l) => l.x));
      const maxX = Math.max(...lines.map((l) => l.x + l.width));
      const align = alignOf(lines, t.frame.w);
      // the box: the lines' run with a little room for a longer word, within the frame where they fill it
      const room = Math.max(4, st.size * 0.6);
      const x0 = Math.max(0, minX - room);
      const x1 = Math.min(Math.max(t.frame.w, maxX), maxX + room);
      // CSS puts the letters in the middle of each line's height: the box starts half the extra leading above
      const y0 = lines[0].y - ((lh - 1) / 2) * st.size;
      // the box turns about its first corner, as the frame does
      const rad = (t.frame.rot * Math.PI) / 180;
      const px = t.frame.x + x0 * Math.cos(rad) - y0 * Math.sin(rad);
      const py = t.frame.y + x0 * Math.sin(rad) + y0 * Math.cos(rad);
      const own = this.fontFor(st)!;
      const have = opts.available(own.family, own.weight);
      const font = have ? { family: own.family, weight: own.weight } : fallback(own.family, own.weight);
      const text = t.lines.map((l) => l?.text ?? '').join('\n');
      const size_pt = Math.round(st.size * 100) / 100;
      const name = label(text, seen);
      report.push(`${name}: ${font.family} ${font.weight}, ${size_pt}pt${have ? '' : ` (במקום ${own.family})`}`);
      return {
        id: opts.newId(),
        type: 'text',
        x_mm: round(px * MM),
        y_mm: round(py * MM),
        w_mm: round((x1 - x0) * MM),
        rotation: t.frame.rot,
        text,
        align,
        locks: FIELD_LOCKS,
        field: { label: name },
        fit: 'shrink',
        font: { family: font.family, weight: font.weight, size_pt, color: st.color, ...(lh !== 1.25 && { line_height: lh }) },
        design_color: st.color,
        design_size: size_pt,
      };
    });
    const canvas: CanvasDoc = {
      schema_version: 2,
      page: this.page,
      layers: {
        background: { fill: { type: 'solid', color: '#FFFFFF' }, image: { asset_id: opts.assetId, fit: 'cover' }, locks: LOCKED },
        content,
        overlay: [],
      },
    };
    return { canvas, report, glyphs: this.decor.length };
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

/** right, centre or left: whichever edge the lines keep */
function alignOf(lines: Line[], frameW: number): TextElement['align'] {
  if (lines.length < 2) {
    const l = lines[0];
    if (frameW - l.width < 2) return 'center';
    const fromLeft = l.x;
    const fromRight = frameW - (l.x + l.width);
    if (Math.abs(fromLeft - fromRight) < 3) return 'center';
    return fromLeft < fromRight ? 'left' : 'right';
  }
  const spread = (f: (l: Line) => number) => Math.max(...lines.map(f)) - Math.min(...lines.map(f));
  const r = spread((l) => l.x + l.width);
  const c = spread((l) => l.x + l.width / 2);
  const lft = spread((l) => l.x);
  // the export's fonts measure a little wider than InDesign set them: within a few pt, Hebrew is set to the right
  const slack = hebrew.test(lines.map((l) => l.text).join('')) ? 3 : 0;
  return r <= c + slack && r <= lft + slack ? 'right' : c <= lft ? 'center' : 'left';
}

/** a field's name: its first words */
function label(text: string, seen: Set<string>) {
  let l = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ').replace(/[|:,.!–-]+$/, '').trim() || 'טקסט';
  l = l.slice(0, 40);
  while (seen.has(l)) l += ' ·';
  seen.add(l);
  return l;
}
