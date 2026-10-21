'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import styles from './falling-title.module.css';

const FALL_MS = 1150;
const IMPACT = 0.55; // share of the fall animation at which a letter first touches down

const COLORS = ['#f4b740', '#ff8fab', '#6fd3b0', '#8ec5ff', '#c39bff', '#f2c75c'];
// deterministic burst: evenly spread angles, varied distance / size / colour
const BURST = Array.from({ length: 28 }, (_, i) => {
  const a = (i / 28) * Math.PI * 2;
  const d = 70 + ((i * 37) % 70);
  return {
    '--dx': `${Math.round(Math.cos(a) * d * 1.6)}px`,
    '--dy': `${Math.round(Math.sin(a) * d)}px`,
    '--rot': `${(i % 2 ? 1 : -1) * (180 + ((i * 53) % 360))}deg`,
    width: 6 + (i % 3) * 3,
    height: 9 + ((i + 1) % 3) * 4,
    background: COLORS[i % COLORS.length],
    animationDelay: `${(i % 4) * 30}ms`,
  } as CSSProperties;
});

const Letters = ({ lines, step, animated }: { lines: string[]; step: number; animated: boolean }) => {
  let n = 0;
  return (
    <>
      {lines.map((line, li) => (
        <span key={li} className={styles.line}>
          {line.split(' ').map((word, wi) => (
            <span key={wi}>
              {wi > 0 && ' '}
              <span className={styles.word}>
                {Array.from(word).map((ch, ci) => (
                  <span
                    key={ci}
                    className={animated ? styles.letter : styles.plain}
                    style={animated ? { animationDelay: `${n++ * step}ms` } : undefined}
                  >
                    {ch}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </span>
      ))}
    </>
  );
};

/** Gold headline whose letters drop into place one after another, then burst into confetti and catch a sheen. */
export function FallingTitle({ lines, step = 70, play = true }: { lines: string[]; step?: number; play?: boolean }) {
  const [phase, setPhase] = useState<'waiting' | 'falling' | 'landed' | 'settled'>(play ? 'falling' : 'waiting');

  useEffect(() => {
    if (play && phase === 'waiting') setPhase('falling');
  }, [play, phase]);

  useEffect(() => {
    if (phase !== 'falling') return;
    const count = lines.join('').replace(/ /g, '').length;
    const landAt = (count - 1) * step + FALL_MS * IMPACT;
    const t1 = setTimeout(() => setPhase('landed'), landAt);
    const t2 = setTimeout(() => setPhase('settled'), landAt + 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase, lines, step]);

  return (
    <span className={styles.root} dir="rtl" data-phase={phase}>
      <span className={styles.sr}>{lines.join(' ')}</span>
      <span aria-hidden="true">
        <Letters lines={lines} step={step} animated />
      </span>
      {(phase === 'landed' || phase === 'settled') && (
        <span className={styles.sheen} aria-hidden="true">
          <Letters lines={lines} step={step} animated={false} />
        </span>
      )}
      {phase === 'landed' && (
        <span className={styles.burst} aria-hidden="true">
          {BURST.map((style, i) => (
            <i key={i} style={style} />
          ))}
        </span>
      )}
    </span>
  );
}
