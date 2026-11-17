import sharp from 'sharp';
import type { ReadObject, ReadText } from './agent/importDesign';
import { clearFlatBackground } from './removeBackground';

/** a cut-out object: a PNG with see-through corners, its size in pixels, and where it stood (percent of the picture) */
export type CutObject = { object: ReadObject; png: Buffer; width: number; height: number };

/** the object's outline over a w×h box, white where it is and clear elsewhere; `inset` draws it that many pixels in */
export function maskOf(o: Pick<ReadObject, 'shape' | 'corner'>, w: number, h: number, inset = 0) {
  const iw = Math.max(1, w - inset * 2);
  const ih = Math.max(1, h - inset * 2);
  const short = Math.min(iw, ih);
  const r = o.shape === 'pill' ? short / 2 : o.shape === 'rounded' ? (o.corner / 100) * short : 0;
  const shape =
    o.shape === 'ellipse'
      ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${iw / 2}" ry="${ih / 2}" fill="#fff"/>`
      : `<rect x="${inset}" y="${inset}" width="${iw}" height="${ih}" rx="${r}" ry="${r}" fill="#fff"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shape}</svg>`);
}

/** kinds that are often drawn on a flat colour, whose box can lose that colour */
const CLEARABLE: ReadObject['kind'][] = ['logo', 'decoration', 'badge'];

/** the colour most of a piece is, and how much of it: a flat box is mostly one colour */
function dominant(px: Buffer, channels: number) {
  const count = new Map<number, { n: number; rgb: number[] }>();
  let total = 0;
  for (let i = 0; i < px.length; i += channels * 3) {
    if (channels === 4 && px[i + 3] < 128) continue;
    total++;
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    const c = count.get(key) ?? count.set(key, { n: 0, rgb: [0, 0, 0] }).get(key)!;
    c.n++;
    c.rgb = c.rgb.map((v, k) => v + px[i + k]);
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return top && total ? { rgb: top.rgb.map((v) => Math.round(v / top.n)), share: top.n / total } : null;
}

/** a box this much one colour counts as flat, and its texts are painted over in that colour */
const FLAT_SHARE = 0.35;
/** the edge band checked for something lying over the object, as a share of its shorter side */
const BAND = 0.07;
const SECTORS = 24;
/** how far (RGB distance) a part of the edge may differ from the rest of it */
const EDGE_DIFF = 45;

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Whether something in the picture lies over this object (a bottle standing in front of a circle). A flat object's
 * edge is the same all the way round, whatever its frame; the edge band is split into sectors around the middle and
 * a run of sectors unlike the rest means part of it is covered. Cutting such an object out would take a piece of what
 * covers it along, and leave a gap in it.
 */
async function covered(o: ReadObject, rgba: Buffer, w: number, h: number, texts: Rect[]) {
  const d = Math.max(3, Math.round(Math.min(w, h) * BAND));
  const [outer, inner] = await Promise.all([maskOf(o, w, h), maskOf(o, w, h, d)].map((m) => sharp(m).extractChannel(3).raw().toBuffer()));
  const sums = Array.from({ length: SECTORS }, () => ({ n: 0, rgb: [0, 0, 0] }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (outer[p] < 128 || inner[p] >= 128) continue;
      // the texts' own letters may touch the edge; they are not something lying over it
      if (texts.some((r) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height)) continue;
      const a = Math.atan2(y - h / 2, x - w / 2);
      const s = sums[Math.min(SECTORS - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * SECTORS))];
      s.n++;
      for (let k = 0; k < 3; k++) s.rgb[k] += rgba[p * 4 + k];
    }
  }
  const means = sums.filter((s) => s.n > 8).map((s) => s.rgb.map((v) => v / s.n));
  if (means.length < SECTORS / 2) return false;
  const median = [0, 1, 2].map((k) => means.map((m) => m[k]).sort((a, b) => a - b)[means.length >> 1]);
  const off = means.filter((m) => Math.hypot(m[0] - median[0], m[1] - median[1], m[2] - median[2]) > EDGE_DIFF).length;
  return off >= 2;
}

/**
 * Each object cut out of the picture along its outline, without the texts lying on it, which come back as live text
 * over it. A flat box (most of it one colour) is cut from the original with its texts painted over in its own colour,
 * so it comes out clean; anything else is cut from `textless`, the picture with its texts wiped. A flat object that
 * something else in the picture lies over stays in the picture: only its texts come out (see covered).
 */
export async function cutObjects(original: Buffer, textless: Buffer, objects: ReadObject[], texts: ReadText[]): Promise<CutObject[]> {
  const { width = 0, height = 0 } = await sharp(textless).metadata();
  const source = await sharp(original).rotate().resize(width, height, { fit: 'fill' }).toBuffer();
  const out: CutObject[] = [];
  for (const o of objects) {
    const left = Math.max(0, Math.floor((o.x / 100) * width));
    const top = Math.max(0, Math.floor((o.y / 100) * height));
    const w = Math.min(width - left, Math.ceil((o.w / 100) * width));
    const h = Math.min(height - top, Math.ceil((o.h / 100) * height));
    if (w < 4 || h < 4) continue;
    // the texts on this object, as rectangles inside its box
    const pad = Math.max(2, Math.round(Math.min(width, height) * 0.004));
    const over = texts.flatMap((t) => {
      const l = Math.max(left, Math.floor((t.x / 100) * width) - pad);
      const tp = Math.max(top, Math.floor((t.y / 100) * height) - pad);
      const r = Math.min(left + w, Math.ceil(((t.x + t.w) / 100) * width) + pad);
      const b = Math.min(top + h, Math.ceil(((t.y + t.h) / 100) * height) + pad);
      return r - l > 1 && b - tp > 1 ? [{ left: l - left, top: tp - top, width: r - l, height: b - tp }] : [];
    });
    // the object as it is in the picture, inside its outline
    const inside = await sharp(source).extract({ left, top, width: w, height: h }).ensureAlpha().composite([{ input: maskOf(o, w, h), blend: 'dest-in' }]).raw().toBuffer();
    const flat = dominant(inside, 4);
    const isFlat = !!flat && flat.share >= FLAT_SHARE;
    if (isFlat && (await covered(o, inside, w, h, over))) continue;
    const base =
      isFlat && over.length
        ? sharp(source)
            .extract({ left, top, width: w, height: h })
            .composite(over.map((r) => ({ input: { create: { width: r.width, height: r.height, channels: 3 as const, background: { r: flat.rgb[0], g: flat.rgb[1], b: flat.rgb[2] } } }, left: r.left, top: r.top })))
        : sharp(textless).extract({ left, top, width: w, height: h });
    const flattened = await base.png().toBuffer();
    let piece = await sharp(flattened).ensureAlpha().composite([{ input: maskOf(o, w, h), blend: 'dest-in' }]).raw().toBuffer();
    if (CLEARABLE.includes(o.kind) && o.shape === 'rect') {
      const cleared = clearFlatBackground(piece, w, h);
      if (cleared) piece = Buffer.from(cleared.buffer);
    }
    const png = await sharp(piece, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    out.push({ object: o, png, width: w, height: h });
  }
  return out;
}
