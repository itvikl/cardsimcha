import { hasArc, visualOrder } from './arcText';
import { allElements } from './canvas';
import { LINE_HEIGHT } from './nodeStyle';
import type { CanvasDoc, CanvasElement, TextElement } from './types';

/**
 * Keeping texts on the card when the AI assistant rewrites them (and later, when a wording or backdrop changes under
 * them). Only the texts named are fitted; a card as imported or as an author left it keeps its sizes. Each stays where
 * it is and gets smaller (never below MIN of its designed size) until no word is wider than its box, it doesn't run
 * into the text below it, and it ends inside the page's safe area. A text that has room again grows back to its
 * designed size. A text moves only for an author or where its transform lock lets the customer move it (the server
 * keeps it in place otherwise). Browser only (texts are measured).
 */

const PT_TO_MM = 25.4 / 72;
/** how far in from the page's edge texts must end, as the editor's safe area line (mm) */
export const SAFE_MM = 4;
/** the smallest a text gets, as a share of its designed size */
const MIN = 0.4;
/** the room kept between a text and the one below it (mm) */
const GAP_MM = 0.5;

let measurer: CanvasRenderingContext2D | null = null;
const ctx = () => (measurer ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d'));

/** the size the designer gave a text; fitting only ever shrinks from here */
export const designedSize = (e: TextElement) => e.design_size ?? e.font.size_pt;

/** how a text lays out at `sizePt`: its height and its widest word, in mm (word wrapping as Konva does it) */
function layoutAt(c: CanvasRenderingContext2D, e: TextElement, sizePt: number) {
  const px = 10; // canvas pixels per mm while measuring; only the ratios matter
  const size = sizePt * PT_TO_MM * px;
  c.font = `${e.font.weight === 700 ? 'bold ' : ''}${size}px "${e.font.family}"`;
  const spacing = (e.font.letter_spacing ?? 0) * PT_TO_MM * px;
  const width = (s: string) => c.measureText(s).width + spacing * [...s].length;
  const box = e.w_mm * px;
  if (hasArc(e)) {
    // one line along the arc: what has to fit is its whole run
    const run = visualOrder(e.text).reduce((sum, ch) => sum + width(ch), 0);
    return { height: (size * 0.85) / px, widest: run / px, box: e.w_mm };
  }
  let lines = 0;
  let widest = 0;
  for (const para of e.text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      widest = Math.max(widest, width(word));
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > box) {
        lines++;
        line = word;
      } else {
        line = next;
      }
    }
    lines++;
  }
  // the last line's leading is empty room, so it may reach into the gap
  return { height: (((lines - 1) * (e.font.line_height ?? LINE_HEIGHT) + 0.85) * size) / px, widest: widest / px, box: e.w_mm };
}

/** what a text may take beyond its limits because its own design already does: extra mm down, and wider than its box */
export type Allowance = Map<string, { down: number; wide: number }>;

/** the limits of one text on this card: the page's safe area, and the nearest text below that shares its width */
function limitsOf(doc: CanvasDoc, texts: TextElement[], e: TextElement) {
  const below = texts
    .filter((o) => o !== e && o.y_mm > e.y_mm + 1 && o.x_mm < e.x_mm + e.w_mm && e.x_mm < o.x_mm + o.w_mm)
    .reduce((min, o) => Math.min(min, o.y_mm - GAP_MM), Infinity);
  return { bottom: Math.min(doc.page.height_mm - SAFE_MM, below) };
}

/** the texts on the card, which limit one another */
const shownTexts = (doc: CanvasDoc) => allElements(doc).filter((e): e is TextElement => e.type === 'text' && !e.hidden);
/** the texts to fit: those named; a turned text is left as it is (its limits run across the page, not down it) */
const chosen = (texts: TextElement[], only: Set<string>) => texts.filter((e) => only.has(e.id) && !e.rotation);

/**
 * How far each text of a card as designed already goes past its limits, at its designed size: a design that sets two
 * lines close, or a word a little wider than its box, is the designer's choice and is never "fixed". Measured on the
 * card with its designed words, before a customer changes them.
 */
export function allowanceOf(doc: CanvasDoc, only: Set<string>): Allowance {
  const c = ctx();
  const out: Allowance = new Map();
  if (!c) return out;
  const texts = shownTexts(doc);
  for (const e of chosen(texts, only)) {
    const l = layoutAt(c, e, designedSize(e));
    const { bottom } = limitsOf(doc, texts, e);
    out.set(e.id, { down: Math.max(0, e.y_mm + l.height - bottom), wide: Math.max(0, l.widest - l.box) });
  }
  return out;
}

const fitsAt = (c: CanvasRenderingContext2D, e: TextElement, sizePt: number, bottom: number, wide: number) => {
  const l = layoutAt(c, e, sizePt);
  return l.widest <= l.box + wide + 0.01 && e.y_mm + l.height <= bottom;
};

/**
 * The card with the texts in `only` fitted onto it, as above. `allow` is what each text's design already takes
 * (allowanceOf); a text the design never measured gets none. Unchanged texts keep their identity.
 */
export function fitDocTexts<D extends CanvasDoc>(doc: D, only: Set<string>, allow: Allowance = new Map(), author = false): D {
  const c = ctx();
  if (!c || !only.size) return doc;
  const { width_mm: W, height_mm: H } = doc.page;
  const texts = shownTexts(doc);
  let changed = false;
  const fitted = new Map<string, TextElement>();
  for (const e of chosen(texts, only)) {
    // a box past the side of the page comes back onto it (the safe area is the designer's to use)
    const moves = author || e.locks.transform;
    let x = e.x_mm;
    if (moves && x + e.w_mm > W) x = Math.max(0, W - e.w_mm);
    if (moves && x < 0) x = 0;
    const own = allow.get(e.id) ?? { down: 0, wide: 0 };
    const bottom = limitsOf(doc, texts, { ...e, x_mm: x }).bottom + own.down;
    const base = designedSize(e);
    let size = base;
    if (!fitsAt(c, e, size, bottom, own.wide)) {
      // halving between what fits and what doesn't, to a quarter point
      let lo = Math.max(4, base * MIN);
      let hi = base;
      if (fitsAt(c, e, lo, bottom, own.wide)) {
        while (hi - lo > 0.25) {
          const mid = (lo + hi) / 2;
          if (fitsAt(c, e, mid, bottom, own.wide)) lo = mid;
          else hi = mid;
        }
      }
      size = Math.floor(lo * 4) / 4;
    }
    // even at its smallest a text ends on the page: it moves up as far as it must
    let y = e.y_mm;
    const height = layoutAt(c, e, size).height;
    if (moves && y + height > H - SAFE_MM + own.down) y = Math.max(SAFE_MM, H - SAFE_MM + own.down - height);
    if (size !== e.font.size_pt || x !== e.x_mm || y !== e.y_mm || (size !== base && e.design_size === undefined)) {
      changed = true;
      fitted.set(e.id, { ...e, x_mm: x, y_mm: y, design_size: base, font: { ...e.font, size_pt: size } });
    }
  }
  if (!changed) return doc;
  const swap = (els: CanvasElement[]) => els.map((e) => fitted.get(e.id) ?? e);
  return { ...doc, layers: { ...doc.layers, content: swap(doc.layers.content), overlay: swap(doc.layers.overlay) } };
}
