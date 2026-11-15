import { foilStops } from './nodeStyle';
import type { TextElement } from './types';

/**
 * A text on an arc: its letters stand on a circle, each turned to the circle's line, not a straight line turned as a
 * whole. `arc` is how much of a half circle the line takes: 100 bends it into a half circle with its middle at the top
 * (a rainbow), -100 into one with its middle at the bottom (a smile), and near 0 it stays straight.
 *
 * Drawn the same in the editor and off screen (renderCard), so the card, its previews and every download agree.
 */

export const ARC_LIMIT = 100;
/** below this the bend can't be seen, and the text is drawn as a plain one */
const ARC_MIN = 2;
const PT_TO_MM = 25.4 / 72;

export const hasArc = (e: Pick<TextElement, 'arc'>) => Math.abs(e.arc ?? 0) >= ARC_MIN;

export const fontOf = (e: TextElement, px: number) =>
  `${e.font.weight === 700 ? 'bold ' : ''}${e.font.size_pt * PT_TO_MM * px}px "${e.font.family}"`;

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('he', { granularity: 'grapheme' }) : null;
/** letters with their niqqud: a mark stays with the letter it sits on */
const graphemes = (t: string) => (segmenter ? [...segmenter.segment(t)].map((s) => s.segment) : Array.from(t));

/** digits and Latin letters, and what joins them inside a run ("19:30", "www.site.co.il") */
const LTR = /[0-9A-Za-z]/;
const JOIN = /[.:,/\-'+%@_]/;

/**
 * The letters in the order they stand from right to left. A Hebrew line runs right to left, and a run of numbers or
 * English inside it reads left to right, so that run is turned around.
 */
export function visualOrder(text: string): string[] {
  const g = graphemes(text.replace(/\s*\n\s*/g, ' '));
  const out: string[] = [];
  for (let i = 0; i < g.length; ) {
    if (!LTR.test(g[i])) {
      out.push(g[i++]);
      continue;
    }
    let j = i + 1;
    while (j < g.length && (LTR.test(g[j]) || (JOIN.test(g[j]) && j + 1 < g.length && LTR.test(g[j + 1])))) j++;
    out.push(...g.slice(i, j).reverse());
    i = j;
  }
  return out;
}

export type ArcLayout = {
  /** each letter's foot on the circle, in px from the element's corner, and its turn in radians */
  glyphs: { ch: string; x: number; y: number; a: number }[];
  /** the box the bent line needs, in px */
  width: number;
  height: number;
};

/** Where each letter of an arc text stands, `px` canvas pixels to a millimetre. */
export function arcLayout(e: TextElement, px: number, ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>): ArcLayout {
  ctx.font = fontOf(e, px);
  const size = e.font.size_pt * PT_TO_MM * px;
  const chars = visualOrder(e.text);
  const spacing = (e.letterSpacing ?? 0) * PT_TO_MM * px;
  const widths = chars.map((ch) => ctx.measureText(ch).width + spacing);
  const W = widths.reduce((a, b) => a + b, 0);
  const boxW = e.w_mm * px;
  const theta = (Math.max(-ARC_LIMIT, Math.min(ARC_LIMIT, e.arc ?? 0)) / 100) * Math.PI;
  const R = hasArc(e) && W > 0 ? W / theta : 0;
  // how far the ends drop below the middle (a rainbow), or rise above it (a smile)
  const sag = R ? Math.abs(R) * (1 - Math.cos(theta / 2)) : 0;
  const ascent = size * 0.9;
  const base = ascent + (theta < 0 ? sag : 0);
  const cx = e.align === 'right' ? boxW - W / 2 : e.align === 'left' ? W / 2 : boxW / 2;
  let run = 0;
  const glyphs = chars.map((ch, i) => {
    const mid = run + widths[i] / 2;
    run += widths[i];
    // from the right end: the first letter of the line stands at the right
    const d = W / 2 - mid;
    if (!R) return { ch, x: cx + d, y: base, a: 0 };
    const a = d / R;
    return { ch, x: cx + R * Math.sin(a), y: base + R * (1 - Math.cos(a)), a };
  });
  return { glyphs, width: boxW, height: size * 1.25 + sag };
}

/**
 * Draws an arc text at the element's corner (the caller has moved and turned the canvas there), with the same shadow,
 * outline and foil a straight text takes (nodeStyle.ts).
 */
export function drawArc(ctx: CanvasRenderingContext2D, e: TextElement, px: number) {
  const { glyphs, height } = arcLayout(e, px, ctx);
  const size = e.font.size_pt * PT_TO_MM * px;
  if (e.foil) {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    const stops = foilStops(e.foil);
    for (let i = 0; i < stops.length; i += 2) g.addColorStop(stops[i] as number, stops[i + 1] as string);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = e.font.color;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.direction = 'ltr';
  ctx.lineJoin = 'round';
  for (const g of glyphs) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.a);
    if (e.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = size * 0.12;
      ctx.shadowOffsetY = size * 0.05;
    }
    if (e.stroke) {
      ctx.strokeStyle = e.stroke.color;
      ctx.lineWidth = e.stroke.width_mm * px;
      ctx.strokeText(g.ch, 0, 0);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillText(g.ch, 0, 0);
    ctx.restore();
  }
}

let measurer: CanvasRenderingContext2D | null = null;
/** the box an arc text needs, measured on a canvas of its own (browser only) */
export function arcBox(e: TextElement, px: number): { width: number; height: number } {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return { width: e.w_mm * px, height: e.font.size_pt * PT_TO_MM * px * 1.25 };
  const { width, height } = arcLayout(e, px, measurer);
  return { width, height };
}
