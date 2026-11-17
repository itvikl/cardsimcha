import sharp from 'sharp';

/**
 * The pixel side of turning a finished design into a template: the precision steps of the ad-import tool
 * (examples/ad-import/adimport.py, Zvi), in TypeScript over sharp's raw pixels so the server needs no OpenCV.
 *  1. tighten: each box the model measured snaps to the text's actual ink, growing along the line while more letters
 *     follow, so the new text lands where the old one was
 *  2. colour: the text's colour is read from its strongest ink pixels, not guessed
 *  3. erase: only the ink is repainted (widened a little for anti-aliasing), filled in from the clean pixels around it,
 *     so the paper, a gradient or an ornament next to the letters stays as it was
 * Boxes are in percent of the picture, as the model gives them.
 */

export type PctBox = { x: number; y: number; w: number; h: number };
type PxBox = [number, number, number, number]; // x0, y0, x1, y1, end exclusive

/** a pixel stands out from the local background by more than this (0-255 grey) */
const INK = 22;

type Img = { data: Buffer; width: number; height: number; gray: Float32Array };

const clampBox = (b: PxBox, W: number, H: number): PxBox => [
  Math.max(0, Math.min(W, Math.round(b[0]))),
  Math.max(0, Math.min(H, Math.round(b[1]))),
  Math.max(0, Math.min(W, Math.round(b[2]))),
  Math.max(0, Math.min(H, Math.round(b[3]))),
];

function median(values: number[]) {
  if (!values.length) return 0;
  const s = values.sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * The local background of a region, per pixel: the median grey of a grid of cells, blended between cell centres.
 * Text covers less than half of a cell a little taller than its lines, so the median is the paper under it.
 */
function background(img: Img, b: PxBox, cell: number): Float32Array {
  const [x0, y0, x1, y1] = b;
  const w = x1 - x0;
  const h = y1 - y0;
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  const grid = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx0 = x0 + Math.floor((c * w) / cols);
      const cx1 = x0 + Math.floor(((c + 1) * w) / cols);
      const cy0 = y0 + Math.floor((r * h) / rows);
      const cy1 = y0 + Math.floor(((r + 1) * h) / rows);
      const vals: number[] = [];
      const step = Math.max(1, Math.floor(Math.sqrt(((cx1 - cx0) * (cy1 - cy0)) / 900)));
      for (let y = cy0; y < cy1; y += step) for (let x = cx0; x < cx1; x += step) vals.push(img.gray[y * img.width + x]);
      grid[r * cols + c] = median(vals);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(rows - 1, Math.max(0, (y + 0.5) / (h / rows) - 0.5));
    const r0 = Math.floor(gy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const ty = gy - r0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(cols - 1, Math.max(0, (x + 0.5) / (w / cols) - 0.5));
      const c0 = Math.floor(gx);
      const c1 = Math.min(cols - 1, c0 + 1);
      const tx = gx - c0;
      const top = grid[r0 * cols + c0] * (1 - tx) + grid[r0 * cols + c1] * tx;
      const bot = grid[r1 * cols + c0] * (1 - tx) + grid[r1 * cols + c1] * tx;
      out[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}

/** how far each pixel of a region stands out from its background */
function inkDiff(img: Img, b: PxBox, cell: number): Float32Array {
  const [x0, y0, x1, y1] = b;
  const w = x1 - x0;
  const bg = background(img, b, cell);
  const d = new Float32Array(w * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[(y - y0) * w + (x - x0)] = Math.abs(img.gray[y * img.width + x] - bg[(y - y0) * w + (x - x0)]);
  return d;
}

/**
 * A rough box fitted to the text's ink: rows with ink set the top and bottom; along the line it shrinks to the
 * letters and grows while more letters follow within `gap` (wider than a word space ends the line).
 */
function tighten(img: Img, box: PxBox, s: number): PxBox {
  const W = img.width;
  const H = img.height;
  const pad = Math.round(4 * s);
  const grow = Math.round(80 * s);
  const gap = Math.round(16 * s);
  const b = clampBox([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], W, H);
  const bw = b[2] - b[0];
  const bh = b[3] - b[1];
  if (bw < 3 || bh < 3) return box;
  const cell = Math.max(12, Math.round(bh * 1.6));
  let d = inkDiff(img, b, cell);
  const rows: number[] = [];
  for (let y = 0; y < bh; y++) {
    let n = 0;
    for (let x = 0; x < bw; x++) if (d[y * bw + x] > INK) n++;
    if (n >= 2) rows.push(y);
  }
  if (!rows.length) return box;
  const ty0 = b[1] + rows[0];
  const ty1 = b[1] + rows[rows.length - 1] + 1;
  const sx0 = Math.max(0, box[0] - grow);
  const sx1 = Math.min(W, box[2] + grow);
  const sw = sx1 - sx0;
  const th = ty1 - ty0;
  d = inkDiff(img, [sx0, ty0, sx1, ty1], Math.max(12, Math.round(th * 1.6)));
  const on: boolean[] = [];
  for (let x = 0; x < sw; x++) {
    let n = 0;
    for (let y = 0; y < th; y++) if (d[y * sw + x] > INK) n++;
    on.push(n >= 2);
  }
  let lo = -1;
  let hi = -1;
  for (let x = Math.max(0, box[0] - sx0); x < Math.min(sw, box[2] - sx0); x++) {
    if (!on[x]) continue;
    if (lo < 0) lo = x;
    hi = x;
  }
  if (lo < 0) return box;
  // walk outwards: any ink within `gap` continues the line, but only a little past the model's box: over a photograph
  // whatever stands beside the text (a bottle, an arrow, another title) reads as ink, and following it moved the text
  // off its place and wiped the neighbour with it
  const reach = Math.max(gap, Math.round((box[2] - box[0]) * 0.15));
  const minX = Math.max(0, box[0] - sx0 - reach);
  const maxX = Math.min(sw - 1, box[2] - sx0 - 1 + reach);
  for (let i = lo - 1; i >= minX && lo - i <= gap; i--) if (on[i]) lo = i;
  for (let i = hi + 1; i <= maxX && i - hi <= gap; i++) if (on[i]) hi = i;
  return [sx0 + lo, ty0, sx0 + hi + 1, ty1];
}

/** the text's colour: the median of its strongest ink pixels (anti-aliased edges are left out) */
function sampleColor(img: Img, b: PxBox): string | null {
  const [x0, y0, x1, y1] = b;
  const w = x1 - x0;
  if (w < 2 || y1 - y0 < 2) return null;
  const d = inkDiff(img, b, Math.max(12, Math.round((y1 - y0) * 1.6)));
  const inked: number[] = [];
  for (let i = 0; i < d.length; i++) if (d[i] > INK) inked.push(i);
  if (inked.length < 10) return null;
  const cut = median(inked.map((i) => d[i]).concat()) * 0.98;
  const strong = inked.filter((i) => d[i] >= cut);
  const ch = (k: number) => median(strong.map((i) => img.data[((y0 + Math.floor(i / w)) * img.width + x0 + (i % w)) * 3 + k]));
  return '#' + [0, 1, 2].map((k) => ch(k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Fills the masked pixels from the outside in: each round, every masked pixel touching known ones takes their average,
 * then the filled area is smoothed twice so no streaks show. A light inpainting that keeps gradients smooth.
 */
function fill(img: Img, mask: Uint8Array) {
  const { width: W, height: H, data } = img;
  const known = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) known[i] = mask[i] ? 0 : 1;
  const todo: number[] = [];
  for (let i = 0; i < W * H; i++) if (mask[i]) todo.push(i);
  const filled = todo.slice();
  let left = todo;
  while (left.length) {
    const next: number[] = [];
    const set: [number, number, number, number][] = [];
    for (const i of left) {
      const x = i % W;
      const y = (i / W) | 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W || (!dx && !dy)) continue;
          const j = yy * W + xx;
          if (!known[j]) continue;
          r += data[j * 3];
          g += data[j * 3 + 1];
          b += data[j * 3 + 2];
          n++;
        }
      }
      if (n) set.push([i, r / n, g / n, b / n]);
      else next.push(i);
    }
    if (!set.length) break;
    for (const [i, r, g, b] of set) {
      data[i * 3] = r;
      data[i * 3 + 1] = g;
      data[i * 3 + 2] = b;
      known[i] = 1;
    }
    left = next;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const i of filled) {
      const x = i % W;
      const y = (i / W) | 0;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += data[((y + dy) * W + x + dx) * 3 + k];
        data[i * 3 + k] = s / 9;
      }
    }
  }
}

export type Refined = PctBox & { color: string | null };

/**
 * The picture with its texts' ink repainted, and each text's box fitted to its ink (with its sampled colour), in the
 * order given. `rough` counts boxes standing on a busy background, where the repaint may show.
 */
export async function cleanDesign(image: Buffer, boxes: PctBox[]): Promise<{ data: Buffer; refined: Refined[]; rough: number }> {
  const { data, info } = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = data[i * 3] * 0.299 + data[i * 3 + 1] * 0.587 + data[i * 3 + 2] * 0.114;
  const img: Img = { data, width: W, height: H, gray };
  // the tool's pixel distances were tuned on a picture about 1,100 px across
  const s = Math.max(W, H) / 1600;

  const mask = new Uint8Array(W * H);
  const refined: Refined[] = [];
  let rough = 0;
  for (const b of boxes) {
    const roughBox: PxBox = clampBox([(b.x / 100) * W, (b.y / 100) * H, ((b.x + b.w) / 100) * W, ((b.y + b.h) / 100) * H], W, H);
    const tight = tighten(img, roughBox, s);
    refined.push({ x: (tight[0] / W) * 100, y: (tight[1] / H) * 100, w: ((tight[2] - tight[0]) / W) * 100, h: ((tight[3] - tight[1]) / H) * 100, color: sampleColor(img, tight) });

    // erase inside the union of the rough and the tight box (faint letter edges can fall outside the tight one)
    const m = Math.round(8 * s);
    const region = clampBox(
      [Math.min(roughBox[0], tight[0]) - m, Math.min(roughBox[1], tight[1]) - m, Math.max(roughBox[2], tight[2]) + m, Math.max(roughBox[3], tight[3]) + m],
      W,
      H,
    );
    const rw = region[2] - region[0];
    const rh = region[3] - region[1];
    if (rw < 2 || rh < 2) continue;
    const d = inkDiff(img, region, Math.max(12, Math.round((tight[3] - tight[1]) * 1.6)));
    // widened by a few pixels each way, as the tool's 7x7 dilation, so anti-aliased edges go too
    const r = Math.max(2, Math.round(3 * s));
    let inked = 0;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (d[y * rw + x] <= INK) continue;
        inked++;
        for (let dy = -r; dy <= r; dy++) {
          const yy = region[1] + y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = region[0] + x + dx;
            if (xx >= 0 && xx < W) mask[yy * W + xx] = 1;
          }
        }
      }
    }
    // more than half the region standing out means the background itself is busy (a photo, a pattern)
    if (inked > rw * rh * 0.5) rough++;
  }
  fill(img, mask);
  const out = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return { data: out, refined, rough };
}
