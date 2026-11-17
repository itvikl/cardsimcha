import sharp from 'sharp';
import type { ReadObject, ReadText } from './agent/importDesign';
import { clearFlatBackground } from './removeBackground';

/** a cut-out object: a PNG with see-through corners, its size in pixels, and where it stood (percent of the picture) */
export type CutObject = { object: ReadObject; png: Buffer; width: number; height: number };

type Box = { left: number; top: number; w: number; h: number };

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
/** the edge band checked for something lying over the object, as a share of its shorter side: thin, so the texts
 * inside it (which keep a margin from the edge) don't count */
const BAND = 0.04;
const SECTORS = 24;
/** how far (RGB distance) a part of the edge may differ from the rest of it */
const EDGE_DIFF = 45;

/** an object's box in pixels of a width×height picture */
function boxOf(o: ReadObject, width: number, height: number): Box {
  const left = Math.max(0, Math.floor((o.x / 100) * width));
  const top = Math.max(0, Math.floor((o.y / 100) * height));
  return { left, top, w: Math.min(width - left, Math.ceil((o.w / 100) * width)), h: Math.min(height - top, Math.ceil((o.h / 100) * height)) };
}

/** the object as it is in the picture inside its outline, and its own colour when it is flat (most of it one colour) */
async function flatColour(o: ReadObject, picture: Buffer, b: Box) {
  const inside = await sharp(picture).extract({ left: b.left, top: b.top, width: b.w, height: b.h }).ensureAlpha().composite([{ input: maskOf(o, b.w, b.h), blend: 'dest-in' }]).raw().toBuffer();
  const flat = dominant(inside, 4);
  return { inside, rgb: flat && flat.share >= FLAT_SHARE ? flat.rgb : null };
}

/**
 * Whether something in the picture lies over this object (a bottle standing in front of a circle). A flat object's
 * edge is the same all the way round, whatever its frame; the edge band is split into sectors around the middle and
 * a run of sectors unlike the rest means part of it is covered. Cutting such an object out would take a piece of what
 * covers it along, and leave a gap in it.
 */
async function covered(o: ReadObject, rgba: Buffer, w: number, h: number) {
  const d = Math.max(3, Math.round(Math.min(w, h) * BAND));
  const [outer, inner] = await Promise.all([maskOf(o, w, h), maskOf(o, w, h, d)].map((m) => sharp(m).extractChannel(3).raw().toBuffer()));
  const sums = Array.from({ length: SECTORS }, () => ({ n: 0, rgb: [0, 0, 0] }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (outer[p] < 128 || inner[p] >= 128) continue;
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

/** whether a text's middle stands in the box */
const standsIn = (t: ReadText, b: Box, width: number, height: number) => {
  const cx = ((t.x + t.w / 2) / 100) * width;
  const cy = ((t.y + t.h / 2) / 100) * height;
  return cx > b.left && cx < b.left + b.w && cy > b.top && cy < b.top + b.h;
};

/** what stays in the picture: the objects, the texts standing on them (by index), and the picture with those texts wiped */
export type Kept = { objects: ReadObject[]; texts: Set<number>; picture: Buffer };

/**
 * Before any text is wiped: a flat object that something else in the picture lies over (a bottle standing in front of
 * a round badge) stays in the picture, since cutting it out would take a piece of what covers it along and leave a gap
 * in it (see covered). The texts on it are wiped here, on the picture as it was: only their letters take the object's
 * colour (see paintLetters), so its edge and what lies over it stay exactly as they were. The general wipe
 * (importClean) is left to the other texts: it reads a light object's edge on a dark photo as ink and spreads it.
 */
export async function keepCovered(picture: Buffer, objects: ReadObject[], texts: ReadText[]): Promise<Kept> {
  const { data, info } = await sharp(picture).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const kept: ReadObject[] = [];
  const on = new Set<number>();
  for (const o of objects) {
    const b = boxOf(o, width, height);
    if (b.w < 4 || b.h < 4) continue;
    const { inside, rgb } = await flatColour(o, picture, b);
    if (!rgb || !(await covered(o, inside, b.w, b.h))) continue;
    kept.push(o);
    const own = texts.flatMap((t, i) => (standsIn(t, b, width, height) ? [i] : []));
    own.forEach((i) => on.add(i));
    if (own.length) await paintLetters(data, width, height, o, b, rgb, own.map((i) => texts[i]));
  }
  if (!kept.length) return { objects: [], texts: on, picture };
  const out = await sharp(data, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  return { objects: kept, texts: on, picture: out };
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
 * inside the outline and the text's box, and its colour lies between the text's and the object's (a stroke or its soft
 * edge), and it isn't part of something lying over the object (the dark neck of a bottle). The test runs over the
 * whole outline, so what lies over it is seen whole even where the text's box cuts through it.
 */
async function paintLetters(data: Buffer, width: number, height: number, o: ReadObject, b: Box, colour: number[], texts: ReadText[]) {
  const { left, top, w, h } = b;
  const shape = await sharp(maskOf(o, w, h)).extractChannel(3).raw().toBuffer();
  const rgbAt = (x: number, y: number) => {
    const i = ((top + y) * width + left + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const dist = (a: number[], c: number[]) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  const pad = Math.max(2, Math.round(Math.min(width, height) * 0.004));
  const letter = new Uint8Array(w * h);
  for (const t of texts) {
    const ink = [1, 3, 5].map((i) => parseInt(t.color.slice(i, i + 2), 16));
    const x0 = Math.max(0, Math.floor((t.x / 100) * width) - left - pad);
    const y0 = Math.max(0, Math.floor((t.y / 100) * height) - top - pad);
    const x1 = Math.min(w, Math.ceil(((t.x + t.w) / 100) * width) - left + pad);
    const y1 = Math.min(h, Math.ceil(((t.y + t.h) / 100) * height) - top + pad);
    const line = Math.max(4, (y1 - y0) / Math.max(1, t.text.split('\n').length));
    const like = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (shape[p] < 128) continue;
        const c = rgbAt(x, y);
        if (dist(c, colour) > 12 && offLine(c, colour, ink) < ON_LETTERS) like[p] = 1;
      }
    }
    // Something lying over the object, seen line by line: a letter fills part of a line's height and is a stroke
    // wide, while the neck of a bottle fills nearly all of it across a run of columns wider than any stroke.
    const lines = Math.max(1, t.text.split('\n').length);
    const over = foreign(w, h, shape, line, (x, y) => {
      const c = rgbAt(x, y);
      return dist(c, colour) > 12 && offLine(c, colour, ink) > ON_LETTERS * 1.5;
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

/**
 * Each object cut out of the picture along its outline, without the texts lying on it, which come back as live text
 * over it. A flat box (most of it one colour) is cut from the original with its texts painted over in its own colour,
 * so it comes out clean; anything else is cut from `textless`, the picture with its texts wiped. Objects that stay in
 * the picture (keepCovered) are not given here.
 */
export async function cutObjects(original: Buffer, textless: Buffer, objects: ReadObject[], texts: ReadText[]): Promise<CutObject[]> {
  const { width = 0, height = 0 } = await sharp(textless).metadata();
  const source = await sharp(original).rotate().resize(width, height, { fit: 'fill' }).toBuffer();
  const out: CutObject[] = [];
  for (const o of objects) {
    const { left, top, w, h } = boxOf(o, width, height);
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
    const flat = (await flatColour(o, source, { left, top, w, h })).rgb;
    const base =
      flat && over.length
        ? sharp(source)
            .extract({ left, top, width: w, height: h })
            .composite(over.map((r) => ({ input: { create: { width: r.width, height: r.height, channels: 3 as const, background: { r: flat[0], g: flat[1], b: flat[2] } } }, left: r.left, top: r.top })))
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
