/**
 * Snapping a dragged element: its edges and middle are pulled onto the nearest line within reach (the page's edges and
 * middle, the author's guides, other elements' edges and middles), or to a spot that repeats a gap already between two
 * other elements. All in canvas pixels; the editor draws what was found.
 */

export type Box = { x: number; y: number; w: number; h: number };
/** a line to draw while snapped: across the page at `at`, on the `axis` it holds */
export type Mark = { x1: number; y1: number; x2: number; y2: number };
export type Snapped = { dx: number; dy: number; marks: Mark[] };

const own = (b: Box, axis: 'x' | 'y') => (axis === 'x' ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h]);

/** the edges and middles of these boxes, and the page's */
export function linesOf(boxes: Box[], page: { w: number; h: number }, guides: { x: number[]; y: number[] }) {
  return {
    x: [0, page.w / 2, page.w, ...guides.x, ...boxes.flatMap((b) => own(b, 'x'))],
    y: [0, page.h / 2, page.h, ...guides.y, ...boxes.flatMap((b) => own(b, 'y'))],
  };
}

const overlaps = (a: Box, b: Box, axis: 'x' | 'y') => (axis === 'x' ? a.y < b.y + b.h && b.y < a.y + a.h : a.x < b.x + b.w && b.x < a.x + a.w);

/**
 * Where the box would repeat a gap: for each pair of boxes side by side, the spots next to a third box at the same
 * distance. Only boxes in the same row (or column) as the dragged one count.
 */
function gapSpots(box: Box, others: Box[], axis: 'x' | 'y') {
  const row = others.filter((o) => overlaps(o, box, axis));
  const start = (b: Box) => (axis === 'x' ? b.x : b.y);
  const size = (b: Box) => (axis === 'x' ? b.w : b.h);
  const sorted = [...row].sort((a, b) => start(a) - start(b));
  const gaps: { gap: number; a: Box; b: Box }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const g = start(sorted[i + 1]) - (start(sorted[i]) + size(sorted[i]));
    if (g > 0) gaps.push({ gap: g, a: sorted[i], b: sorted[i + 1] });
  }
  return gaps.flatMap(({ gap, a, b }) =>
    row.flatMap((n) => [
      { at: start(n) + size(n) + gap, n, a, b, after: true },
      { at: start(n) - gap - size(box), n, a, b, after: false },
    ]),
  );
}

export function snapBox(box: Box, lines: { x: number[]; y: number[] }, others: Box[], page: { w: number; h: number }, reach: number): Snapped {
  const marks: Mark[] = [];
  const axis = (ax: 'x' | 'y') => {
    let best: { d: number; mark: () => Mark[] } | null = null;
    for (const o of own(box, ax)) {
      for (const l of lines[ax]) {
        const d = l - o;
        if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) {
          best = { d, mark: () => [ax === 'x' ? { x1: l, y1: 0, x2: l, y2: page.h } : { x1: 0, y1: l, x2: page.w, y2: l }] };
        }
      }
    }
    for (const s of gapSpots(box, others, ax)) {
      const d = s.at - (ax === 'x' ? box.x : box.y);
      if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) {
        best = {
          d,
          mark: () => {
            const moved = ax === 'x' ? { ...box, x: box.x + d } : { ...box, y: box.y + d };
            // the gap repeated, and the one it repeats
            const span = (p: Box, q: Box): Mark => {
              const [l, r] = (ax === 'x' ? p.x : p.y) < (ax === 'x' ? q.x : q.y) ? [p, q] : [q, p];
              if (ax === 'x') {
                const y = Math.max(l.y, r.y) + Math.min(l.h, r.h) / 2;
                return { x1: l.x + l.w, y1: y, x2: r.x, y2: y };
              }
              const x = Math.max(l.x, r.x) + Math.min(l.w, r.w) / 2;
              return { x1: x, y1: l.y + l.h, x2: x, y2: r.y };
            };
            return [span(moved, s.n), span(s.a, s.b)];
          },
        };
      }
    }
    if (best) marks.push(...best.mark());
    return best?.d ?? 0;
  };
  const dx = axis('x');
  const dy = axis('y');
  return { dx, dy, marks };
}

export const unionOf = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
