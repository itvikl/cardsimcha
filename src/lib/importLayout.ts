import type { ReadText } from './agent/importDesign';
import { FIELD_LOCKS } from './canvas';
import type { Refined } from './importClean';
import type { CanvasDoc, TextElement } from './types';

const PT_TO_MM = 25.4 / 72;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
/** two colours closer than this don't read one on the other */
const UNREADABLE = 70;

/**
 * A text's colour: the one sampled from its ink, unless that is the colour it stands on (thin letters give few ink
 * pixels, and the sample can catch the circle under them); then the model's, and if that doesn't read either, dark
 * or light by what is under it.
 */
function readable(sampled: string | null, model: string, under: string | null) {
  if (!under) return sampled ?? model;
  if (sampled && distance(sampled, under) >= UNREADABLE) return sampled;
  if (distance(model, under) >= UNREADABLE) return model;
  const [r, g, b] = rgb(under);
  return r * 0.3 + g * 0.59 + b * 0.11 > 140 ? '#2B1D10' : '#FFFFFF';
}

/**
 * The words in `n` lines of about equal length, in their order: the picture breaks a block the model wrote as fewer
 * lines (a seal's "יין ישמח לבב אנוש", one word a line).
 */
function rebreak(text: string, lines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const n = Math.min(lines, words.length);
  const total = words.join(' ').length;
  const out: string[][] = [[]];
  let used = 0;
  for (const [k, word] of words.entries()) {
    const line = out[out.length - 1];
    // a new line once this one has its share, keeping a word for each line still to come
    if (line.length && out.length < n && used + word.length / 2 > (total * out.length) / n && words.length - k >= n - out.length) out.push([]);
    out[out.length - 1].push(word);
    used += word.length + 1;
  }
  return out.map((l) => l.join(' ')).join('\n');
}

/** Hebrew letters stand about 0.78 of the font size tall; digits and Latin capitals about 0.72 */
const inkShare = (text: string) => (/[֐-׿]/.test(text) ? 0.78 : 0.72);

/**
 * The content layer of a template made from a finished design: each text a live customer field over the cleaned
 * picture, in the box its letters took in the picture. The box is as long as the ink and centred on it, turned and
 * bent as the line was; the text shrinks to the box's width when the font standing in for the designer's is wider
 * (fit 'shrink'), so it keeps its place and its line breaks. Places are in percent of the picture: `refined` is each
 * text's box fitted to its ink (importClean).
 */
export function importedContent(opts: {
  page: CanvasDoc['page'];
  texts: ReadText[];
  refined: Refined[];
  /** the colour each text stands on once wiped, by the same order */
  under: (string | null)[];
  fonts: string[];
  newId: () => string;
}): TextElement[] {
  const { page, texts, refined, fonts, newId } = opts;
  const seen = new Set<string>();
  return texts.map((t, i): TextElement => {
    let label = t.label.trim() || 'טקסט';
    if (seen.has(label)) label = `${label} ${i + 1}`;
    seen.add(label);
    let text = t.text;
    let lines = Math.max(1, text.split('\n').length);
    const angle = t.rotation;
    const rad = (angle * Math.PI) / 180;
    const steep = Math.abs(angle) >= 45;
    // a line turned on its side is measured across the page's width, its length down its height
    const across = steep ? page.width_mm : page.height_mm;
    const square = angle === 0 || Math.abs(angle) === 90;
    const thick = (b: { w: number; h: number }) => ((steep ? b.w : b.h) / 100) * across;
    const long = (b: { w: number; h: number }) => ((steep ? b.h : b.w) / 100) * (steep ? page.height_mm : page.width_mm);
    // the box fitted to the ink, unless fitting it grew into something next to the text (a candle, a glow, a bottle):
    // then the box the model measured
    const fit = thick(refined[i]) <= thick(t) * 1.3 && long(refined[i]) <= long(t) * 1.3 + 2 ? refined[i] : { ...t, color: refined[i].color };
    // The size: the model's line height, never larger than the ink allows and never below 60% of it, so the text keeps
    // the size it has in the picture rather than growing into what stands beside it. A slanted line's box is no
    // measure of its letters' height, so it takes the model's.
    const fromModel = ((t.lineHeight / 100) * across) / 1.25;
    const fromInk = ((thick(fit) / lines / inkShare(text)) * 1.1);
    const size_mm = square ? Math.min(fromModel, Math.max(fromModel * 0.6, fromInk)) : fromModel;
    // the picture may break the block into more lines than the model wrote
    if (square && !t.arc) {
      const shown = Math.round((thick(fit) - size_mm * inkShare(text)) / (size_mm * 1.25)) + 1;
      if (shown > lines) {
        text = rebreak(text.replace(/\s*\n\s*/g, ' '), shown);
        lines = text.split('\n').length;
      }
    }
    // the block's thickness across its lines; a bent line also takes the height of its bend
    const W = (fit.w / 100) * page.width_mm;
    const H = (fit.h / 100) * page.height_mm;
    let depth = lines * size_mm * 1.25;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    // the line's own length, out of its upright box: a slanted line's box holds its length and its depth across
    const length = Math.max(5, square ? (steep ? H : W) : steep ? (H - depth * cos) / sin : (W - depth * sin) / cos);
    if (t.arc) {
      const bend = (Math.min(100, Math.abs(t.arc)) / 100) * Math.PI;
      const run = (length * (bend / 2)) / Math.sin(bend / 2);
      depth = size_mm * 1.25 + (run / bend) * (1 - Math.cos(bend / 2));
    }
    const w_mm = Math.min(length * 1.04, steep ? page.height_mm : page.width_mm);
    // the box turns about its first corner: from the ink's middle, back by half the box turned with it
    const cx = (fit.x / 100) * page.width_mm + W / 2;
    const cy = (fit.y / 100) * page.height_mm + H / 2;
    const x_mm = cx - ((w_mm / 2) * Math.cos(rad) - (depth / 2) * Math.sin(rad));
    const y_mm = cy - ((w_mm / 2) * Math.sin(rad) + (depth / 2) * Math.cos(rad));
    const color = readable(fit.color?.toUpperCase() ?? null, t.color.toUpperCase(), opts.under[i]);
    return {
      id: newId(),
      type: 'text',
      x_mm: angle === 0 ? Math.max(0, x_mm) : x_mm,
      y_mm: angle === 0 ? Math.max(0, y_mm) : y_mm,
      w_mm,
      rotation: angle,
      text,
      align: t.align,
      locks: FIELD_LOCKS,
      field: { label: label.slice(0, 60) },
      ...(t.arc ? { arc: Math.max(-100, Math.min(100, Math.round(t.arc))) } : { fit: 'shrink' as const }),
      // the line height is what was measured; a text's size is that over the 1.25 it is drawn at
      font: {
        family: fonts.includes(t.font) ? t.font : 'Heebo',
        weight: t.bold ? 700 : 400,
        size_pt: Math.min(400, Math.max(4, size_mm / PT_TO_MM)),
        color,
      },
      design_color: color,
    };
  });
}
