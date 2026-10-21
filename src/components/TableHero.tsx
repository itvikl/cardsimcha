'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import s from './festive.module.css';

export const FOILS = [
  { id: 'gold', label: 'זהב', swatch: '#c9a35a', accent: '#8a6420' },
  { id: 'rose', label: 'רוז גולד', swatch: '#d9a08f', accent: '#9a4a3a' },
  { id: 'silver', label: 'כסף', swatch: '#c4ccd1', accent: '#4a5358' },
  { id: 'onyx', label: 'שחור', swatch: '#1a1714', accent: '#1a1714' },
] as const;

export type FoilId = (typeof FOILS)[number]['id'];

type TableCard = {
  id: string;
  label: string;
  box: CSSProperties;
  rot: number;
  depth: number;
  face: CSSProperties;
  accent?: string;
  lines: [string, string, string, string];
  bigSize: number;
  delay: string;
};

/** the decorative cards on the table; the wedding one carries the visitor's name and foil */
function tableCards(name: string, accent: string): TableCard[] {
  return [
    { id: 'zachar', label: 'כרטיס שלום זכר', box: { top: 80, left: '50%', width: 230, height: 330 }, rot: -14, depth: 14, face: { background: '#f3e9d6', color: '#3a2a12' }, accent: '#7a5a22', lines: ['בשעה טובה', 'לבן היקר לנו', 'שלום זכר', '[מקום] · [שעה]'], bigSize: 32, delay: '-1.2s' },
    { id: 'shul', label: 'כרטיס בית כנסת', box: { top: 40, left: '2%', width: 220, height: 320 }, rot: 11, depth: 22, face: { background: '#1a1714', color: '#e2d4bd' }, accent: '#d6c2a1', lines: ['בית הכנסת', 'שבת פרשת [שם]', 'זמני תפילות', 'שחרית · מנחה · ערבית'], bigSize: 28, delay: '-3s' },
    { id: 'cert', label: 'כרטיס תעודה', box: { top: 330, left: '58%', width: 210, height: 250 }, rot: 7, depth: 30, face: { background: '#fbf6ea', color: '#6b4a14', border: '8px double #c9a35a' }, lines: ['תעודת הוקרה', 'מוענקת בזאת ל', '[שם]', 'בהערכה רבה'], bigSize: 26, delay: '-4.4s' },
    { id: 'wedding', label: 'הזמנה לחתונה עם השם שלכם', box: { top: 110, left: '24%', width: 290, height: 410 }, rot: -2, depth: 40, face: { background: '#fffcf6', color: '#2b2010' }, accent, lines: ['בס״ד', 'הננו שמחים להזמינכם', name, '[תאריך] · [אולם]'], bigSize: 40, delay: '-2s' },
  ];
}

const SPARKS = Array.from({ length: 18 }, (_, i) => ({
  top: `${((i * 37) % 92) + 4}%`,
  right: `${((i * 53) % 96) + 2}%`,
  size: 2 + (i % 3),
  delay: `-${((i * 0.7) % 8).toFixed(1)}s`,
}));

type Props = {
  name: string;
  onName: (v: string) => void;
  foil: FoilId;
  onFoil: (f: FoilId) => void;
  shownName: string;
};

export function TableHero({ name, onName, foil, onFoil, shownName }: Props) {
  const heroRef = useRef<HTMLElement>(null);
  const [front, setFront] = useState('wedding');
  const accent = FOILS.find((f) => f.id === foil)?.accent ?? FOILS[0].accent;

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

  const cards = tableCards(shownName, accent);
  const ordered = [...cards.filter((c) => c.id !== front), ...cards.filter((c) => c.id === front)];

  return (
    <section ref={heroRef} className={s.hero}>
      <div className={s.sparks} aria-hidden="true">
        {SPARKS.map((p, i) => (
          <span key={i} className={s.spark} style={{ top: p.top, right: p.right, width: p.size, height: p.size, animationDelay: `${p.delay}, ${p.delay}` }} />
        ))}
      </div>

      <div className={`${s.wrap} ${s.heroInner}`}>
        <div className={s.copy}>
          <span className={`${s.eyebrow} ${s.rise}`}>הזמנות · תעודות · מודעות לבית הכנסת</span>
          <h1 className={`${s.title} ${s.rise}`} style={{ animationDelay: '.12s' }}>
            תעצב את
            <br />
            האירוע <span className={s.shine}>שלך</span>
          </h1>
          <p className={`${s.lead} ${s.rise}`} style={{ animationDelay: '.24s' }}>
            נסו עכשיו: כתבו שם, בחרו גוון, ותראו את ההזמנה שלכם על השולחן.
          </p>

          <div className={`${s.panel} ${s.rise}`} style={{ animationDelay: '.36s' }}>
            <label htmlFor="hero-name">למי השמחה?</label>
            <input
              id="hero-name"
              className={s.nameInput}
              type="text"
              value={name}
              maxLength={40}
              placeholder="נועם & שירה"
              onChange={(e) => {
                onName(e.target.value);
                setFront('wedding');
              }}
            />
            <div className={s.foils} role="group" aria-label="גוון הרדיד">
              <span>רדיד:</span>
              {FOILS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={s.swatch}
                  style={{ background: f.swatch }}
                  aria-label={f.label}
                  aria-pressed={f.id === foil}
                  onClick={() => {
                    onFoil(f.id);
                    setFront('wedding');
                  }}
                />
              ))}
              <span>{FOILS.find((f) => f.id === foil)?.label}</span>
            </div>
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
              const isFront = c.id === front;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={s.tcard}
                  aria-label={c.label}
                  aria-pressed={isFront}
                  onClick={() => setFront(c.id)}
                  style={
                    {
                      ...c.box,
                      zIndex: i + 2,
                      '--rot': isFront ? c.rot * 0.3 : c.rot,
                      '--depth': c.depth,
                      '--sway': isFront ? 3 : 2,
                      '--scale': isFront ? 1.06 : 0.97,
                    } as CSSProperties
                  }
                >
                  <span
                    className={s.tface}
                    style={{
                      ...c.face,
                      animationDelay: c.delay,
                      boxShadow: isFront ? `0 50px 90px rgba(60,40,20,.30), 0 0 0 1px ${c.accent ?? '#c9a35a'}` : '0 24px 50px rgba(60,40,20,.20)',
                    }}
                  >
                    <span className={s.k} style={{ color: c.accent }}>
                      {c.lines[0]}
                    </span>
                    <span style={{ fontSize: 15 }}>{c.lines[1]}</span>
                    <span className={s.big} style={{ color: c.accent, fontSize: c.bigSize }}>
                      {c.lines[2]}
                    </span>
                    <span className={s.rule} style={{ color: c.accent }} />
                    <span style={{ fontSize: 14 }}>{c.lines[3]}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <span className={s.tableHint} aria-hidden="true">
            לחצו על כרטיס כדי לשלוף אותו
          </span>
        </div>
      </div>
    </section>
  );
}
