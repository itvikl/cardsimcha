'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import styles from './intro-envelope.module.css';

const OPEN_AT = 7400; // the overlay starts fading; the page behind starts its own entrance
const DONE_AT = 8100;

// background twinkles: [left %, top %, size px, delay s]
const TWINKLES: [number, number, number, number][] = [
  [8, 14, 14, 0], [18, 72, 10, 1.1], [27, 30, 8, 2.3], [12, 48, 6, 0.6], [86, 18, 12, 1.7], [92, 60, 9, 0.3],
  [78, 82, 14, 2.6], [70, 10, 7, 0.9], [40, 88, 8, 1.9], [58, 6, 10, 2.9], [96, 36, 6, 1.4], [4, 86, 9, 2.1],
];

// gold sparks thrown off when the seal cracks
const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  const d = 46 + ((i * 29) % 40);
  return { '--dx': `${Math.round(Math.cos(a) * d)}px`, '--dy': `${Math.round(Math.sin(a) * d)}px` } as CSSProperties;
});

/** Full-screen entrance: red curtains part, then an invitation envelope floats in, the wax seal glows and cracks, the flap opens,
 *  the letter rises and is read, then flies toward the viewer and reveals the page. */
export function IntroEnvelope({ onOpen, onDone }: { onOpen: () => void; onDone: () => void }) {
  const finished = useRef(false);
  const cb = useRef({ onOpen, onDone });
  cb.current = { onOpen, onDone };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    cb.current.onOpen();
    cb.current.onDone();
  };

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const t1 = setTimeout(() => !finished.current && cb.current.onOpen(), OPEN_AT);
    const t2 = setTimeout(finish, DONE_AT);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('keydown', onKey);
      html.style.overflow = prev;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.overlay}>
      <div className={styles.twinkles} aria-hidden="true">
        {TWINKLES.map(([left, top, size, delay], i) => (
          <i key={i} style={{ left: `${left}%`, top: `${top}%`, fontSize: size, animationDelay: `${delay}s` }}>
            ✦
          </i>
        ))}
      </div>

      <div className={styles.stage} aria-hidden="true">
        <div className={styles.float}>
          <div className={styles.env}>
            <div className={styles.back} />
            <div className={styles.letter}>
              <span className={styles.orn}>✦ ✦ ✦</span>
              <span className={styles.letterTitle}>הזמנה מיוחדת</span>
              <span className={styles.letterSub}>מחכה לאירוע שלכם</span>
            </div>
            <div className={styles.front} />
            <div className={styles.flap} />
            <div className={styles.seal}>
              <span className={styles.half} />
              <span className={`${styles.half} ${styles.right}`} />
              <span className={styles.sparks}>
                {SPARKS.map((style, i) => (
                  <i key={i} style={style} />
                ))}
              </span>
            </div>
          </div>
        </div>
        <p className={styles.caption}>קיבלתם הזמנה</p>
      </div>

      <div className={`${styles.curtain} ${styles.curtainL}`} aria-hidden="true" />
      <div className={`${styles.curtain} ${styles.curtainR}`} aria-hidden="true" />
      <span className={`${styles.tie} ${styles.tieL}`} aria-hidden="true" />
      <span className={`${styles.tie} ${styles.tieR}`} aria-hidden="true" />
      <div className={styles.valance} aria-hidden="true" />

      <button type="button" className={styles.skip} onClick={finish}>
        דלג
      </button>
    </div>
  );
}
