'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import s from './festive.module.css';
import r from './reel.module.css';
import { clamp, easeInOut, infinityPath, landing, mix, pickReel, ringSpot, walk, wrap, type Path, type ReelDesign, type Spot } from '@/lib/reel';

type Phase = 'loading' | 'enter' | 'carousel';
type Geo = { w: number; h: number; H: number; rowY: number; widths: number[]; at: number[]; L: number; ring: number; path: Path; pathScale: number };

const TITLE = 'עיצוב לכל שמחה ולכל עסק';
const LEAD = 'בוחרים עיצוב, ממלאים את הפרטים ומורידים. בלי הרשמה ובלי גרפיקאי.';

/** each card takes this long (s) to come in and round the ∞, the next one sets off GAP_S after it, and it lands on the ring in LAND_S */
const TRAVEL_S = 2.6;
const GAP_S = 0.1;
const LAND_S = 1;
/** the carousel moves on by itself every AUTO_MS, once the visitor has left it alone for IDLE_MS */
const AUTO_MS = 4500;
const IDLE_MS = 6000;
/** the entrance waits this long at most for the pictures */
const LOAD_WAIT_MS = 3500;
/** air between the ring and the title above it, and the controls under it */
const ROW_AIR = 20;
/** the ring is seen from a little above */
const RING_TILT = (-8 * Math.PI) / 180;
/** the front card stands out by this much */
const FRONT_LIFT = 0.06;
/** on the ∞ a card turns this far (rad) toward the way it's going */
const FACE_TURN = 0.45;
/** a press that moves less than this is a click */
const CLICK_PX = 6;

async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('שגיאה לא צפויה');
  return (await res.json()) as T;
}

/**
 * Card size, where each card sits on the ring, and the ∞ the cards come in by, for a stage this big; `top` and
 * `bottom` are what the title and the controls take.
 */
function measure(w: number, h: number, top: number, bottom: number, designs: ReelDesign[]): Geo {
  const H = Math.round(clamp(Math.min((h - top - bottom) / (1 + FRONT_LIFT), w * 0.8), 180, 420));
  const gap = Math.round(H * 0.08);
  const widths = designs.map((d) => Math.round(H * d.aspect));
  // places along the strip from the right, as Hebrew reads; the first design lands at the front
  let run = 0;
  const centres = widths.map((cw) => {
    const c = run + cw / 2 + gap / 2;
    run += cw + gap;
    return c;
  });
  const L = run;
  const rowY = top + (h - top - bottom) / 2;
  // the closed ring is shown whole across a wide screen; on a narrow one its sides may run off the edges, so the cards stay readable
  const ring = Math.min(1, Math.max(w * 0.9, H * 3.4) / (L / Math.PI + Math.max(...widths)));
  // the ∞ fills the screen's width, at most, with the cards on it small enough to keep its shape readable
  const pathScale = Math.min(0.5, (h * 0.24) / H, (w * 0.12) / H);
  const size = Math.min(w * 0.5 - (H * pathScale) / 2, h * 0.7);
  // its middle is the screen's middle (the group is held on the ring's line); the cards come in from out of sight
  const centre = { x: 0, y: h / 2 - rowY };
  const runIn = w / 2 + H * pathScale;
  return { w, h, H, rowY, widths, at: centres.map((c) => wrap(centres[0] - c, L)), L, ring, path: infinityPath(size, size * 0.45, centre, runIn), pathScale };
}

const css = (p: Spot, rz = 0) =>
  `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, ${p.z.toFixed(1)}px) rotateX(${p.rx.toFixed(4)}rad) ` +
  `rotateY(${p.ry.toFixed(4)}rad) rotate(${rz.toFixed(4)}rad) scale(${p.scale.toFixed(3)})`;

/** a card on the ring: the front one stands out, the ones round the back fade into the page */
function onRing(g: Geo, at: number) {
  const spot = ringSpot(at, g.L, g.ring, RING_TILT);
  spot.scale *= 1 + FRONT_LIFT * Math.max(0, 1 - Math.abs(at) / (g.H * 0.8));
  return { spot, opacity: 1 - 0.72 * ((1 - Math.cos((2 * Math.PI * at) / g.L)) / 2) };
}

/**
 * A possible first screen: the real designs come in one after another from beyond the top right corner, each goes
 * once round a lying ∞ in depth, and they land one by one on a 3D ring, the first at the front. Drag, the arrows or
 * the keys turn the ring; the front card opens its design.
 * Everything per-frame is written to the DOM directly; React only re-renders when the front card or the phase changes.
 */
export function ReelView() {
  const stageRef = useRef<HTMLElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [designs, setDesigns] = useState<ReelDesign[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [front, setFront] = useState(0);
  const [error, setError] = useState('');
  const geoRef = useRef<Geo | null>(null);
  const m = useRef({
    phase: 'loading' as Phase,
    /** when the entrance began (ms) */
    start: 0,
    /** how far the ring has turned, as a length along the strip (px); target is where it's heading */
    u: 0,
    target: 0,
    dragging: false,
    lastX: 0,
    lastT: 0,
    vel: 0,
    moved: 0,
    touchedAt: 0,
    autoAt: 0,
    hover: false,
    front: 0,
    prev: 0,
    raf: 0,
    reduced: false,
  });
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    m.current.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let live = true;
    api<Parameters<typeof pickReel>[0]>('/api/templates')
      .then((t) => live && setDesigns(pickReel(t)))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  // card size follows the stage, and the title and controls (they rewrap with the width, and when the fonts arrive)
  useLayoutEffect(() => {
    const el = stageRef.current;
    const head = headRef.current;
    const below = belowRef.current;
    if (!el || !head || !below || !designs.length) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const g = measure(w, h, head.offsetTop + head.offsetHeight + ROW_AIR, h - below.offsetTop + ROW_AIR, designs);
      geoRef.current = g;
      setGeo(g);
    });
    for (const target of [el, head, below]) ro.observe(target);
    return () => ro.disconnect();
  }, [designs]);

  const kick = useCallback(() => {
    const st = m.current;
    if (!st.raf) st.raf = requestAnimationFrame(() => tickRef.current());
  }, []);

  /** Lays out every card for this moment; true while anything is still moving. */
  const paint = useCallback((now: number) => {
    const g = geoRef.current;
    const st = m.current;
    const group = groupRef.current;
    if (!g || !group || st.phase === 'loading') return false;
    const dt = Math.min(now - (st.prev || now), 100) / 1000;
    st.prev = now;
    group.style.opacity = '1';
    let moving = st.dragging;
    const n = g.at.length;

    if (st.phase === 'enter') {
      moving = true;
      const t = (now - st.start) / 1000;
      const speed = g.path.length / TRAVEL_S;
      const travel = g.path.length / speed;
      const end = walk(g.path, g.path.length);
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const own = t - i * GAP_S;
        if (own <= 0) {
          el.style.opacity = '0';
          return;
        }
        if (own < travel) {
          // on the ∞, facing a little the way it's going
          const { p, dir } = walk(g.path, own * speed);
          el.style.transform = css({ ...p, rx: 0, ry: FACE_TURN * dir.x, scale: g.pathScale }, -0.12 * dir.y * Math.sign(dir.x || 1));
          el.style.opacity = '1';
          return;
        }
        // off the ∞ at the crossing and onto its place on the ring, leaving at the speed it came round at
        const b = clamp((own - travel) / LAND_S, 0, 1);
        const e = easeInOut(b);
        const { spot, opacity } = onRing(g, g.at[i]);
        el.style.transform = css({
          ...landing(end.p, end.dir, speed * LAND_S * 0.5, spot, b),
          rx: mix(0, spot.rx, e),
          ry: mix(FACE_TURN * end.dir.x, spot.ry, e),
          scale: mix(g.pathScale, spot.scale, e),
        });
        el.style.opacity = mix(1, opacity, e).toFixed(2);
      });
      if (t >= (n - 1) * GAP_S + travel + LAND_S) {
        st.phase = 'carousel';
        st.u = st.target = 0;
        st.touchedAt = st.autoAt = now;
        setPhase('carousel');
      }
      return moving;
    }

    if (!st.dragging) {
      const d = st.target - st.u;
      if (Math.abs(d) < 0.05) st.u = st.target;
      else {
        st.u += d * Math.min(1, dt * 7);
        moving = true;
      }
    }
    let best = 0;
    let bestD = Infinity;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const at = wrap(g.at[i] + st.u, g.L);
      const { spot, opacity } = onRing(g, at);
      el.style.transform = css(spot);
      el.style.opacity = opacity.toFixed(2);
      if (Math.abs(at) < bestD) {
        bestD = Math.abs(at);
        best = i;
      }
    });
    if (best !== st.front) {
      st.front = best;
      setFront(best);
    }
    cardRefs.current.forEach((el, i) => el && (el.dataset.front = String(i === best)));
    return moving;
  }, []);

  useEffect(() => {
    tickRef.current = () => {
      const st = m.current;
      st.raf = 0;
      if (paint(performance.now())) kick();
      else st.prev = 0;
    };
  }, [paint, kick]);

  useEffect(() => {
    if (geo) kick();
  }, [geo, kick]);

  const begin = useCallback(() => {
    const st = m.current;
    const now = performance.now();
    st.u = st.target = 0;
    st.prev = 0;
    st.front = 0;
    setFront(0);
    cardRefs.current.forEach((el) => el && (el.dataset.front = 'false'));
    if (st.reduced) {
      st.phase = 'carousel';
      st.touchedAt = st.autoAt = now;
      setPhase('carousel');
    } else {
      st.phase = 'enter';
      st.start = now;
      setPhase('enter');
    }
    kick();
  }, [kick]);

  // the entrance waits for the pictures, so the cards don't arrive blank
  useEffect(() => {
    if (!designs.length || !geo || m.current.phase !== 'loading') return;
    let live = true;
    const loads = designs.map((d) => {
      const img = new Image();
      img.src = d.image;
      return img.decode().catch(() => undefined);
    });
    Promise.race([Promise.all(loads), new Promise((done) => setTimeout(done, LOAD_WAIT_MS))]).then(() => live && begin());
    return () => {
      live = false;
    };
  }, [designs, geo, begin]);

  useEffect(() => () => cancelAnimationFrame(m.current.raf), []);

  const goTo = useCallback((i: number) => {
    const g = geoRef.current;
    const st = m.current;
    if (!g || st.phase !== 'carousel') return;
    st.target = st.u - wrap(g.at[i] + st.u, g.L);
    kick();
  }, [kick]);

  const step = useCallback((by: number) => {
    const st = m.current;
    st.touchedAt = performance.now();
    goTo((st.front + by + designs.length) % designs.length);
  }, [goTo, designs.length]);

  // it moves on by itself while the visitor isn't using it
  useEffect(() => {
    if (phase !== 'carousel' || m.current.reduced || designs.length < 2) return;
    const id = setInterval(() => {
      const st = m.current;
      const now = performance.now();
      if (st.dragging || st.hover || document.hidden || now - st.touchedAt < IDLE_MS || now - st.autoAt < AUTO_MS) return;
      st.autoAt = now;
      goTo((st.front + 1) % designs.length);
    }, 500);
    return () => clearInterval(id);
  }, [phase, goTo, designs.length]);

  const onPointerDown = (e: ReactPointerEvent) => {
    const st = m.current;
    if (st.phase !== 'carousel' || e.button !== 0) return;
    st.dragging = true;
    st.lastX = e.clientX;
    st.lastT = performance.now();
    st.vel = 0;
    st.moved = 0;
    st.touchedAt = st.lastT;
    // followed on the window, not captured: a capture would take the click away from the card's link
    const move = (ev: PointerEvent) => {
      const now = performance.now();
      const dx = (ev.clientX - st.lastX) / geoRef.current!.ring;
      st.u += dx;
      st.vel = dx / Math.max(1, now - st.lastT);
      st.moved += Math.abs(ev.clientX - st.lastX);
      st.lastX = ev.clientX;
      st.lastT = now;
      kick();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const g = geoRef.current;
      st.dragging = false;
      st.touchedAt = performance.now();
      if (!g) return;
      // a flick carries on a little, then lands on the nearest card
      const ahead = st.u + clamp(st.vel * 220, -g.L / 2, g.L / 2);
      let near = Infinity;
      for (const at of g.at) {
        const d = wrap(at + ahead, g.L);
        if (Math.abs(d) < Math.abs(near)) near = d;
      }
      st.target = ahead - near;
      kick();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onCardClick = (e: ReactMouseEvent, i: number) => {
    const st = m.current;
    if (st.phase !== 'carousel' || st.moved > CLICK_PX) {
      e.preventDefault();
      return;
    }
    // a card at the side comes to the front first; the front one opens its design
    if (i !== st.front) {
      e.preventDefault();
      st.touchedAt = performance.now();
      goTo(i);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') step(1);
    else if (e.key === 'ArrowRight') step(-1);
    else return;
    e.preventDefault();
  };

  const current = designs[front];

  return (
    <div className={`${s.root} ${r.root}`}>
      <section
        ref={stageRef}
        className={r.stage}
        data-phase={phase}
        style={geo ? ({ '--row-y': `${geo.rowY}px` } as CSSProperties) : undefined}
        aria-label="סליל העיצובים"
      >
        <header ref={headRef} className={r.head}>
          <h1 className={s.title}>{TITLE}</h1>
          <p className={`${s.lead} ${r.lead}`}>{LEAD}</p>
        </header>

        {error && <p className={r.error} role="alert">{error}</p>}

        <div
          className={r.viewport}
          onPointerDown={onPointerDown}
          onPointerEnter={(e) => e.pointerType === 'mouse' && (m.current.hover = true)}
          onPointerLeave={() => (m.current.hover = false)}
          onKeyDown={onKeyDown}
          role="region"
          aria-roledescription="קרוסלה"
          aria-label="עיצובים לבחירה"
        >
          <div ref={groupRef} className={r.group}>
            {geo &&
              designs.map((d, i) => (
                <Link
                  key={d.id}
                  ref={(el) => {
                    cardRefs.current[i] = el;
                  }}
                  href={`/t/${d.id}`}
                  className={r.card}
                  style={{ width: geo.widths[i], height: geo.H, left: -geo.widths[i] / 2, top: -geo.H / 2 }}
                  onClick={(e) => onCardClick(e, i)}
                  onFocus={(e) => e.currentTarget.matches(':focus-visible') && goTo(i)}
                  draggable={false}
                  aria-label={`${d.name}, ${d.kind}`}
                >
                  <img src={d.image} alt="" draggable={false} decoding="async" />
                </Link>
              ))}
          </div>
        </div>

        <div ref={belowRef} className={r.below}>
          <p className={r.caption} aria-live="polite">
            {current && (
              <>
                <span className={r.kind}>{current.kind}</span>
                <span className={r.name}>{current.name}</span>
              </>
            )}
          </p>
          <div className={r.controls}>
            <button type="button" className={r.arrow} onClick={() => step(-1)} aria-label="העיצוב הקודם">→</button>
            {current && (
              <Link href={`/t/${current.id}`} className={`${s.btn} ${s.dark}`}>
                להתחיל מהעיצוב הזה ←
              </Link>
            )}
            <button type="button" className={r.arrow} onClick={() => step(1)} aria-label="העיצוב הבא">←</button>
          </div>
          <button type="button" className={r.replay} onClick={begin}>↻ לראות שוב את הכניסה</button>
        </div>
      </section>
    </div>
  );
}
