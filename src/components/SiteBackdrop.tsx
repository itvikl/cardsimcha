'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The ambient bokeh behind every page (public/hero/<door>.mp4, its .webp poster underneath).
 * Fixed to the viewport, so the content scrolls over it; the business pages get their own loop.
 */
export function SiteBackdrop() {
  const door = usePathname().startsWith('/business') ? 'business' : 'private';
  const [motion, setMotion] = useState(false);

  // the loop plays only when motion is welcome; otherwise its still poster stays
  useEffect(() => setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

  return (
    <div className="site-backdrop" data-door={door} aria-hidden="true">
      <div className="site-backdrop-media" style={{ backgroundImage: `url(/hero/${door}.webp)` }}>
        {motion && <video key={door} src={`/hero/${door}.mp4`} autoPlay muted loop playsInline />}
      </div>
    </div>
  );
}
