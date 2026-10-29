'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { Mood } from '@/lib/story';

const MOODS: Mood[] = ['candle', 'dawn', 'gold', 'evening'];
const bus = new EventTarget();

/**
 * Sets the light the whole site takes on for a simcha (null: the plain backdrop). See .site-backdrop in globals.css.
 * A page that sets one clears it when it unmounts.
 */
export function setMood(mood: Mood | null) {
  bus.dispatchEvent(new CustomEvent<Mood | null>('mood', { detail: mood }));
}

/**
 * The ambient bokeh behind every page (public/hero/<door>.mp4, its .webp poster underneath).
 * Fixed to the viewport, so the content scrolls over it; the business pages get their own loop.
 * Over it, one tint per mood: all are always there and only their opacity changes, so the light crossfades.
 */
export function SiteBackdrop() {
  const pathname = usePathname();
  const door = pathname.startsWith('/business') ? 'business' : 'private';
  const [motion, setMotion] = useState(false);
  const [mood, setMoodState] = useState<Mood | null>(null);

  // the loop plays only when motion is welcome; otherwise its still poster stays
  useEffect(() => setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

  useEffect(() => {
    const on = (e: Event) => setMoodState((e as CustomEvent<Mood | null>).detail);
    bus.addEventListener('mood', on);
    return () => bus.removeEventListener('mood', on);
  }, []);

  return (
    <div className="site-backdrop" data-door={door} data-mood={door === 'private' ? mood ?? undefined : undefined} aria-hidden="true">
      <div className="site-backdrop-media" style={{ backgroundImage: `url(/hero/${door}.webp)` }}>
        {motion && <video key={door} src={`/hero/${door}.mp4`} autoPlay muted loop playsInline />}
      </div>
      {MOODS.map((m) => (
        <span key={m} className={`site-mood site-mood-${m}`} />
      ))}
    </div>
  );
}
