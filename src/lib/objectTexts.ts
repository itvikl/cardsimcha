import sharp from 'sharp';
import type { ReadObject, ReadText } from './agent/importDesign';

type Box = { left: number; top: number; w: number; h: number };

/** the object's outline over a w×h box, white where it is and clear elsewhere; `inset` draws it that many pixels in (out, when below 0) */
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

/** an object this much one colour counts as flat, and its texts' letters are painted over in that colour */
const FLAT_SHARE = 0.35;
/** an object's box in pixels of a width×height picture */
function boxOf(o: ReadObject, width: number, height: number): Box {
  const left = Math.max(0, Math.floor((o.x / 100) * width));
  const top = Math.max(0, Math.floor((o.y / 100) * height));
  return { left, top, w: Math.min(width - left, Math.ceil((o.w / 100) * width)), h: Math.min(height - top, Math.ceil((o.h / 100) * height)) };
}

/** the object's own colour when it is flat (most of what is inside its outline one colour), else null */
async function flatColour(o: ReadObject, picture: Buffer, b: Box) {
  const inside = await sharp(picture).extract({ left: b.left, top: b.top, width: b.w, height: b.h }).ensureAlpha().composite([{ input: maskOf(o, b.w, b.h), blend: 'dest-in' }]).raw().toBuffer();
  const flat = dominant(inside, 4);
  return flat && flat.share >= FLAT_SHARE ? flat.rgb : null;
}

/** whether a text's middle stands in the box */
const standsIn = (t: ReadText, b: Box, width: number, height: number) => {
  const cx = ((t.x + t.w / 2) / 100) * width;
  const cy = ((t.y + t.h / 2) / 100) * height;
  return cx > b.left && cx < b.left + b.w && cy > b.top && cy < b.top + b.h;
};

/**
 * The texts that stand on a flat object (a pill, a round badge, a box mostly of one colour), wiped from the picture
 * by their letters only, in the object's colour (see paintLetters): the object, its edge and whatever lies over it
 * (a bottle standing in front of a badge) stay exactly as they were. The objects themselves stay in the picture; a
 * text standing on two goes with the smaller. Gives the picture and the texts it wiped, by index; the rest are left to
 * the general wipe (importClean), which reads a light object's edge on a dark photo as ink and spreads it.
 */
export async function wipeOnObjects(picture: Buffer, objects: ReadObject[], texts: ReadText[]): Promise<{ picture: Buffer; texts: Set<number> }> {
  const { data, info } = await sharp(picture).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const wiped = new Set<number>();
  for (const o of [...objects].sort((a, b) => a.w * a.h - b.w * b.h)) {
    const b = boxOf(o, width, height);
    if (b.w < 4 || b.h < 4) continue;
    const own = texts.flatMap((t, i) => (!wiped.has(i) && standsIn(t, b, width, height) ? [i] : []));
    if (!own.length) continue;
    const rgb = await flatColour(o, picture, b);
    if (!rgb) continue;
    await paintLetters(data, width, height, o, b, rgb, own.map((i) => texts[i]));
    own.forEach((i) => wiped.add(i));
  }
  if (!wiped.size) return { picture, texts: wiped };
  return { picture: await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer(), texts: wiped };
}

/**
 * What lies over the object, by the colours that are neither its own nor its letters' (the highlights on a bottle's
 * glass): grouped by touching, the groups bigger than a speck, and around them a stroke's width, which takes in the
 * dark glass between the highlights, as dark as the letters.
 */
function foreign(w: number, h: number, shape: Buffer, line: number, isForeign: (x: number, y: number) => boolean) {
  const mark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (shape[y * w + x] >= 128 && isForeign(x, y)) mark[y * w + x] = 1;
  const big = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const least = (line * 0.25) ** 2;
  for (let start = 0; start < w * h; start++) {
    if (!mark[start] || seen[start]) continue;
    const group = [start];
    seen[start] = 1;
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (mark[q] && !seen[q]) {
            seen[q] = 1;
            group.push(q);
          }
        }
      }
    }
    if (group.length > least) for (const p of group) big[p] = 1;
  }
  // around them, by rows then columns (a square of side 2r+1)
  const r = Math.max(3, Math.round(line * 0.12));
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -Infinity;
    for (let x = 0; x < w; x++) if (big[y * w + x]) last = x; else if (x - last <= r) rows[y * w + x] = 1;
    last = Infinity;
    for (let x = w - 1; x >= 0; x--) if (big[y * w + x]) { last = x; rows[y * w + x] = 1; } else if (last - x <= r) rows[y * w + x] = 1;
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -Infinity;
    for (let y = 0; y < h; y++) if (rows[y * w + x]) { last = y; out[y * w + x] = 1; } else if (y - last <= r) out[y * w + x] = 1;
    last = Infinity;
    for (let y = h - 1; y >= 0; y--) if (rows[y * w + x]) last = y; else if (last - y <= r) out[y * w + x] = 1;
  }
  return out;
}

/** how far (RGB) a colour lies from the segment between two others: a letter's soft edge mixes its ink and its ground */
function offLine(c: number[], a: number[], b: number[]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1] + (c[2] - a[2]) * d[2]) / len));
  return Math.hypot(c[0] - a[0] - t * d[0], c[1] - a[1] - t * d[1], c[2] - a[2] - t * d[2]);
}

/** how near (RGB) a pixel must lie to the line between a text's colour and the object's to count as its letters */
const ON_LETTERS = 24;

/**
 * Paints over the letters of `texts` in the object's colour, in the full picture's pixels `data`. A letter pixel is
 * inside the outline and near the text's box, and its colour lies between the text's (or white, or black) and the
 * object's (a stroke or its soft edge), and it isn't part of something lying over the object (the dark neck of a bottle). The test runs over the
 * whole outline, so what lies over it is seen whole even where the text's box cuts through it.
 */
async function paintLetters(data: Buffer, width: number, height: number, o: ReadObject, b: Box, colour: number[], texts: ReadText[]) {
  const { left, top, w, h } = b;
  // a little past the outline the model measured, which often falls a little inside the object's own edge
  const shape = await sharp(maskOf(o, w, h, -Math.round(Math.min(w, h) * 0.03))).extractChannel(3).raw().toBuffer();
  const rgbAt = (x: number, y: number) => {
    const i = ((top + y) * width + left + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const dist = (a: number[], c: number[]) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  const pad = Math.max(2, Math.round(Math.min(width, height) * 0.004));
  const letter = new Uint8Array(w * h);
  for (const t of texts) {
    // the text's colour, and white or black where they stand out on the object: one block can mix colours (a white
    // line over a cream one) and the model gives it one
    const inks = [[1, 3, 5].map((i) => parseInt(t.color.slice(i, i + 2), 16)), ...[[255, 255, 255], [0, 0, 0]].filter((c) => dist(c, colour) > 150)];
    const off = (c: number[]) => Math.min(...inks.map((ink) => offLine(c, colour, ink)));
    const line = Math.max(4, ((t.h / 100) * height) / Math.max(1, t.text.split('\n').length));
    // a box measured a little small leaves letters out; only letter-coloured pixels inside the object are painted, so
    // a margin of a third of a line costs nothing
    const margin = pad + Math.round(line / 3);
    const x0 = Math.max(0, Math.floor((t.x / 100) * width) - left - margin);
    const y0 = Math.max(0, Math.floor((t.y / 100) * height) - top - margin);
    const x1 = Math.min(w, Math.ceil(((t.x + t.w) / 100) * width) - left + margin);
    const y1 = Math.min(h, Math.ceil(((t.y + t.h) / 100) * height) - top + margin);
    const like = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (shape[p] < 128) continue;
        const c = rgbAt(x, y);
        if (dist(c, colour) > 12 && off(c) < ON_LETTERS) like[p] = 1;
      }
    }
    // Something lying over the object, seen line by line: a letter fills part of a line's height and is a stroke
    // wide, while the neck of a bottle fills nearly all of it across a run of columns wider than any stroke.
    const lines = Math.max(1, t.text.split('\n').length);
    const over = foreign(w, h, shape, line, (x, y) => {
      const c = rgbAt(x, y);
      return dist(c, colour) > 12 && off(c) > ON_LETTERS * 1.5;
    });
    const run = Math.max(3, Math.round(line * 0.18));
    for (let n = 0; n < lines; n++) {
      const ly0 = Math.round(y0 + (n * (y1 - y0)) / lines);
      const ly1 = Math.round(y0 + ((n + 1) * (y1 - y0)) / lines);
      const full: boolean[] = [];
      for (let x = 0; x < w; x++) {
        let k = 0;
        for (let y = ly0; y < ly1; y++) k += like[y * w + x];
        full.push(k >= (ly1 - ly0) * 0.8);
      }
      for (let x = 0; x < w; ) {
        if (!full[x]) {
          x++;
          continue;
        }
        let e = x;
        while (e < w && full[e]) e++;
        if (e - x >= run) for (let y = Math.max(0, ly0 - 2); y < Math.min(h, ly1 + 2); y++) for (let xx = Math.max(0, x - 2); xx < Math.min(w, e + 2); xx++) over[y * w + xx] = 1;
        x = e;
      }
    }
    // pixels of that colour grouped by touching; a group that is big and fills most of its own box lies over the object
    const seen = new Uint8Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (!like[start] || seen[start]) continue;
      const group: number[] = [];
      const stack = [start];
      seen[start] = 1;
      let gx0 = w;
      let gy0 = h;
      let gx1 = 0;
      let gy1 = 0;
      while (stack.length) {
        const p = stack.pop()!;
        group.push(p);
        const x = p % w;
        const y = (p / w) | 0;
        gx0 = Math.min(gx0, x);
        gx1 = Math.max(gx1, x);
        gy0 = Math.min(gy0, y);
        gy1 = Math.max(gy1, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (like[q] && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      if (group.length > line * line * 0.5 && group.length / ((gx1 - gx0 + 1) * (gy1 - gy0 + 1)) > 0.45) continue;
      for (const p of group) {
        const x = p % w;
        const y = (p / w) | 0;
        if (x >= x0 && x < x1 && y >= y0 && y < y1 && !over[p]) letter[p] = 1;
      }
    }
  }
  // a pixel or two around each letter pixel, for its soft edge
  const grow = Math.max(1, Math.round(Math.min(width, height) / 1500));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (shape[y * w + x] < 128) continue;
      let near = false;
      for (let dy = -grow; dy <= grow && !near; dy++) {
        for (let dx = -grow; dx <= grow && !near; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          near = yy >= 0 && yy < h && xx >= 0 && xx < w && letter[yy * w + xx] === 1;
        }
      }
      if (!near) continue;
      const i = ((top + y) * width + left + x) * 3;
      for (let k = 0; k < 3; k++) data[i + k] = colour[k];
    }
  }
}
