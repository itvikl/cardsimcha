/** The drawing without its fully transparent margins; null when nothing is drawn at all. */
export function trimTransparent(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const { width, height } = source;
  const { data } = source.getContext('2d')!.getImageData(0, 0, width, height);
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return null;
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')!.drawImage(source, -left, -top);
  return out;
}
