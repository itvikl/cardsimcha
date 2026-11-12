import { heightOf } from './adText';
import type { CanvasDoc } from './types';

/**
 * Matching a wording's text to the background under it. The designer's colour stays when it reads there; otherwise the
 * text takes a tone of the background's own colour, dark or light, so it still belongs to the card.
 */

/** a picture's pixels, four bytes each (RGBA): a browser's ImageData, or sharp's raw output */
export type Pixels = { data: ArrayLike<number>; width: number; height: number };

/** WCAG AA: large text needs less. The designer's colour stays at this much */
const NORMAL_CONTRAST = 4.5;
const LARGE_CONTRAST = 3;
/** a tone chosen in its place has to read clearly, not only pass (WCAG AAA) */
const NORMAL_CHOSEN = 7;
const LARGE_CHOSEN = 4.5;
const LARGE_PT = 24;
/** at most this many pixels are looked at in one area */
const SAMPLES = 2500;

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const hexLuminance = (hex: string) => luminance(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function hslToHex(h: number, s: number, l: number) {
  const part = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${part(0)}${part(8)}${part(4)}`.toUpperCase();
}

/** hue in degrees, saturation and lightness from 0 to 1 */
function rgbToHsl(r: number, g: number, b: number) {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const d = max - min;
  const l = (max + min) / 2;
  if (!d) return { h: 0, s: 0, l };
  const h = max === x ? ((y - z) / d + 6) % 6 : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return { h: h * 60, s: d / (1 - Math.abs(2 * l - 1)), l };
}

/** how dark and how light an area of the picture gets, ignoring stray pixels */
export type Area = { dark: number; light: number };

export function areaOf(px: Pixels, box: { x: number; y: number; w: number; h: number }): Area {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(px.width, Math.ceil(box.x + box.w));
  const y1 = Math.min(px.height, Math.ceil(box.y + box.h));
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / SAMPLES)));
  const seen: number[] = [];
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * px.width + x) * 4;
      seen.push(luminance(px.data[i], px.data[i + 1], px.data[i + 2]));
    }
  }
  if (!seen.length) return { dark: 1, light: 1 };
  seen.sort((a, b) => a - b);
  return { dark: seen[Math.floor(seen.length * 0.1)], light: seen[Math.floor(seen.length * 0.9)] };
}

/** the picture's own colour: the hue most of its colourful pixels share. Null for a picture with no real colour. */
export function accentOf(px: Pixels): { h: number; s: number } | null {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, s: 0 }));
  const step = Math.max(1, Math.round(Math.sqrt((px.width * px.height) / SAMPLES)));
  for (let y = 0; y < px.height; y += step) {
    for (let x = 0; x < px.width; x += step) {
      const i = (y * px.width + x) * 4;
      const { h, s, l } = rgbToHsl(px.data[i], px.data[i + 1], px.data[i + 2]);
      if (s < 0.15 || l < 0.08 || l > 0.95) continue;
      const bin = bins[Math.floor(h / 30) % 12];
      bin.weight += s;
      bin.s += s * s;
    }
  }
  const top = bins.map((b, i) => ({ ...b, i })).sort((a, b) => b.weight - a.weight)[0];
  return top.weight ? { h: top.i * 30 + 15, s: top.s / top.weight } : null;
}

/** the colour a text takes over this area; the designer's own when it reads there */
export function fitColor(designed: string, area: Area, accent: { h: number; s: number } | null, sizePt: number): string {
  const worst = (hex: string) => {
    const l = hexLuminance(hex);
    return Math.min(contrast(l, area.dark), contrast(l, area.light));
  };
  const large = sizePt >= LARGE_PT;
  if (worst(designed) >= (large ? LARGE_CONTRAST : NORMAL_CONTRAST)) return designed;

  const { h, s } = accent ?? rgbToHsl(parseInt(designed.slice(1, 3), 16), parseInt(designed.slice(3, 5), 16), parseInt(designed.slice(5, 7), 16));
  const tone = (l: number) => hslToHex(h, Math.min(s, 0.7), l);
  // from the most colourful tone to the palest: dark tones over a light area, light tones over a dark one
  const lights = [0.6, 0.68, 0.76, 0.84, 0.9, 0.95, 0.98];
  const darks = [0.45, 0.38, 0.3, 0.24, 0.18, 0.12, 0.07];
  const toLight = contrast(1, area.dark) >= contrast(0, area.light);
  const tones = (toLight ? lights : darks).map(tone);
  const reads = tones.find((t) => worst(t) >= (large ? LARGE_CHOSEN : NORMAL_CHOSEN));
  if (reads) return reads;
  // a busy area where nothing fully reads: whichever reads best
  return [...tones, toLight ? '#FFFFFF' : '#111111', designed].sort((a, b) => worst(b) - worst(a))[0];
}

/**
 * The card with each of its wording's texts in the colour that fits what is drawn under it: every text that keeps its designed
 * colour (`designColor`). `px` is the card without its texts.
 */
export function fitDocColors<D extends CanvasDoc>(doc: D, px: Pixels): D {
  const scale = px.width / doc.page.width_mm;
  const accent = accentOf(px);
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (e.type !== 'text' || !e.designColor) return e;
      const area = areaOf(px, { x: e.x_mm * scale, y: e.y_mm * scale, w: e.w_mm * scale, h: heightOf(e.text, e.font.size_pt, e.w_mm) * scale });
      return { ...e, font: { ...e.font, color: fitColor(e.designColor ?? e.font.color, area, accent, e.font.size_pt) } };
    }),
  };
}
