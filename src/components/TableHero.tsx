'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import s from './festive.module.css';
import type { Audience } from '@/lib/categories';

const DOORS: { audience: Audience; href: string; label: string }[] = [
  { audience: 'private', href: '/', label: 'לשמחה' },
  { audience: 'business', href: '/business', label: 'לעסק' },
];

/** one card per category, as the carousel shows it; `background` is a CSS background value */
export type HeroCard = { name: string; background: string };

/** where the cards lie on the table, back to front; the last slot is the front card */
const SLOTS: { box: CSSProperties; rot: number; depth: number; delay: string }[] = [
  { box: { top: 40, left: '2%', width: 220, height: 310 }, rot: 11, depth: 18, delay: '-3s' },
  { box: { top: 70, left: '54%', width: 230, height: 320 }, rot: -13, depth: 14, delay: '-1.2s' },
  { box: { top: 320, left: '0%', width: 200, height: 270 }, rot: -9, depth: 24, delay: '-5s' },
  { box: { top: 300, left: '60%', width: 200, height: 270 }, rot: 8, depth: 28, delay: '-4.4s' },
  { box: { top: 110, left: '25%', width: 280, height: 400 }, rot: -2, depth: 40, delay: '-2s' },
];

const SPARKS = Array.from({ length: 18 }, (_, i) => ({
  top: `${((i * 37) % 92) + 4}%`,
  right: `${((i * 53) % 96) + 2}%`,
  size: 2 + (i % 3),
  delay: `-${((i * 0.7) % 8).toFixed(1)}s`,
}));

type Props = {
  audience: Audience;
  copy: { eyebrow: string; title: string[]; lead: string; label: string; name: string };
  name: string;
  onName: (v: string) => void;
  cards: HeroCard[];
  /** the front card was clicked: show that category's designs */
  onPick: (category: string) => void;
};

export function TableHero({ audience, copy, name, onName, cards, onPick }: Props) {
  const heroRef = useRef<HTMLElement>(null);
  const [front, setFront] = useState<string | null>(null);

  // mouse parallax: written to CSS variables once per frame, no re-render
  useEffect(() => {
    const el = heroRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let pending: PointerEvent | null = null;
    const apply = () => {
      raf = 0;
      if (!pending) return;
      const r = el.getBoundingClientRect();
      const x = (pending.clientX - r.left) / r.width;
      const y = (pending.clientY - r.top) / r.height;
      el.style.setProperty('--mx', ((x - 0.5) * 2).toFixed(3));
      el.style.setProperty('--my', ((y - 0.5) * 2).toFixed(3));
      el.style.setProperty('--sx', `${Math.round(x * 100)}%`);
      el.style.setProperty('--sy', `${Math.round(y * 100)}%`);
      el.style.setProperty('--glow', '0.85');
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pending = e;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const leave = () => {
      pending = null;
      for (const [k, v] of [['--mx', '0'], ['--my', '0'], ['--glow', '0.55']]) el.style.setProperty(k, v);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, []);

  // the first category takes the front slot; the rest fill the slots behind it
  const shown = cards.slice(0, SLOTS.length);
  const placed = shown.map((c, i) => ({ ...c, slot: SLOTS[i === 0 ? SLOTS.length - 1 : SLOTS.length - 1 - shown.length + i] }));
  const frontName = front && shown.some((c) => c.name === front) ? front : shown[0]?.name;
  const ordered = [...placed.filter((c) => c.name !== frontName), ...placed.filter((c) => c.name === frontName)];

  return (
    <section ref={heroRef} className={s.hero}>
      <div className={s.sparks} aria-hidden="true">
        {SPARKS.map((p, i) => (
          <span key={i} className={s.spark} style={{ top: p.top, right: p.right, width: p.size, height: p.size, animationDelay: `${p.delay}, ${p.delay}` }} />
        ))}
      </div>

      <div className={`${s.wrap} ${s.heroInner}`}>
        <div className={s.copy}>
          <nav className={`${s.doors} ${s.rise}`} aria-label="בשביל מי העיצוב">
            {DOORS.map((d) => (
              <Link key={d.audience} href={d.href} className={s.door} aria-current={d.audience === audience ? 'page' : undefined} scroll={false}>
                {d.label}
              </Link>
            ))}
          </nav>
          <span className={`${s.eyebrow} ${s.rise}`}>{copy.eyebrow}</span>
          <h1 className={`${s.title} ${s.rise}`} style={{ animationDelay: '.12s' }}>
            {copy.title[0]}
            <br />
            {copy.title[1]} <span className={s.shine}>{copy.title[2]}</span>
          </h1>
          <p className={`${s.lead} ${s.rise}`} style={{ animationDelay: '.24s' }}>
            {copy.lead}
          </p>

          <div className={`${s.panel} ${s.rise}`} style={{ animationDelay: '.36s' }}>
            <label htmlFor="hero-name">{copy.label}</label>
            <input
              id="hero-name"
              className={s.nameInput}
              type="text"
              value={name}
              maxLength={40}
              placeholder={copy.name}
              onChange={(e) => onName(e.target.value)}
            />
          </div>

          <div className={`${s.actions} ${s.rise}`} style={{ animationDelay: '.48s' }}>
            <a className={`${s.btn} ${s.dark}`} href="#cats">
              בחרו עיצוב ←
            </a>
            <a className={`${s.btn} ${s.ghost}`} href="#how">
              איך זה עובד
            </a>
          </div>
        </div>

        <div className={s.table}>
          <div className={s.tableStage}>
            <span className={s.arch} aria-hidden="true" />
            <span className={s.archRing} aria-hidden="true" />
            {ordered.map((c, i) => {
              const isFront = c.name === frontName;
              return (
                <button
                  key={c.name}
                  type="button"
                  className={s.tcard}
                  aria-label={isFront ? `לעיצובים של ${c.name}` : `לשלוף את ${c.name}`}
                  onClick={() => (isFront ? onPick(c.name) : setFront(c.name))}
                  style={
                    {
                      ...c.slot.box,
                      zIndex: i + 2,
                      '--rot': isFront ? c.slot.rot * 0.3 : c.slot.rot,
                      '--depth': c.slot.depth,
                      '--sway': isFront ? 3 : 2,
                      '--scale': isFront ? 1.06 : 0.97,
                    } as CSSProperties
                  }
                >
                  <span
                    className={s.tphoto}
                    style={{
                      background: `${c.background} center / cover no-repeat, #fffcf6`,
                      animationDelay: c.slot.delay,
                      boxShadow: isFront ? '0 50px 90px rgba(60,40,20,.30), 0 0 0 1px #c9a35a' : '0 24px 50px rgba(60,40,20,.20)',
                    }}
                  >
                    <span className={s.ttag}>{c.name}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span className={s.tableHint} aria-hidden="true">
            לחצו על כרטיס כדי לשלוף אותו · לחיצה נוספת פותחת את הקטגוריה
          </span>
        </div>
      </div>
    </section>
  );
}
