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

const inside = (t: Refined, o: { x: number; y: number; w: number; h: number }) => {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  return cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h;
};

/**
 * The content layer of a template made from a finished design: each text a live customer field, over the cleaned
 * picture. The objects the model found (a pill, a badge) stay in the picture; a text on one stays inside it. Places
 * are in percent of the picture: `refined` is each text's box fitted to its ink (importClean).
 */
export function importedContent(opts: {
  page: CanvasDoc['page'];
  texts: ReadText[];
  refined: Refined[];
  /** the colour each text stands on once wiped, by the same order */
  under: (string | null)[];
  /** the objects the model found (percent of the picture): a text on one stays inside it */
  frames: { x: number; y: number; w: number; h: number }[];
  fonts: string[];
  newId: () => string;
}): TextElement[] {
  const { page, texts, refined, fonts, newId } = opts;
  const seen = new Set<string>();
  return texts.map((t, i): TextElement => {
    let label = t.label.trim() || 'טקסט';
    if (seen.has(label)) label = `${label} ${i + 1}`;
    seen.add(label);
    const lines = Math.max(1, t.text.split('\n').length);
    const turned = t.rotation !== 0;
    // a turned line runs down the page: its thickness is measured across the width, its length down the height
    const across = turned ? page.width_mm : page.height_mm;
    const along = turned ? page.height_mm : page.width_mm;
    const thick = (b: { w: number; h: number }) => ((turned ? b.w : b.h) / 100) * across;
    const long = (b: { w: number; h: number }) => ((turned ? b.h : b.w) / 100) * along;
    // the box fitted to the ink, unless fitting it grew into something next to the text (a candle, a glow, a bottle),
    // which would make the text far too big or move it: then the box the model measured
    const fit = thick(refined[i]) <= thick(t) * 1.3 && long(refined[i]) <= long(t) * 1.3 + 2 ? refined[i] : { ...t, color: refined[i].color };
    const inkThick = thick(fit);
    const inkLong = ((turned ? fit.h : fit.w) / 100) * along;
    // The size: the model's line height, never larger than the ink allows (Hebrew letters stand about 0.78 of the
    // font size tall) and never below 60% of it. The ink only ever makes a text smaller, so the text keeps the size it
    // has in the picture rather than growing into what stands beside it.
    const fromModel = ((t.lineHeight / 100) * across) / 1.25;
    const fromInk = (inkThick / lines / 0.78) * 1.1;
    let size_mm = Math.min(fromModel, Math.max(fromModel * 0.6, fromInk));
    // When the picture shows no more lines than the text has, its lines must not break: the box takes the longest
    // line (about half a size per letter) besides the ink. Otherwise the picture wraps it, and the ink's width does too.
    const wraps = inkThick > lines * size_mm * 1.25 * 1.5;
    const letters = Math.max(...t.text.split('\n').map((l) => l.length));
    // An upright text on an object (a circle, a box) stays inside it: the font that stands in for the designer's is
    // often wider, so when its longest line would pass the object's width, it gets smaller, to 60% at most.
    const frame = turned ? undefined : opts.frames.filter((f) => inside(fit, f)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const room = frame ? (frame.w / 100) * page.width_mm * 0.9 : Infinity;
    if (!wraps && letters * size_mm * 0.55 > room) size_mm = Math.max(size_mm * 0.6, room / (letters * 0.55));
    const longest = letters * size_mm * 0.55;
    const w_mm = Math.min(along, room, Math.max(5, inkLong * 1.08 + size_mm * 0.3, wraps ? 0 : longest));
    const block = lines * size_mm * 1.25;
    const inkX = (fit.x / 100) * page.width_mm;
    const inkY = (fit.y / 100) * page.height_mm;
    const inkW = (fit.w / 100) * page.width_mm;
    const inkH = (fit.h / 100) * page.height_mm;
    let x_mm: number;
    let y_mm: number;
    if (t.rotation === -90) {
      // reading up: the box turns about its first corner, which stands at the bottom, its lines stacking rightwards
      x_mm = inkX + inkW / 2 - block / 2;
      y_mm = inkY + inkH / 2 + w_mm / 2;
    } else if (t.rotation === 90) {
      // reading down: the first corner stands at the top, its lines stacking leftwards
      x_mm = inkX + inkW / 2 + block / 2;
      y_mm = inkY + inkH / 2 - w_mm / 2;
    } else {
      // anchored where its alignment holds it, centred on the ink
      x_mm = t.align === 'right' ? inkX + inkW - w_mm : t.align === 'left' ? inkX : inkX + inkW / 2 - w_mm / 2;
      y_mm = inkY + inkH / 2 - block / 2;
      if (frame) {
        const fx = (frame.x / 100) * page.width_mm;
        x_mm = Math.min(Math.max(x_mm, fx), fx + (frame.w / 100) * page.width_mm - w_mm);
      }
    }
    const color = readable(fit.color?.toUpperCase() ?? null, t.color.toUpperCase(), opts.under[i]);
    return {
      id: newId(),
      type: 'text',
      // an upright box that came out wider than the ink stays on the page
      x_mm: Math.max(0, turned ? x_mm : Math.min(x_mm, page.width_mm - w_mm)),
      y_mm: Math.max(0, y_mm),
      w_mm,
      rotation: t.rotation,
      text: t.text,
      align: t.align,
      locks: FIELD_LOCKS,
      field: { label: label.slice(0, 60) },
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
