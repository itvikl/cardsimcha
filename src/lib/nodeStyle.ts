import type { Fill, ImageElement, ShapeElement, TextElement } from './types';

/**
 * How an element looks beyond its place and size: a text's spacing, effects and foil, a shape's or page's gradient, a
 * picture's crop and mask. The editor and the off-screen renderer draw with the same Konva settings from here, so the
 * card, its previews and every download agree. Text measuring needs a canvas (browser, or a canvas polyfill).
 *
 * Ported from feature/business-ads (Vitol) onto card format v2.
 */

const PT_TO_MM = 25.4 / 72;
export const LINE_HEIGHT = 1.25;

const FOIL: Record<'gold' | 'silver', (number | string)[]> = {
  gold: [0, '#8A6A1F', 0.28, '#EBD283', 0.5, '#B8892F', 0.72, '#F4E3A6', 1, '#9C7425'],
  silver: [0, '#7D7F83', 0.28, '#E8EAED', 0.5, '#A3A6AB', 0.72, '#F6F7F8', 1, '#8A8D92'],
};

let measurer: CanvasRenderingContext2D | null = null;
const measure = () => (measurer ??= typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d'));

/** a CSS/canvas font string for a text at `sizePx` */
export const fontCss = (e: Pick<TextElement, 'font'>, sizePx: number) => `${e.font.weight} ${sizePx}px "${e.font.family}"`;

/** the size a text is drawn at, in pt: its own, or smaller when it shrinks so each line fits the box on one line */
export function fittedSize(e: TextElement, px: number): number {
  if (e.fit !== 'shrink') return e.font.size_pt;
  const ctx = measure();
  if (!ctx) return e.font.size_pt;
  const lines = e.text.split('\n');
  // a little short of the box: shrunk to its exact width, rounding and the outline made Konva wrap the line anyway
  const box = e.w_mm * px * 0.97;
  let size = e.font.size_pt;
  // width grows with the size, so two rounds land close enough; letter spacing doesn't scale, hence the third
  for (let round = 0; round < 3; round++) {
    ctx.font = fontCss(e, size * PT_TO_MM * px);
    const spacing = (e.font.letter_spacing ?? 0) * PT_TO_MM * px;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width + spacing * [...l].length));
    if (widest <= box) break;
    size = Math.max(4, (size * box) / widest);
  }
  return size;
}

/** A text's Konva settings beyond its place, width and words. */
export function textLook(e: TextElement, px: number) {
  const sizePt = fittedSize(e, px);
  const fontSize = sizePt * PT_TO_MM * px;
  const lineHeight = e.font.line_height ?? LINE_HEIGHT;
  const height = fontSize * lineHeight * Math.max(1, e.text.split('\n').length);
  return {
    fontSize,
    lineHeight,
    letterSpacing: (e.font.letter_spacing ?? 0) * PT_TO_MM * px,
    ...shadowOf(e, fontSize),
    ...(e.stroke ? { stroke: e.stroke.color, strokeWidth: e.stroke.width_mm * px, fillAfterStrokeEnabled: true } : {}),
    ...(e.foil
      ? {
          fillPriority: 'linear-gradient',
          fillLinearGradientStartPoint: { x: 0, y: 0 },
          fillLinearGradientEndPoint: { x: 0, y: height },
          fillLinearGradientColorStops: FOIL[e.foil],
        }
      : {}),
  };
}

const shadowOf = (e: TextElement, fontSize: number) =>
  e.shadow ? { shadowEnabled: true, shadowColor: 'rgba(0,0,0,0.55)', shadowBlur: fontSize * 0.12, shadowOffset: { x: 0, y: fontSize * 0.05 }, shadowOpacity: 1 } : {};

/** a gradient across a w×h box at `angle` degrees (0: from right to left, 90: from top to bottom) */
function gradient(from: string, to: string, angle: number, w: number, h: number) {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // the half-length of the box along that direction, so the gradient runs corner to corner
  const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
  return {
    fillPriority: 'linear-gradient',
    fillLinearGradientStartPoint: { x: w / 2 + dx * half, y: h / 2 - dy * half },
    fillLinearGradientEndPoint: { x: w / 2 - dx * half, y: h / 2 + dy * half },
    fillLinearGradientColorStops: [0, from, 1, to],
  };
}

/** Konva fill settings for a v2 fill over a w×h box: `fill` always (the flat colour, or the gradient's first), plus the gradient */
export const fillLook = (f: Fill, w: number, h: number) => ({
  fill: f.color,
  ...(f.type === 'linear' ? gradient(f.color, f.color2, f.angle, w, h) : {}),
});

/** a shape's Konva settings beyond its place and size */
export const shapeLook = (e: ShapeElement, px: number) => ({
  ...fillLook(e.fill, e.w_mm * px, e.h_mm * px),
  ...(e.corner_radius_mm ? { cornerRadius: e.corner_radius_mm * px } : {}),
  ...(e.opacity !== undefined ? { opacity: e.opacity } : {}),
});

/** the part of a picture its box shows, in the picture's own pixels; none draws the whole picture into the box */
export function cropOf(e: ImageElement, iw: number, ih: number) {
  if (!e.crop || !iw || !ih) return undefined;
  const box = e.w_mm / e.h_mm;
  let w = ih * box <= iw ? ih * box : iw;
  let h = ih * box <= iw ? ih : iw / box;
  w /= e.crop.zoom;
  h /= e.crop.zoom;
  return { x: ((iw - w) / 2) * (1 + e.crop.x), y: ((ih - h) / 2) * (1 + e.crop.y), width: w, height: h };
}

type PathCtx = {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void;
  closePath(): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
};

/** the outline a masked picture shows through, in a w×h box */
export function maskPath(ctx: PathCtx, mask: NonNullable<ImageElement['mask']>, w: number, h: number) {
  ctx.beginPath();
  if (mask === 'circle') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (mask === 'arch') {
    const r = Math.min(w / 2, h);
    ctx.moveTo(0, h);
    ctx.lineTo(0, r);
    ctx.arc(w / 2, r, w / 2, Math.PI, 0);
    ctx.lineTo(w, h);
  } else {
    const r = Math.min(w, h) * 0.12;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
  }
  ctx.closePath();
}

/** the foil's colours, for a text drawn letter by letter (arcText.ts) */
export const foilStops = (foil: 'gold' | 'silver') => FOIL[foil];
