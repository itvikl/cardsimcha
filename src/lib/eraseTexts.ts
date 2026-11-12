import sharp, { type OverlayOptions } from 'sharp';

export type Box = { x: number; y: number; w: number; h: number };

/** how far the colours around a box may spread for it to count as standing on a flat background */
const FLAT = 14;

/**
 * The picture with these boxes (in percent of it) wiped: each is filled from what surrounds it, so a flat or softly
 * changing background comes out clean. Over a photograph that's a smudge, so it also says how many boxes stood on
 * something that wasn't flat, for the admin to look at.
 */
export async function eraseTexts(image: Buffer, boxes: Box[]): Promise<{ data: Buffer; rough: number }> {
  const base = sharp(image).rotate().removeAlpha();
  const { data: pixels, info } = await base.clone().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pad = Math.max(3, Math.round(Math.min(width, height) * 0.006));
  const patches: OverlayOptions[] = [];
  let rough = 0;

  for (const b of boxes) {
    const left = Math.max(0, Math.floor((b.x / 100) * width) - pad);
    const top = Math.max(0, Math.floor((b.y / 100) * height) - pad);
    const right = Math.min(width, Math.ceil(((b.x + b.w) / 100) * width) + pad);
    const bottom = Math.min(height, Math.ceil(((b.y + b.h) / 100) * height) + pad);
    const w = right - left;
    const h = bottom - top;
    if (w < 2 || h < 2) continue;

    // the ring just outside the box
    const ring: number[][] = [];
    const take = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * channels;
      ring.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    };
    const step = Math.max(1, Math.round(Math.max(w, h) / 80));
    for (let x = left - 2; x < right + 2; x += step) {
      take(x, top - 2);
      take(x, bottom + 1);
    }
    for (let y = top - 2; y < bottom + 2; y += step) {
      take(left - 2, y);
      take(right + 1, y);
    }
    if (!ring.length) continue;

    const mean = [0, 1, 2].map((c) => ring.reduce((sum, p) => sum + p[c], 0) / ring.length);
    const spread = Math.sqrt(ring.reduce((sum, p) => sum + (p[0] - mean[0]) ** 2 + (p[1] - mean[1]) ** 2 + (p[2] - mean[2]) ** 2, 0) / ring.length);
    if (spread > FLAT) rough++;

    // the edges of the box, blended across it: a flat background stays flat and a gradient stays a gradient
    const fill = Buffer.alloc(w * h * 3);
    const edge = (x: number, y: number) => {
      const cx = Math.min(width - 1, Math.max(0, x));
      const cy = Math.min(height - 1, Math.max(0, y));
      const i = (cy * width + cx) * channels;
      return [pixels[i], pixels[i + 1], pixels[i + 2]];
    };
    for (let y = 0; y < h; y++) {
      const fy = h === 1 ? 0 : y / (h - 1);
      for (let x = 0; x < w; x++) {
        const fx = w === 1 ? 0 : x / (w - 1);
        const a = edge(left + x, top - 2);
        const c = edge(left + x, bottom + 1);
        const l = edge(left - 2, top + y);
        const r = edge(right + 1, top + y);
        for (let k = 0; k < 3; k++) fill[(y * w + x) * 3 + k] = ((a[k] * (1 - fy) + c[k] * fy) + (l[k] * (1 - fx) + r[k] * fx)) / 2;
      }
    }
    const patch = await sharp(fill, { raw: { width: w, height: h, channels: 3 } }).blur(Math.max(1.5, Math.min(w, h) / 10)).png().toBuffer();
    patches.push({ input: patch, left, top });
  }
  const data = await base.composite(patches).jpeg({ quality: 92 }).toBuffer();
  return { data, rough };
}
