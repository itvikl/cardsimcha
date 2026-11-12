import type { CanvasDoc, CanvasElement, TextElement } from './types';

const PT_TO_MM = 25.4 / 72;

/** how many lines a text takes (a measure good enough to lay out what follows it) */
export function linesOf(t: string, sizePt: number, widthMm: number) {
  const perLine = Math.max(1, Math.floor(widthMm / (sizePt * PT_TO_MM * 0.56)));
  let lines = 1;
  let used = 0;
  for (const word of t.split(/\s+/)) {
    if (used && used + 1 + word.length > perLine) {
      lines++;
      used = word.length;
    } else used += (used ? 1 : 0) + word.length;
  }
  return lines;
}

export const heightOf = (t: string, sizePt: number, widthMm: number) => linesOf(t, sizePt, widthMm) * sizePt * PT_TO_MM * 1.25;

/** the largest size, from `base` down to `floor` of it, at which the text takes no more than `room` mm; the smallest when none does */
function fitSize(t: string, base: number, widthMm: number, room: number, floor = 0.62) {
  for (let size = base; size > base * floor; size -= 0.5) if (heightOf(t, size, widthMm) <= room) return size;
  return base * floor;
}

/** One ad's words, by the field's label; the layouts share these labels (see scripts/seed-content.ts). */
export type AdTexts = Record<string, string>;

/**
 * The design with new words in its editable fields. A longer text takes a smaller size so it stays in the room the
 * layout gave the old one. Blank words leave the field as it was.
 */
export function writeAd<D extends CanvasDoc>(doc: D, texts: AdTexts): D {
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (e.type !== 'text' || !e.editable || !e.label) return e;
      const next = texts[e.label]?.trim();
      if (!next) return e;
      const size = fitSize(next, e.font.size_pt, e.w_mm, heightOf(e.text, e.font.size_pt, e.w_mm));
      return { ...e, text: next, font: { ...e.font, size_pt: size } } as TextElement;
    }),
  };
}

/** A picture in place of the design's photograph, covering its place whole. `src` is for drawing a preview only. */
export function placePhoto<D extends CanvasDoc>(doc: D, photo: { assetId: string; width: number; height: number; src?: string }): D {
  return {
    ...doc,
    elements: doc.elements.map((e): CanvasElement => {
      if (e.type !== 'image' || e.role !== 'photo' || !e.photoBox) return e;
      const { x_mm, y_mm, w_mm, h_mm } = e.photoBox;
      const scale = Math.max(w_mm / photo.width, h_mm / photo.height);
      const w = photo.width * scale;
      const h = photo.height * scale;
      return { ...e, asset_id: photo.assetId, x_mm: x_mm + (w_mm - w) / 2, y_mm: y_mm + (h_mm - h) / 2, w_mm: w, h_mm: h, ...(photo.src ? { src: photo.src } : {}) };
    }),
  };
}

/** The words a product puts on an ad. */
export const itemTexts = (item: { name: string; details: string; price: string }): AdTexts => ({
  כותרת: item.name,
  'משפט משנה': [item.details, item.price].filter(Boolean).join(' · '),
  'קריאה לפעולה': 'לפרטים נוספים',
});

const isPoint = (e: CanvasElement) => e.type === 'text' && /^נקודה \d/.test(e.label ?? '');

/**
 * The design without its list of points, for an ad about one product: the template's points speak of the profession
 * in general, and under a product they would be claims the business never made. A point's mark is its dot and the ✓ drawn
 * right after it (see `points` in scripts/seed-content.ts).
 */
export function dropPoints<D extends CanvasDoc>(doc: D): D {
  const els = doc.elements;
  const isMark = (e: CanvasElement) => e.type === 'text' && e.text === '✓';
  return { ...doc, elements: els.filter((e, i) => !isPoint(e) && !isMark(e) && !(els[i + 1] && isMark(els[i + 1]))) };
}

export const hasPoints = (doc: CanvasDoc) => doc.elements.some(isPoint);
