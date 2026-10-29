'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import s from './festive.module.css';

/** one card on the ring: its picture (cover-fitted), the name on its label, and a line under the ring for the front one */
export type RingItem = { id: string; name: string; image: string | null; note?: string };

type Props = {
  items: RingItem[];
  /** what the ring shows, for screen readers */
  label: string;
  /** changes whenever the set changes; the cards turn over to show the new one */
  spinKey: string;
  /** `from` is where the card sits on screen, for a transition from there */
  onOpen: (item: RingItem, from: DOMRect | null) => void;
  /** the button under the ring that opens the front card */
  openLabel: string;
  /** whenever another card comes to the front */
  onFront?: (item: RingItem) => void;
  /** 'cover' fills the card with the picture and puts the name on a plaque (categories);
   *  'contain' shows a whole design on paper, without a plaque (its name is under the ring) */
  fit?: 'cover' | 'contain';
};

/** a ring looks empty below this, so fewer items are repeated (whole rounds of them) to fill it */
const MIN_CARDS = 8;
/** beyond this the radius grows too large for the stage; the rest are on the category page */
const MAX_CARDS = 24;
/**
 * Card size on the ring: large, as in a shop window. On a 2x screen a 250px card wants a picture about 500px wide;
 * the category covers and design thumbnails (600px, Editor's makeThumb) are that.
 */
const CARD_WIDE = { w: 250, h: 350 };
const CARD_NARROW = { w: 180, h: 252 };
/** the ring turns on its own all the time, this many degrees a second... */
const DRIFT_DEG_S = 5;
/** ...and picks up again this long after the visitor last dragged or stepped it */
const RESUME_S = 3;
/** a card catches the foil sheen when it comes within this many degrees of the front */
const SHINE_DEG = 2;
/** the deal and the turn-over: one card's share (s), and the delay between neighbours, spreading out from the front */
const CARD_ANIM_S = 0.6;
const STAGGER_S = 0.06;

type Anim = { kind: 'deal' | 'out' | 'in'; start: number };

const norm = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const fill = (items: RingItem[]) => {
  if (items.length === 0) return [];
  // whole rounds, so the order around the ring never breaks where it closes
  const count = Math.min(items.length * Math.ceil(MIN_CARDS / items.length), MAX_CARDS);
  return Array.from({ length: count }, (_, i) => items[i % items.length]);
};
const sameIds = (a: RingItem[], b: RingItem[]) => a.length === b.length && a.every((x, i) => x.id === b[i].id);

/**
 * "Mirror hall" carousel: the cards stand on a 3D ring over the site backdrop, the ones behind fading into it.
 * It turns slowly all the time; each card catches a foil sheen as it passes the front, and the front one leans toward the mouse.
 * The cards are dealt out on arrival and turn over when the category changes.
 * Drag (mouse or touch) with momentum, it settles on the nearest card; arrows and keys step it.
 * Everything per-frame is written to the DOM directly; React only re-renders when the front card or the set changes.
 */
export function MirrorRing({ items, label, spinKey, onOpen, openLabel, onFront, fit = 'cover' }: Props) {
  // the set on the ring lags behind `items` while the old cards turn over
  const [shown, setShown] = useState({ key: spinKey, items });
  const ring = useMemo(() => fill(shown.items), [shown]);
  const n = ring.length;
  const step = n ? 360 / n : 30;

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [front, setFront] = useState(0);
  const [size, setSize] = useState(CARD_WIDE);
  const m = useRef({
    rot: 0,
    vel: 0,
    target: null as number | null,
    dragging: false,
    moved: 0,
    lastX: 0,
    downIdx: -1,
    /** when the visitor last dragged or stepped the ring (s); the drift waits RESUME_S after it */
    touchedAt: -Infinity,
    /** the previous frame's time (s), so the drift keeps its speed at any frame rate */
    lastT: 0,
    /** the card that last caught the sheen; it shines again only after leaving the front */
    shone: -1,
    visible: false,
    reduced: false,
    /** depth of field: blur the cards behind (wide screens only, it is costly) */
    dof: false,
    raf: 0,
    front: 0,
    anim: null as Anim | null,
    dealt: false,
    pending: null as { key: string; items: RingItem[] } | null,
    flipIn: false,
    /** front card tilt and glare, eased toward the pointer: x, y in -1..1, g 0..1 */
    tilt: { x: 0, y: 0, g: 0, tx: 0, ty: 0, tg: 0, lx: 50, ly: 50 },
    blur: [] as number[],
  });
  const tickRef = useRef<() => void>(() => {});

  const radius = n ? (size.w / 2 + 16) / Math.tan(Math.PI / n) : 0;
  const snap = useCallback((r: number) => Math.round(r / step) * step, [step]);

  // card size follows the stage width
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setSize(e.contentRect.width < 640 ? CARD_NARROW : CARD_WIDE);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const st = m.current;
    if (!n) return;
    const now = performance.now() / 1000;
    const anim = st.anim;
    const t = anim && anim.start ? now - anim.start : 0;
    const best = (((Math.round(-st.rot / step) % n) + n) % n);
    if (sceneRef.current) sceneRef.current.style.transform = `translateZ(${-radius}px) rotateX(-7deg) rotateY(${st.rot}deg)`;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const a = norm(i * step + st.rot);
      // the deal and the turn-over spread outwards from the front card
      const p = anim ? easeOut(clamp((t - Math.round(Math.abs(a) / step) * STAGGER_S) / CARD_ANIM_S, 0, 1)) : 1;
      let angle = i * step;
      let lift = 0;
      let flip = 0;
      let show = 1;
      if (anim?.kind === 'deal') {
        // every card starts stacked at the front, below, and fans out to its place
        angle -= a * (1 - p);
        lift = 90 * (1 - p);
        show = p;
      } else if (anim?.kind === 'out') flip = 90 * p;
      else if (anim?.kind === 'in') flip = -90 * (1 - p);
      const f = (1 + Math.cos((norm(angle + st.rot) * Math.PI) / 180)) / 2;
      const isFront = i === best && !anim;
      let tf = `rotateY(${angle}deg) translateZ(${radius}px) translateY(${(-20 * f ** 8 + lift).toFixed(1)}px)`;
      if (flip) tf += ` rotateY(${flip.toFixed(1)}deg)`;
      if (isFront && (st.tilt.x || st.tilt.y)) tf += ` rotateX(${(-st.tilt.y * 8).toFixed(2)}deg) rotateY(${(st.tilt.x * 10).toFixed(2)}deg)`;
      el.style.transform = tf;
      el.style.opacity = ((0.18 + 0.82 * f ** 1.6) * show).toFixed(2);
      el.dataset.front = String(isFront);
      // one sweep of foil light across each card as it passes the front
      if (isFront && Math.abs(a) < SHINE_DEG && st.shone !== i && !st.reduced) {
        st.shone = i;
        el.firstElementChild?.animate([{ backgroundPosition: '160% 0' }, { backgroundPosition: '-60% 0' }], {
          duration: 1500,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          pseudoElement: '::after',
        });
      } else if (i === st.shone && Math.abs(a) > step / 2) st.shone = -1;
      if (st.dof) {
        const b = isFront ? 0 : Math.min(3, Math.round((1 - f) * 4));
        if (st.blur[i] !== b) {
          st.blur[i] = b;
          el.style.filter = b ? `blur(${b}px)` : '';
        }
      }
    });
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty('--lx', `${st.tilt.lx.toFixed(1)}%`);
      stage.style.setProperty('--ly', `${st.tilt.ly.toFixed(1)}%`);
      stage.style.setProperty('--glare', st.tilt.g.toFixed(3));
    }
    if (best !== st.front) {
      st.front = best;
      setFront(best);
    }
  }, [n, radius, step]);

  const kick = useCallback(() => {
    const st = m.current;
    if (!st.raf && st.visible) st.raf = requestAnimationFrame(() => tickRef.current());
  }, []);

  const tick = useCallback(() => {
    const st = m.current;
    st.raf = 0;
    const now = performance.now() / 1000;
    // a long gap (tab hidden, ring off screen) must not turn into a jump
    const dt = Math.min(now - (st.lastT || now), 0.1);
    st.lastT = now;
    let turning = st.dragging;
    if (st.anim) {
      if (!st.anim.start) st.anim.start = now;
      turning = true;
      if (now - st.anim.start >= Math.ceil(n / 2) * STAGGER_S + CARD_ANIM_S) {
        const done = st.anim.kind;
        st.anim = null;
        // the old cards are edge-on now: swap in the new set, which then turns face up
        if (done === 'out' && st.pending) {
          st.flipIn = st.pending.items.length > 0;
          setShown(st.pending);
          st.pending = null;
        }
      }
    }
    if (!st.dragging && !st.anim) {
      if (st.target !== null) {
        turning = true;
        // eased by time, not frames, so a slow device glides in just as fast
        st.rot += (st.target - st.rot) * (st.reduced ? 1 : 1 - 0.91 ** (dt * 60));
        if (Math.abs(st.target - st.rot) < 0.05) {
          st.rot = st.target;
          st.target = null;
        }
      } else if (Math.abs(st.vel) > 0.05) {
        turning = true;
        st.rot += st.vel;
        st.vel *= 0.95;
        if (Math.abs(st.vel) < 0.6) {
          st.vel = 0;
          st.target = snap(st.rot);
        }
      } else if (n > 1 && !st.reduced) {
        // nothing else moving it: the slow drift, all the time (paused for a moment after the visitor turns it)
        turning = true;
        if (now - st.touchedAt > RESUME_S) st.rot -= DRIFT_DEG_S * dt;
      }
    }
    const tl = st.tilt;
    const easing = Math.abs(tl.tx - tl.x) + Math.abs(tl.ty - tl.y) + Math.abs(tl.tg - tl.g) > 0.002;
    if (easing) {
      tl.x += (tl.tx - tl.x) * 0.12;
      tl.y += (tl.ty - tl.y) * 0.12;
      tl.g += (tl.tg - tl.g) * 0.12;
    }
    paint();
    if ((turning || easing) && st.visible) st.raf = requestAnimationFrame(() => tickRef.current());
  }, [n, paint, snap]);

  useLayoutEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // run only while the stage is on screen
  useEffect(() => {
    const st = m.current;
    st.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    st.dof = !st.reduced && window.matchMedia('(min-width: 900px) and (pointer: fine)').matches;
    if (st.reduced) st.dealt = true;
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      st.visible = e.isIntersecting;
      if (st.visible) kick();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(st.raf);
      st.raf = 0;
    };
  }, [kick]);

  // a new category: the cards on the ring turn over (edge-on, swap, face up); onto an empty ring they are dealt
  useEffect(() => {
    const st = m.current;
    if (spinKey === shown.key && sameIds(items, shown.items)) return;
    if (shown.items.length === 0 || st.reduced || spinKey === shown.key) {
      // a different set starts from its first card (a refetch of the same one keeps its place)
      if (spinKey !== shown.key) {
        st.rot = 0;
        st.target = null;
        if (!st.reduced) st.dealt = false;
      }
      setShown({ key: spinKey, items });
      return;
    }
    st.pending = { key: spinKey, items };
    if (st.anim?.kind !== 'out') {
      st.anim = { kind: 'out', start: 0 };
      st.target = snap(st.target ?? st.rot);
      st.vel = 0;
    }
    kick();
  }, [items, spinKey, shown, snap, kick]);

  // new cards on the ring: place them before the browser paints (no flash at the default spot), then deal or turn them face up
  useLayoutEffect(() => {
    const st = m.current;
    cardRefs.current.length = n;
    st.blur = [];
    if (!n) return;
    if (st.flipIn) {
      st.flipIn = false;
      st.rot = 0;
      st.target = null;
      st.anim = { kind: 'in', start: 0 };
    } else if (!st.dealt) {
      st.dealt = true;
      st.anim = { kind: 'deal', start: 0 };
    }
    paint();
    kick();
  }, [ring, n, paint, kick]);

  const goTo = (i: number) => {
    const st = m.current;
    const base = -i * step;
    st.target = base + 360 * Math.round((st.rot - base) / 360);
    st.vel = 0;
    st.touchedAt = performance.now() / 1000;
    kick();
  };
  const move = (dir: 1 | -1) => {
    const st = m.current;
    st.target = snap(st.target ?? st.rot) - dir * step;
    st.vel = 0;
    st.touchedAt = performance.now() / 1000;
    kick();
  };
  /** where card `i` is on screen (its face), for the flight into the editor */
  const rectOf = (i: number) => (cardRefs.current[i]?.firstElementChild as HTMLElement | null)?.getBoundingClientRect() ?? null;

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const st = m.current;
    const hit = (e.target as Element).closest<HTMLElement>('[data-idx]');
    st.downIdx = hit ? Number(hit.dataset.idx) : -1;
    st.dragging = true;
    st.lastX = e.clientX;
    st.moved = 0;
    st.vel = 0;
    st.target = null;
    st.touchedAt = performance.now() / 1000;
    st.tilt.tx = st.tilt.ty = st.tilt.tg = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.dragging = 'true';
    kick();
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const st = m.current;
    if (!st.dragging) {
      // the front card leans toward the mouse and the light slides across it
      if (e.pointerType !== 'mouse' || st.reduced || st.anim) return;
      const r = rectOf(st.front);
      if (!r) return;
      const x = (e.clientX - (r.left + r.width / 2)) / r.width;
      const y = (e.clientY - (r.top + r.height / 2)) / r.height;
      const near = Math.abs(x) < 1.2 && Math.abs(y) < 0.9;
      st.tilt.tx = near ? clamp(x * 2, -1, 1) : 0;
      st.tilt.ty = near ? clamp(y * 2, -1, 1) : 0;
      st.tilt.tg = near ? 1 : 0;
      st.tilt.lx = clamp(50 + x * 100, 0, 100);
      st.tilt.ly = clamp(50 + y * 100, 0, 100);
      kick();
      return;
    }
    const dx = e.clientX - st.lastX;
    st.lastX = e.clientX;
    st.moved += Math.abs(dx);
    st.rot += dx * 0.22;
    st.vel = dx * 0.22;
  }
  function onPointerLeave() {
    const st = m.current;
    st.tilt.tx = st.tilt.ty = st.tilt.tg = 0;
    kick();
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const st = m.current;
    if (!st.dragging) return;
    st.dragging = false;
    st.touchedAt = performance.now() / 1000;
    e.currentTarget.dataset.dragging = 'false';
    if (st.moved < 6 && st.downIdx >= 0) {
      // a tap: the front card opens, any other card turns to the front
      st.vel = 0;
      if (st.downIdx === st.front) onOpen(ring[st.downIdx], rectOf(st.downIdx));
      else goTo(st.downIdx);
      return;
    }
    if (Math.abs(st.vel) < 0.6) {
      st.vel = 0;
      st.target = snap(st.rot);
    }
    kick();
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // RTL: the next card is to the left
    if (e.key === 'ArrowLeft') move(1);
    else if (e.key === 'ArrowRight') move(-1);
    else if (e.key === 'Enter' && ring[front]) onOpen(ring[front], rectOf(front));
    else return;
    e.preventDefault();
  }

  const current = ring[front];
  const onFrontRef = useRef(onFront);
  useLayoutEffect(() => {
    onFrontRef.current = onFront;
  });
  useEffect(() => {
    if (current) onFrontRef.current?.(current);
  }, [current]);

  return (
    <div className={s.ring}>
      {/* the arrows sit beside the stage, not in it: the stage captures the pointer for dragging */}
      <div className={s.ringWrap}>
        <div
          ref={stageRef}
          className={s.stage}
          data-empty={n === 0}
          tabIndex={0}
          role="group"
          aria-roledescription="קרוסלה"
          aria-label={`${label}. חיצי המקלדת מסובבים, Enter פותח`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
        >
          {n > 0 && <span className={s.ground} aria-hidden="true" />}
          {n === 0 ? (
            <p className={s.empty}>עוד רגע זה כאן. חזרו בקרוב.</p>
          ) : (
            <div ref={sceneRef} className={s.scene}>
              {ring.map((it, i) => {
                const bg = it.image ? { backgroundImage: `url("${it.image}")` } : undefined;
                return (
                  <div
                    key={`${it.id}-${i}`}
                    ref={(el) => {
                      cardRefs.current[i] = el;
                    }}
                    data-idx={i}
                    className={s.rcard}
                    style={{ width: size.w, height: size.h, left: -size.w / 2 }}
                    aria-hidden="true"
                  >
                    <div className={s.rface} style={bg} data-blank={!it.image} data-fit={fit}>
                      {(fit === 'cover' || !it.image) && <span className={s.rlabel}>{it.name}</span>}
                      <span className={s.rglare} />
                    </div>
                    <div className={s.rmirror} style={bg} data-fit={fit} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {n > 0 && (
          <>
            <button type="button" className={`${s.navBtn} ${s.navPrev}`} aria-label="הקודם" onClick={() => move(-1)}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <button type="button" className={`${s.navBtn} ${s.navNext}`} aria-label="הבא" onClick={() => move(1)}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          </>
        )}
      </div>

      <div className={s.controls}>
        {current && (
          <span className={s.caption} aria-live="polite">
            <strong>{current.name}</strong>
            {current.note && <span>{current.note}</span>}
          </span>
        )}
        {current && (
          <button type="button" className={`${s.btn} ${s.dark}`} onClick={() => onOpen(current, rectOf(front))}>
            {openLabel}
          </button>
        )}
      </div>
    </div>
  );
}
