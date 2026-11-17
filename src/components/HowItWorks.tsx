'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import s from './festive.module.css';
import h from './how.module.css';

const STEPS = [
  { title: 'בוחרים עיצוב', text: 'הזמנה, ברכה או תעודה, לפי סוג השמחה.' },
  { title: 'ממלאים את הפרטים', text: 'שמות, תאריך ומקום. הכרטיס מתעדכן מולכם.' },
  { title: 'שולחים לאורחים', text: 'קובץ מוכן לוואטסאפ או להדפסה.' },
];
const NAMES = 'שרה ודוד';
const DATE = 'יום שלישי · כ״ה בכסלו';
/** where the fanned designs sit, by place from the middle; the middle one is the invitation that gets chosen */
const FAN = [-2, -1, 1, 2];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * "איך זה עובד" told by one card while the page scrolls past: it is picked from a fan of real designs, the names are
 * written onto it letter by letter, and it goes into a phone as a WhatsApp message. The section is three screens
 * tall and its stage stays put; scroll progress drives everything, written straight to CSS variables.
 * With reduced motion it stays the plain list of three steps.
 */
export function HowItWorks({ images }: { images: string[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const namesRef = useRef<HTMLSpanElement>(null);
  const fieldRef = useRef<HTMLSpanElement>(null);
  const dateRef = useRef<HTMLSpanElement>(null);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!motion) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const track = trackRef.current;
      const stage = stageRef.current;
      if (!track || !stage) return;
      const r = track.getBoundingClientRect();
      const sticky = track.firstElementChild as HTMLElement;
      const p = clamp01(-r.top / Math.max(1, r.height - sticky.offsetHeight));
      // three chapters, each a third of the way, with a short rest at the end of each
      const local = (i: number) => clamp01((p - i / 3) / (1 / 3 - 0.04));
      const [p1, p2, p3] = [local(0), local(1), local(2)];
      const q1 = ease(clamp01((p1 - 0.35) / 0.65));
      const vars: Record<string, number> = { '--q1': q1, '--tap': clamp01((p1 - 0.2) / 0.3) * (1 - q1), '--e2': ease(p2), '--e3': ease(p3), '--p': p };
      for (const [k, v] of Object.entries(vars)) track.style.setProperty(k, v.toFixed(4));
      track.dataset.step = String(p3 > 0 ? 3 : p2 > 0 ? 2 : 1);
      // the names, then the date, typed in as the second chapter goes by
      const names = NAMES.slice(0, Math.round(clamp01(p2 / 0.5) * NAMES.length));
      const date = DATE.slice(0, Math.round(clamp01((p2 - 0.5) / 0.4) * DATE.length));
      if (namesRef.current) namesRef.current.textContent = names;
      if (fieldRef.current) fieldRef.current.textContent = names;
      if (dateRef.current) dateRef.current.textContent = date;
      stage.dataset.typing = String(p2 > 0 && p2 < 1);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [motion]);

  if (!motion) {
    return (
      <section id="how" className={`${s.wrap} ${s.catSection}`}>
        <h2 className={s.sectionTitle}>איך זה עובד</h2>
        <ol className={s.howSteps}>
          {STEPS.map((st) => (
            <li key={st.title}>
              <strong>{st.title}</strong>
              <span>{st.text}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section id="how" className={`${s.catSection} ${h.how}`}>
      <div ref={trackRef} className={h.track} data-step="1">
        <div className={h.sticky}>
          <div className={h.copy}>
            <h2 className={s.sectionTitle}>איך זה עובד</h2>
            <ol className={h.steps}>
              {STEPS.map((st, i) => (
                <li key={st.title} data-n={i + 1}>
                  <span className={h.num}>{i + 1}</span>
                  <span className={h.stepText}>
                    <strong>{st.title}</strong>
                    <span>{st.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div ref={stageRef} className={h.stage} aria-hidden="true">
            <div className={h.phone}>
              <div className={h.chatHead}>
                <span className={h.avatar} />
                <span>
                  <strong>המשפחה</strong>
                  <small>32 משתתפים</small>
                </span>
              </div>
            </div>
            <div className={h.bubble}>
              <span className={h.meta}>20:41 <b>✓✓</b></span>
            </div>

            {images.slice(0, FAN.length).map((src, i) => (
              <div key={src} className={h.fan} style={{ '--k': FAN[i], zIndex: 3 - Math.abs(FAN[i]) } as CSSProperties}>
                <img src={src} alt="" decoding="async" />
              </div>
            ))}

            <div className={h.card}>
              <div className={h.frame}>
                <span className={h.bsd}>בס״ד</span>
                <span className={h.kicker}>בשעה טובה ומוצלחת</span>
                <span className={h.invite}>הזמנה לחתונה</span>
                <span className={h.names}>
                  <span ref={namesRef} />
                  <i className={h.caret} />
                </span>
                <span className={h.rule} />
                <span className={h.date} ref={dateRef} />
                <span className={h.venue}>אולמי הגן, ירושלים</span>
              </div>
              <span className={h.tap} />
            </div>

            <div className={h.field}>
              <small>שמות החתן והכלה</small>
              <span>
                <span ref={fieldRef} />
                <i className={h.caret} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
