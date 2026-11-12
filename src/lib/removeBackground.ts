/**
 * Clears a plain background from a picture: the colour around its edges, followed inward until something else starts.
 * It works on a product or a drawing on a flat background, and only there: a photograph's background isn't one colour,
 * and for that it answers null rather than cutting the picture badly.
 */
const TOLERANCE = 30;
/** how much of the edge has to be one colour for it to be a background */
const EDGE_SHARE = 0.6;

export function removeFlatBackground(img: ImageData): ImageData | null {
  const { width: w, height: h, data } = img;
  const at = (x: number, y: number) => (y * w + x) * 4;
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(at(x, 0), at(x, h - 1));
  for (let y = 1; y < h - 1; y++) edge.push(at(0, y), at(w - 1, y));

  // the edge's most common colour, in coarse steps so noise doesn't split it
  const buckets = new Map<number, number[]>();
  let clear = 0;
  for (const i of edge) {
    if (data[i + 3] < 128) {
      clear++;
      continue;
    }
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(i);
  }
  // already see-through: nothing to clear
  if (clear > edge.length / 2) return null;
  const top = [...buckets.values()].reduce((a, b) => (b.length > a.length ? b : a), [] as number[]);
  if (top.length < edge.length * EDGE_SHARE) return null;
  const mean = [0, 1, 2].map((c) => top.reduce((sum, i) => sum + data[i + c], 0) / top.length);
  const distance = (i: number) => Math.hypot(data[i] - mean[0], data[i + 1] - mean[1], data[i + 2] - mean[2]);

  // from the edge inward, through what is close to that colour
  const gone = new Uint8Array(w * h);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (gone[p] || distance(p * 4) > TOLERANCE) return;
    gone[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    visit(x, 0);
    visit(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    visit(0, y);
    visit(w - 1, y);
  }
  let count = 0;
  while (stack.length) {
    const p = stack.pop()!;
    count++;
    const x = p % w;
    const y = (p - x) / w;
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  // it took everything, or next to nothing: this wasn't a background
  if (count > w * h * 0.97 || count < w * h * 0.03) return null;

  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (gone[p]) {
        out[p * 4 + 3] = 0;
        continue;
      }
      // a soft edge: what touches the background and is near its colour fades, so no halo stays around the subject
      const touches = (x > 0 && gone[p - 1]) || (x < w - 1 && gone[p + 1]) || (y > 0 && gone[p - w]) || (y < h - 1 && gone[p + w]);
      if (touches) out[p * 4 + 3] = Math.min(out[p * 4 + 3], Math.round(255 * Math.min(1, Math.max(0.15, (distance(p * 4) - TOLERANCE) / TOLERANCE))));
    }
  }
  return new ImageData(out, w, h);
}
