import sharp from 'sharp';
import type { ReadText } from './agent/importDesign';

/** the colour most of the pixels are, counted in bins of 8 per channel */
function dominant(px: Buffer) {
  const count = new Map<number, { n: number; rgb: number[] }>();
  for (let i = 0; i < px.length; i += 3) {
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    const c = count.get(key) ?? count.set(key, { n: 0, rgb: [0, 0, 0] }).get(key)!;
    c.n++;
    c.rgb = c.rgb.map((v, k) => v + px[i + k]);
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n)[0];
  return top ? top.rgb.map((v) => Math.round(v / top.n)) : null;
}

/**
 * A text stands on a flat ground when this share of its box is within FLAT_NEAR of one colour. Measured on a wine-shop
 * ad: a round badge 0.55, a seal 0.73, a dark pill 0.46, while texts over the photograph come to about 0.18.
 */
const FLAT_SHARE = 0.45;
const FLAT_NEAR = 12;
/** how near (RGB) a pixel must be to the ground's colour to be part of it */
const GROUND = 28;
/** below this share of the text's box reaching the window's edge, what reaches it is letters (see wipeOnGround) */
const LETTERS_REACH = 0.1;

/**
 * Wipes one text standing on a flat ground (a pill, a round badge, a plain page), found from the picture itself, in
 * `data`; false when the ground under it is not flat (a photograph). The ground is every pixel near its colour reached
 * from the text's box, in a window two lines wider; what isn't ground and reaches the window's edge lies beside it or
 * over it (the photo, a bottle standing in front of a badge) and stays as it was. What isn't ground and is enclosed by
 * it is a hole in it: the letters. Each hole lying mostly in the text's box, with a pixel or two round it for the
 * letters' soft edge, takes the ground's colour. The ground's own edge is never touched.
 */
function wipeOnGround(data: Buffer, width: number, height: number, t: ReadText): boolean {
  const x0 = Math.max(0, Math.floor((t.x / 100) * width));
  const y0 = Math.max(0, Math.floor((t.y / 100) * height));
  const x1 = Math.min(width, Math.ceil(((t.x + t.w) / 100) * width));
  const y1 = Math.min(height, Math.ceil(((t.y + t.h) / 100) * height));
  if (x1 - x0 < 4 || y1 - y0 < 4) return false;
  // The ground is judged in the middle of the text only: the model's box for a slanted or loosely read text reaches
  // past its ground (over a bottle, onto the photo beside a badge), and the whole box would fail a badge's text.
  const mx0 = Math.round(x0 + (x1 - x0) * 0.25);
  const mx1 = Math.round(x1 - (x1 - x0) * 0.25);
  const my0 = Math.round(y0 + (y1 - y0) * 0.2);
  const my1 = Math.round(y1 - (y1 - y0) * 0.2);
  if (mx1 - mx0 < 2 || my1 - my0 < 2) return false;
  const middle = Buffer.alloc((mx1 - mx0) * (my1 - my0) * 3);
  for (let y = my0; y < my1; y++) data.copy(middle, (y - my0) * (mx1 - mx0) * 3, (y * width + mx0) * 3, (y * width + mx1) * 3);
  const colour = dominant(middle);
  if (!colour) return false;
  const dist = (i: number) => Math.hypot(data[i] - colour[0], data[i + 1] - colour[1], data[i + 2] - colour[2]);
  let flat = 0;
  for (let y = my0; y < my1; y++) for (let x = mx0; x < mx1; x++) if (dist((y * width + x) * 3) < FLAT_NEAR) flat++;
  if (flat / ((mx1 - mx0) * (my1 - my0)) < FLAT_SHARE) return false;

  const line = (y1 - y0) / Math.max(1, t.text.split('\n').length);
  const m = Math.round(line * 2);
  const left = Math.max(0, x0 - m);
  const top = Math.max(0, y0 - m);
  const w = Math.min(width, x1 + m) - left;
  const h = Math.min(height, y1 + m) - top;
  const at = (p: number) => ((top + ((p / w) | 0)) * width + left + (p % w)) * 3;
  /** marks what `ok` lets it reach from `starts`, one neighbour at a time (`from` is the pixel it came from) */
  const flood = (mark: Uint8Array, starts: number[], ok: (q: number, from: number) => boolean) => {
    const stack = starts.filter((p) => !mark[p] && ok(p, p));
    for (const p of stack) mark[p] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !mark[q] && ok(q, p)) {
          mark[q] = 1;
          stack.push(q);
        }
      }
    }
  };
  const ground = new Uint8Array(w * h);
  const inside: number[] = [];
  for (let y = y0 - top; y < y1 - top; y++) for (let x = x0 - left; x < x1 - left; x++) inside.push(y * w + x);
  flood(ground, inside, (q) => dist(at(q)) < GROUND);
  const beside = new Uint8Array(w * h);
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) edge.push(y * w, y * w + w - 1);
  flood(beside, edge, (p) => !ground[p]);

  // Only a little of the text's box reaching the edge is letters touching something lighter or darker beside the text
  // (a glow), not something lying over the ground (a bottle takes 0.4 of a badge's text box, such letters 0.04):
  // inside the box, they are letters too.
  let reach = 0;
  for (let y = y0 - top; y < y1 - top; y++) for (let x = x0 - left; x < x1 - left; x++) reach += beside[y * w + x];
  if (reach / ((x1 - x0) * (y1 - y0)) < LETTERS_REACH) for (let y = y0 - top; y < y1 - top; y++) for (let x = x0 - left; x < x1 - left; x++) beside[y * w + x] = 0;
  // the holes, each painted when most of it lies in the text's box (with a third of a line round it)
  const pad = Math.round(line / 3);
  const inText = (p: number) => {
    const x = (p % w) + left;
    const y = ((p / w) | 0) + top;
    return x >= x0 - pad && x < x1 + pad && y >= y0 - pad && y < y1 + pad;
  };
  const paint = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (ground[p] || beside[p] || seen[p]) continue;
    const hole = [p];
    seen[p] = 1;
    for (let k = 0; k < hole.length; k++) {
      const q = hole[k];
      const x = q % w;
      const y = (q / w) | 0;
      for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1]) {
        if (r >= 0 && !seen[r] && !ground[r] && !beside[r]) {
          seen[r] = 1;
          hole.push(r);
        }
      }
    }
    if (hole.filter(inText).length * 2 >= hole.length) for (const q of hole) paint[q] = 1;
  }
  // a few pixels round each letter, for its soft edge
  const grow = Math.max(2, Math.round(Math.min(width, height) / 1000));
  const fill = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (beside[p]) continue;
      for (let dy = -grow; dy <= grow && !fill[p]; dy++) {
        for (let dx = -grow; dx <= grow && !fill[p]; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && paint[yy * w + xx]) fill[p] = 1;
        }
      }
    }
  }
  for (let p = 0; p < w * h; p++) {
    if (!fill[p]) continue;
    const i = at(p);
    for (let k = 0; k < 3; k++) data[i + k] = colour[k];
  }
  return true;
}

/**
 * The texts that stand on a flat ground (a pill, a round badge, a plain page), wiped from the picture without touching
 * the ground's edge or whatever lies over it (see wipeOnGround). Gives the picture and the texts it wiped, by index;
 * the rest, on photographs, are left to the general wipe (importClean), which reads a light shape's edge on a dark
 * photo as ink and spreads it.
 */
export async function wipeOnFlat(picture: Buffer, texts: ReadText[]): Promise<{ picture: Buffer; texts: Set<number> }> {
  const { data, info } = await sharp(picture).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const wiped = new Set<number>();
  for (const [i, t] of texts.entries()) if (wipeOnGround(data, info.width, info.height, t)) wiped.add(i);
  if (!wiped.size) return { picture, texts: wiped };
  return { picture: await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer(), texts: wiped };
}
