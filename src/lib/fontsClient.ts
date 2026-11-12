import type { FontAsset } from './types';

export type UploadedFont = Pick<FontAsset, 'id' | 'family' | 'file' | 'customer'>;

let loading: Promise<UploadedFont[]> | null = null;

/** Registers the fonts an admin uploaded with this page, once per page load. A font that doesn't load falls back like any other. */
export function loadUploadedFonts(): Promise<UploadedFont[]> {
  loading ??= fetch('/api/fonts')
    .then((r) => (r.ok ? (r.json() as Promise<UploadedFont[]>) : []))
    .then(async (list) => {
      await Promise.allSettled(
        list.map(async (f) => {
          const face = new FontFace(f.family, `url(/api/uploads/${f.file})`);
          document.fonts.add(await face.load());
        }),
      );
      return list;
    })
    .catch(() => []);
  return loading;
}
