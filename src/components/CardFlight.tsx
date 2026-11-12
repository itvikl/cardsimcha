'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The card's flight from the home page's ring into the editor: the front card lifts off and grows to
 * where the editor will show it, then settles onto the real canvas and fades into it once the editor is ready.
 * It lives in the root layout so it survives the page change; the two ends talk to it through
 * flyCard (home page) and landCard (editor).
 */
type Flight = { from: DOMRect; image: string | null };

const bus = new EventTarget();
/** the editor's layout (see .editor in globals.css): header, toolbar, side panels */
const HEADER = 64;
const BAR = 60;
const ASIDE_LEFT = 300;
const ASIDE_RIGHT = 280;

export function flyCard(from: DOMRect, image: string | null) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  bus.dispatchEvent(new CustomEvent<Flight>('fly', { detail: { from, image } }));
}

/** The editor is ready: `to` is where its canvas sits (null when there is nothing to land on: just fade out). */
export function landCard(to: DOMRect | null) {
  bus.dispatchEvent(new CustomEvent<DOMRect | null>('land', { detail: to }));
}

/** where the editor will most likely show the card, before it exists: centred in the canvas area */
function estimate(from: DOMRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const narrow = vw <= 860;
  const area = narrow
    ? { left: 0, top: HEADER + BAR, width: vw, height: Math.min(vh * 0.68, 640) }
    : { left: ASIDE_LEFT, top: HEADER + BAR, width: vw - ASIDE_LEFT - ASIDE_RIGHT, height: vh - HEADER - BAR };
  const pad = narrow ? 14 : 28;
  const k = Math.min((area.width - 2 * pad) / from.width, (area.height - 2 * pad) / from.height);
  return {
    x: area.left + (area.width - from.width * k) / 2 - from.left,
    y: area.top + (area.height - from.height * k) / 2 - from.top,
    k,
  };
}

export function CardFlight() {
  const [flight, setFlight] = useState<Flight | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<Flight | null>(null);
  const landed = useRef(false);

  useEffect(() => {
    let safety = 0;
    const onFly = (e: Event) => {
      const f = (e as CustomEvent<Flight>).detail;
      landed.current = false;
      flightRef.current = f;
      setFlight(f);
      // never leave the card hanging if the editor does not report back
      clearTimeout(safety);
      safety = window.setTimeout(() => landCard(null), 8000);
    };
    const onLand = async (e: Event) => {
      const card = cardRef.current;
      const f = flightRef.current;
      if (!card || !f || landed.current) return;
      landed.current = true;
      clearTimeout(safety);
      const to = (e as CustomEvent<DOMRect | null>).detail;
      if (to && to.width > 0) {
        await card.animate(
          [{ transform: `translate(${to.left - f.from.left}px, ${to.top - f.from.top}px) scale(${to.width / f.from.width}, ${to.height / f.from.height})` }],
          { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards', composite: 'replace' },
        ).finished.catch(() => {});
      }
      const fade = { duration: 380, easing: 'ease-out', fill: 'forwards' } as const;
      veilRef.current?.animate([{ opacity: 0 }], fade);
      await card.animate([{ opacity: 0 }], fade).finished.catch(() => {});
      flightRef.current = null;
      setFlight(null);
    };
    bus.addEventListener('fly', onFly);
    bus.addEventListener('land', onLand);
    return () => {
      clearTimeout(safety);
      bus.removeEventListener('fly', onFly);
      bus.removeEventListener('land', onLand);
    };
  }, []);

  // lift off: rise a little toward the viewer, then grow into the editor's canvas area
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!flight || !card) return;
    const { x, y, k } = estimate(flight.from);
    card.animate(
      [
        { transform: 'translate(0, 0) scale(1)', boxShadow: '0 18px 36px rgba(60, 40, 20, 0.26)' },
        { offset: 0.3, transform: 'translate(0, -28px) scale(1.08)', boxShadow: '0 50px 90px rgba(60, 40, 20, 0.35)' },
        { transform: `translate(${x}px, ${y}px) scale(${k})`, boxShadow: '0 30px 70px rgba(60, 40, 20, 0.25)' },
      ],
      { duration: 900, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' },
    );
    veilRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out', fill: 'forwards' });
  }, [flight]);

  if (!flight) return null;
  const { from, image } = flight;
  return (
    <>
      <div ref={veilRef} className="card-flight-veil" aria-hidden="true" />
      <div
        ref={cardRef}
        className="card-flight"
        aria-hidden="true"
        style={{
          left: from.left,
          top: from.top,
          width: from.width,
          height: from.height,
          backgroundImage: image ? `url("${image}")` : undefined,
        }}
      />
    </>
  );
}
