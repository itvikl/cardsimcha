"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import styles from "./card-cascade.module.css";

export type CascadeCard = {
  name: string;
  /** any CSS value for background: url(...), gradient etc. */
  background: string;
  /** when set, the card navigates there on click */
  href?: string;
  /** when set (and href isn't), the card runs this on click instead of navigating */
  onClick?: () => void;
};

type Props = {
  cards: CascadeCard[];
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  /** scroll-area height, in screens. the larger it is, the slower the animation */
  scrollScreens?: number;
  id?: string;
};

// [s, y%, z, rotateX, opacity, brightness]
const KEYS: number[][] = [
  [-1.2, -62, -300, 82, 0, 0.5],
  [0, -46, -200, 70, 1, 0.7],
  [0.38, -8, 0, 8, 1, 1],
  [0.58, 0, 20, 0, 1, 1], // crest: card stands upright
  [1, 105, 140, -30, 1, 0.6],
  [1.15, 160, 200, -45, 1, 0.45],
];
const CREST = 0.58;
const GAP = 0.55; // spacing between cards

// [left %, width px, height px, colour, duration s, delay s]
const CONFETTI: [number, number, number, string, number, number][] = [
  [6, 8, 14, "#f4b740", 11, 0], [14, 10, 10, "#ff8fab", 14, -6], [22, 6, 16, "#6fd3b0", 12, -3],
  [31, 9, 9, "#8ec5ff", 16, -9], [39, 7, 13, "#f4b740", 13, -1], [47, 10, 6, "#c39bff", 15, -11],
  [55, 6, 12, "#ff8fab", 12, -7], [63, 9, 9, "#6fd3b0", 17, -4], [71, 7, 15, "#f4b740", 14, -12],
  [79, 10, 7, "#8ec5ff", 11, -2], [86, 6, 14, "#ff8fab", 16, -8], [93, 9, 9, "#f4b740", 13, -5],
];

const ease = (t: number) => t * t * (3 - 2 * t);

function sample(s: number) {
  if (s <= KEYS[0][0]) return KEYS[0].slice(1);
  for (let k = 1; k < KEYS.length; k++) {
    if (s <= KEYS[k][0]) {
      const a = KEYS[k - 1];
      const b = KEYS[k];
      const t = ease((s - a[0]) / (b[0] - a[0]));
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
    }
  }
  return KEYS[KEYS.length - 1].slice(1);
}

export default function CardCascade({
  cards,
  eyebrow,
  title,
  description,
  scrollScreens = 7,
  id,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLElement>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const track = trackRef.current!;
    const deck = deckRef.current!;
    const n = cards.length;
    const total = 1.15 - CREST + (n - 1) * GAP;
    let target = 0;
    let cur = 0;
    let raf = 0;

    const read = () => {
      const r = track.getBoundingClientRect();
      const max = r.height - window.innerHeight;
      target = Math.min(1, Math.max(0, -r.top / (max || 1)));
    };

    const render = (p: number) => {
      const w = deck.clientWidth / 300;
      const prog = p * total;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const v = sample(prog + CREST - i * GAP);
        el.style.transform = `translate3d(0,${v[0]}%,${v[1] * w}px) rotateX(${v[2]}deg)`;
        el.style.opacity = String(v[3]);
        el.style.filter = `brightness(${v[4]})`;
      });
      const idx = Math.min(n, Math.max(1, Math.floor(prog / GAP + 0.5) + 1));
      if (countRef.current) countRef.current.textContent = String(idx).padStart(2, "0");
      if (dotRef.current) dotRef.current.style.top = `calc(${p * 100}% - ${p * 9}px)`;
    };

    const loop = () => {
      cur += (target - cur) * 0.14;
      if (Math.abs(target - cur) < 0.0002) cur = target;
      render(cur);
      raf = requestAnimationFrame(loop);
    };

    read();
    cur = target;
    render(cur);
    raf = requestAnimationFrame(loop);
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [cards.length]);

  return (
    <div
      ref={trackRef}
      id={id}
      className={styles.track}
      style={{ "--screens": scrollScreens } as CSSProperties}
    >
      <section className={styles.stage}>
        <div className={styles.frame}>
          <div className={styles.confetti} aria-hidden="true">
            {CONFETTI.map(([left, w, h, color, dur, delay], i) => (
              <i
                key={i}
                style={{ left: `${left}%`, width: w, height: h, background: color, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <div className={styles.hero}>
            {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
            <h2 className={styles.title}>{title}</h2>
            {description && <p className={styles.lede}>{description}</p>}
          </div>

          <div className={styles.well}>
            <div ref={deckRef} className={styles.deck}>
              {cards.map((c, i) =>
                c.href ? (
                  <Link
                    key={c.name}
                    ref={(el) => {
                      cardRefs.current[i] = el;
                    }}
                    href={c.href}
                    className={styles.card}
                    style={{ background: c.background, zIndex: cards.length - i }}
                  >
                    <span>{c.name}</span>
                  </Link>
                ) : c.onClick ? (
                  <button
                    key={c.name}
                    type="button"
                    ref={(el) => {
                      cardRefs.current[i] = el;
                    }}
                    onClick={c.onClick}
                    className={styles.card}
                    style={{ background: c.background, zIndex: cards.length - i, cursor: "pointer" }}
                  >
                    <span>{c.name}</span>
                  </button>
                ) : (
                  <div
                    key={c.name}
                    ref={(el) => {
                      cardRefs.current[i] = el;
                    }}
                    className={styles.card}
                    style={{ background: c.background, zIndex: cards.length - i }}
                  >
                    <span>{c.name}</span>
                  </div>
                )
              )}
            </div>
          </div>

          <div className={styles.meter}>
            <span ref={countRef} className={styles.count}>01</span>
            <div className={styles.rail}><b ref={dotRef} /></div>
            <span className={styles.total}>/ {String(cards.length).padStart(2, "0")}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
