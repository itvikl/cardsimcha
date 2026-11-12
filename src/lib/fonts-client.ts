'use client';

import type { UploadedFont } from './fonts';

/**
 * Registers uploaded fonts with the browser (FontFace). Registering does not download anything:
 * a file is fetched when `loadFont` (or text drawn on the page) asks for its family and weight.
 */
const added = new Set<string>();

export function registerFonts(fonts: UploadedFont[]) {
  for (const f of fonts) {
    if (added.has(f.id)) continue;
    added.add(f.id);
    document.fonts.add(new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight), style: f.style, display: 'swap' }));
  }
}

let listed: Promise<UploadedFont[]> | null = null;

/** Fetches the uploaded fonts once per page and registers them. */
export function registerUploadedFonts(): Promise<UploadedFont[]> {
  listed ??= fetch('/api/fonts')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(({ fonts }: { fonts: UploadedFont[] }) => {
      registerFonts(fonts);
      return fonts;
    })
    .catch(() => {
      listed = null; // try again next time
      return [];
    });
  return listed;
}

/** Resolves when the family is ready to draw (or failed to load: the canvas then falls back). */
export function loadFont(family: string, weight: number) {
  return document.fonts.load(`${weight} 16px "${family}"`, 'אבגabc').catch(() => []);
}
