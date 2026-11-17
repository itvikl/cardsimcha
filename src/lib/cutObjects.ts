import sharp from 'sharp';
import type { ReadObject, ReadText } from './agent/importDesign';
import { clearFlatBackground } from './removeBackground';

/** a cut-out object: a PNG with see-through corners, its size in pixels, and where it stood (percent of the picture) */
export type CutObject = { object: ReadObject; png: Buffer; width: number; height: number };

/** the object's outline over its box, white where it is and clear elsewhere */
function maskOf(o: ReadObject, w: number, h: number) {
  const short = Math.min(w, h);
  const r = o.shape === 'pill' ? short / 2 : o.shape === 'rounded' ? (o.corner / 100) * short : 0;
  const shape = o.shape === 'ellipse' ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#fff"/>` : `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`;
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

/**
 * Each object cut out of the picture along its outline, without the texts lying on it, which come back as live text
 * over it. A flat box (most of it one colour) is cut from the original with its texts painted over in its own colour,
 * so it comes out clean; anything else is cut from `textless`, the picture with its texts wiped.
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
    const raw = await sharp(source).extract({ left, top, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
    const flat = over.length ? dominant(raw.data, raw.info.channels) : null;
    const base =
      flat && flat.share >= FLAT_SHARE
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
