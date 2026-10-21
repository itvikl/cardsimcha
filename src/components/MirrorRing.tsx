'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import s from './festive.module.css';

export type RingItem = { id: string; name: string; thumbnail: string | null };

type Props = {
  items: RingItem[];
  title: string;
  moreHref: string;
  /** changes whenever the category changes; the ring spins once to announce the new set */
  spinKey: string;
  onOpen: (item: RingItem) => void;
  busy: boolean;
};

/** a ring looks empty below this, so fewer templates are repeated to fill it */
const MIN_CARDS = 12;
/** beyond this the radius grows too large for the stage; the rest are on the category page */
const MAX_CARDS = 24;

const norm = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * "Mirror hall" carousel: the cards stand on a 3D ring over a reflective floor.
 * Drag (mouse or touch) with momentum, it settles on the nearest card; arrows and keys step it.
 * Everything per-frame is written to the DOM directly; React only re-renders when the front card changes.
 */
export function MirrorRing({ items, title, moreHref, spinKey, onOpen, busy }: Props) {
  const ring = useMemo(() => {
    if (items.length === 0) return [];
    const out: RingItem[] = [];
    while (out.length < Math.max(MIN_CARDS, Math.min(items.length, MAX_CARDS))) out.push(items[out.length % items.length]);
    return out.slice(0, Math.max(MIN_CARDS, Math.min(items.length, MAX_CARDS)));
  }, [items]);
  const n = ring.length;
  const step = n ? 360 / n : 30;

  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [front, setFront] = useState(0);
  const [size, setSize] = useState({ w: 190, h: 266 });
  const m = useRef({
    rot: 0,
    vel: 0,
    target: null as number | null,
    dragging: false,
    moved: 0,
    lastX: 0,
    downIdx: -1,
    touched: false,
    visible: false,
    reduced: false,
    raf: 0,
    front: 0,
  });

  const radius = n ? (size.w / 2 + 16) / Math.tan(Math.PI / n) : 0;
  const snap = useCallback((r: number) => Math.round(r / step) * step, [step]);

  // card size follows the stage width
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const narrow = e.contentRect.width < 640;
      setSize(narrow ? { w: 140, h: 196 } : { w: 190, h: 266 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const st = m.current;
    if (sceneRef.current) sceneRef.current.style.transform = `translateZ(${-radius}px) rotateX(-7deg) rotateY(${st.rot}deg)`;
    let best = -1;
    let bestF = -2;
    cardRefs.current.forEach((el, i) => {
      if (!el) return;
      const a = norm(i * step + st.rot);
      const f = (1 + Math.cos((a * Math.PI) / 180)) / 2;
      if (f > bestF) {
        bestF = f;
        best = i;
      }
      el.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px) translateY(${(-20 * f ** 8).toFixed(1)}px)`;
      el.style.filter = `brightness(${(0.3 + 0.7 * f).toFixed(2)})`;
      el.dataset.front = String(Math.abs(a) < step / 2);
    });
    if (best !== st.front) {
      st.front = best;
      setFront(best);
    }
  }, [radius, step]);

  const tick = useCallback(() => {
    const st = m.current;
    st.raf = 0;
    let moving = true;
    if (!st.dragging) {
      if (st.target !== null) {
        st.rot += (st.target - st.rot) * (st.reduced ? 1 : 0.09);
        if (Math.abs(st.target - st.rot) < 0.05) {
          st.rot = st.target;
          st.target = null;
        }
      } else if (Math.abs(st.vel) > 0.05) {
        st.rot += st.vel;
        st.vel *= 0.95;
        if (Math.abs(st.vel) < 0.6) {
          st.vel = 0;
          st.target = snap(st.rot);
        }
      } else if (!st.touched && !st.reduced) {
        st.rot -= 0.08;
      } else {
        moving = false;
      }
    }
    paint();
    if ((moving || st.dragging) && st.visible) st.raf = requestAnimationFrame(tick);
  }, [paint, snap]);

  const kick = useCallback(() => {
    const st = m.current;
    if (!st.raf && st.visible) st.raf = requestAnimationFrame(tick);
  }, [tick]);

  // run only while the stage is on screen
  useEffect(() => {
    const st = m.current;
    st.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  // new geometry (size, card count): repaint at once
  useEffect(() => {
    paint();
  }, [paint, n]);

  // a new category: one full turn, landing on its first card
  useEffect(() => {
    const st = m.current;
    st.vel = 0;
    st.target = Math.round(st.rot / 360) * 360 - 360;
    kick();
  }, [spinKey, kick]);

  const goTo = (i: number) => {
    const st = m.current;
    const base = -i * step;
    st.target = base + 360 * Math.round((st.rot - base) / 360);
    st.vel = 0;
    st.touched = true;
    kick();
  };
  const move = (dir: 1 | -1) => {
    const st = m.current;
    st.target = snap(st.target ?? st.rot) - dir * step;
    st.vel = 0;
    st.touched = true;
    kick();
  };

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
    st.touched = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.dragging = 'true';
    kick();
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const st = m.current;
    if (!st.dragging) return;
    const dx = e.clientX - st.lastX;
    st.lastX = e.clientX;
    st.moved += Math.abs(dx);
    st.rot += dx * 0.22;
    st.vel = dx * 0.22;
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const st = m.current;
    if (!st.dragging) return;
    st.dragging = false;
    e.currentTarget.dataset.dragging = 'false';
    if (st.moved < 6 && st.downIdx >= 0) {
      // a tap: the front card opens, any other card turns to the front
      st.vel = 0;
      if (st.downIdx === st.front) onOpen(ring[st.downIdx]);
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
    else if (e.key === 'Enter' && ring[front]) onOpen(ring[front]);
    else return;
    e.preventDefault();
  }

  const current = ring[front];
  const unique = Math.min(items.length, MAX_CARDS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        ref={stageRef}
        className={s.stage}
        tabIndex={0}
        role="group"
        aria-roledescription="קרוסלה"
        aria-label={`עיצובים בקטגוריה ${title}. חיצי המקלדת מסובבים, Enter פותח`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span className={s.floor} aria-hidden="true" />
        <span className={s.ripple} aria-hidden="true" />
        <span className={s.pool} aria-hidden="true" />
        <span className={s.stageTitle}>{title}</span>
        <span className={s.stageHint} aria-hidden="true">
          גררו כדי לסובב · לחצו על כרטיס
        </span>
        {n === 0 ? (
          <p className={s.empty}>עדיין אין עיצובים בקטגוריה הזו. חזרו בקרוב.</p>
        ) : (
          <div ref={sceneRef} className={s.scene}>
            {ring.map((it, i) => {
              const bg = it.thumbnail ? { backgroundImage: `url("${it.thumbnail}")` } : undefined;
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
                  <div className={s.rface} style={bg}>
                    {!it.thumbnail && <span className={s.rnoimg}>{it.name}</span>}
                  </div>
                  <div className={s.rmirror} style={bg} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={s.controls}>
        <button type="button" className={s.navBtn} aria-label="העיצוב הקודם" onClick={() => move(-1)} disabled={n === 0}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button type="button" className={s.navBtn} aria-label="העיצוב הבא" onClick={() => move(1)} disabled={n === 0}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        {current && (
          <span className={s.caption} aria-live="polite">
            <strong>{current.name}</strong>
            <span>
              {String((front % unique) + 1).padStart(2, '0')} / {String(unique).padStart(2, '0')}
            </span>
          </span>
        )}
        <Link className={`${s.btn} ${s.ghost}`} href={moreHref}>
          כל העיצובים
        </Link>
        {current && (
          <button type="button" className={`${s.btn} ${s.dark} ${s.open}`} onClick={() => onOpen(current)} disabled={busy}>
            {busy ? 'פותח…' : 'לפתוח בעורך ←'}
          </button>
        )}
      </div>
    </div>
  );
}
