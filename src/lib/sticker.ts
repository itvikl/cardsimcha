import { heightOf } from './adText';
import type { CanvasDoc, CanvasElement, ImageAsset, ImageElement } from './types';

/** the tag of stickers that suit any design */
export const GENERAL_TAG = 'כללי';

/** Stickers a topic offers first: its own, then the general ones. A search looks through all of them, by name or tag. */
export function stickersFor<T extends Pick<ImageAsset, 'name' | 'tags'>>(all: T[], topic: string | null, search = ''): T[] {
  const q = search.trim();
  if (q) return all.filter((s) => s.name.includes(q) || s.tags?.some((t) => t.includes(q)));
  const own = all.filter((s) => topic && s.tags?.includes(topic));
  return [...own, ...all.filter((s) => s.tags?.includes(GENERAL_TAG) && !own.includes(s))];
}

/** where an element stands, top to bottom */
function span(e: CanvasElement): [number, number] {
  if (e.type === 'text') return [e.y_mm, e.y_mm + heightOf(e.text, e.font.size_pt, e.w_mm)];
  return [e.y_mm, e.y_mm + e.h_mm];
}

/**
 * The design with a sticker in its largest free band, so it doesn't sit on the words. What fills most of the page is its
 * background, not something to keep clear of. With no room for it, a small sticker goes in a top corner.
 */
export function placeSticker<D extends CanvasDoc>(doc: D, sticker: { assetId: string; width: number; height: number; src?: string }): D {
  const { width_mm: pw, height_mm: ph } = doc.page;
  const margin = pw * 0.04;
  const taken = doc.elements
    .filter((e) => e.type === 'text' || e.w_mm * e.h_mm < pw * ph * 0.5)
    .map(span)
    .sort((a, b) => a[0] - b[0]);
  let best: [number, number] = [margin, margin];
  let at = margin;
  for (const [top, bottom] of [...taken, [ph - margin, ph] as [number, number]]) {
    if (top - at > best[1] - best[0]) best = [at, top];
    at = Math.max(at, bottom);
  }
  const room = best[1] - best[0] - margin * 2;
  const ratio = sticker.height / sticker.width;
  let w = Math.min(pw * 0.42, room / ratio);
  let x = (pw - w) / 2;
  let y = best[0] + margin + (room - w * ratio) / 2;
  if (w < pw * 0.14) {
    w = pw * 0.18;
    x = margin;
    y = margin;
  }
  const element: ImageElement & { src?: string } = {
    id: crypto.randomUUID(),
    type: 'image',
    x_mm: x,
    y_mm: y,
    w_mm: w,
    h_mm: w * ratio,
    rotation: 0,
    z: doc.elements.length,
    asset_id: sticker.assetId,
    role: 'sticker',
    ...(sticker.src ? { src: sticker.src } : {}),
  };
  return { ...doc, elements: [...doc.elements, element] };
}
