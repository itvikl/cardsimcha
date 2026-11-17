/**
 * The reel (ReelView): which designs ride on it, the ∞ the cards trace on their way in, and where each one stands
 * on the 3D ring they land on. The ring is the strip of cards (length L) bent away from the viewer until it closes.
 */

export type ReelDesign = { id: string; name: string; kind: string; image: string; aspect: number };

type Published = {
  id: string;
  name: string;
  topic: string | null;
  thumbnail: string | null;
  sizeGroup: string | null;
  series: string | null;
  width_mm: number;
  height_mm: number;
};

/** how many designs ride on the reel; fewer makes the ring too small, more makes it too slow to go round */
export const REEL_SIZE = 18;
/** a thumbnail that is an empty frame, and logos, which aren't a style of ad */
const LEAVE_OUT = /שטריימלים/;
const NOT_ADS = new Set(['לוגו']);
/** A-series paper, the upright print size most designs come in */
const isPaper = (t: Published) => Math.abs(t.width_mm / t.height_mm - 0.707) < 0.03;

/**
 * One card per design: a design printed in several sizes (sizeGroup) or one of a set (series) shows once, upright
 * (A4 where there is one), and the topics take turns so the reel isn't all one kind.
 */
export function pickReel(templates: Published[]): ReelDesign[] {
  const groups = new Map<string, Published[]>();
  for (const t of templates) {
    if (!t.thumbnail || LEAVE_OUT.test(t.name) || NOT_ADS.has(t.topic ?? '')) continue;
    const key = t.sizeGroup ?? t.series ?? t.id;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const pick = (list: Published[]) =>
    list.find((t) => / · A4$/.test(t.name)) ??
    list.find((t) => t.name.startsWith('הזמנה') && isPaper(t)) ??
    list.find(isPaper) ??
    list.find((t) => t.height_mm > t.width_mm) ??
    list[0];
  const byTopic = new Map<string, Published[]>();
  for (const list of groups.values()) {
    const t = pick(list);
    const topic = t.topic || 'עיצוב';
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), t]);
  }
  const out: Published[] = [];
  const total = [...byTopic.values()].reduce((n, l) => n + l.length, 0);
  for (let i = 0; out.length < Math.min(total, REEL_SIZE); i++)
    for (const l of byTopic.values()) if (l[i] && out.length < REEL_SIZE) out.push(l[i]);
  return out.map((t) => ({
    id: t.id,
    // a design in several sizes is named "<design> · <size>"; the reel shows the design
    name: (t.sizeGroup ? t.name.replace(/\s*·[^·]*$/, '') : t.name).replace(/\s*\(ייבוא\)\s*$/, ''),
    kind: t.topic || 'עיצוב',
    image: t.thumbnail!,
    aspect: Math.min(1, Math.max(0.5, t.width_mm / t.height_mm)),
  }));
}

/** s folded into [-L/2, L/2): the strip is a loop, so a card that leaves one end comes back at the other */
export const wrap = (s: number, L: number) => ((((s + L / 2) % L) + L) % L) - L / 2;

export type Point = { x: number; y: number; z: number };
export type Spot = Point & { rx: number; ry: number; scale: number };

/**
 * Where the point s along the strip stands once the strip is closed into a ring of length L, held at its front
 * (s = 0), shrunk by `scale` and tipped by `tilt` (radians, as CSS rotateX) about the ring's centre. ry turns the card
 * there to face out of the ring.
 */
export function ringSpot(s: number, L: number, scale: number, tilt: number): Spot {
  const k = (2 * Math.PI) / L;
  const a = k * s;
  const x = (Math.sin(a) / k) * scale;
  const z = (-(1 - Math.cos(a)) / k) * scale;
  // the tilt turns about the ring's centre, a radius behind the front card
  const depth = scale / k;
  const zc = z + depth;
  return { x, y: -zc * Math.sin(tilt), z: zc * Math.cos(tilt) - depth, rx: tilt, ry: a, scale };
}

/** A path sampled finely enough to be walked at an even speed: its points and the distance to each. */
export type Path = { pts: Point[]; at: number[]; length: number };

/** a lemniscate is flat (its loops are 0.7 of its width); stretched upright this much it reads as ∞ at a glance */
const STRETCH = 1.35;

/**
 * The way in: from beyond the right edge, `rise` above the middle (level with the top of the ∞ unless the room is
 * shorter), a curve down into its middle, then once round the lying ∞ (a lemniscate, `size` from its middle to
 * either tip, its loops stretched to `height`: they reach 0.354 of it above and below) and back to the middle. The curve meets the ∞
 * along its own line through the crossing, so the turn into it is smooth. The two strokes that cross pass at
 * different depths (`depth` in front of and behind the screen), so the cards never run through each other.
 */
export function infinityPath(
  size: number,
  depth: number,
  centre: { x: number; y: number },
  runIn: number,
  rise = size * 0.6,
  height = size * STRETCH,
): Path {
  const pts: Point[] = [];
  const steps = 40;
  const top = centre.y - rise;
  const bend = size * 0.4;
  const c0 = { x: centre.x + runIn, y: top };
  const c1 = { x: centre.x + runIn * 0.4, y: top };
  const c2 = { x: centre.x + bend, y: centre.y - (bend * height) / size };
  for (let i = 0; i < steps; i++) {
    const f = i / steps;
    const g = 1 - f;
    pts.push({
      x: g ** 3 * c0.x + 3 * g ** 2 * f * c1.x + 3 * g * f ** 2 * c2.x + f ** 3 * centre.x,
      y: g ** 3 * c0.y + 3 * g ** 2 * f * c1.y + 3 * g * f ** 2 * c2.y + f ** 3 * centre.y,
      z: depth,
    });
  }
  // from the crossing, heading down and left: the left loop, the crossing behind, the right loop, the crossing again
  const loop = 480;
  for (let i = 0; i <= loop; i++) {
    const t = Math.PI / 2 + (2 * Math.PI * i) / loop;
    const d = 1 + Math.sin(t) ** 2;
    pts.push({ x: centre.x + (size * Math.cos(t)) / d, y: centre.y + (height * Math.sin(t) * Math.cos(t)) / d, z: depth * Math.sin(t) });
  }
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z));
  return { pts, at, length: at[at.length - 1] };
}

/** The point `d` along the path, and which way the path runs there (a unit vector). */
export function walk(path: Path, d: number): { p: Point; dir: Point } {
  const { pts, at } = path;
  let lo = 0;
  let hi = at.length - 1;
  const dd = clamp(d, 0, path.length);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= dd) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const seg = at[hi] - at[lo] || 1;
  const f = (dd - at[lo]) / seg;
  return {
    p: { x: mix(a.x, b.x, f), y: mix(a.y, b.y, f), z: mix(a.z, b.z, f) },
    dir: { x: (b.x - a.x) / seg, y: (b.y - a.y) / seg, z: (b.z - a.z) / seg },
  };
}

/**
 * A card leaving the ∞ for its place: at b = 0 it is at `from` still heading along `dir` (stretched to `pull` px),
 * at b = 1 it rests on `to`. A Hermite curve, so it carries on smoothly instead of stopping dead and turning.
 */
export function landing(from: Point, dir: Point, pull: number, to: Point, b: number): Point {
  const h1 = 2 * b ** 3 - 3 * b ** 2 + 1;
  const h2 = b ** 3 - 2 * b ** 2 + b;
  const h3 = -2 * b ** 3 + 3 * b ** 2;
  return {
    x: h1 * from.x + h2 * dir.x * pull + h3 * to.x,
    y: h1 * from.y + h2 * dir.y * pull + h3 * to.y,
    z: h1 * from.z + h2 * dir.z * pull + h3 * to.z,
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
