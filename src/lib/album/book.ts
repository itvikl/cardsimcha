import type { Mood } from '@/lib/mood';

/**
 * The album's contents, laid out as a printed book: a title page, a contents page, and each chapter opening on a right-hand page
 * (Hebrew reads right to left, so a spread's right page comes first). The pages are drawn over a photograph of an open album.
 */

export type AlbumKind = { name: string; href: string; count: number | null };
export type AlbumDesign = { id: string; name: string; kind: string; image: string };
export type AlbumChapter = {
  id: string;
  name: string;
  lead: string;
  /** the photograph printed on its opening page */
  image: string | null;
  href: string;
  cta: string;
  mood: Mood | null;
  /** the ones shown large, a page each */
  designs: AlbumDesign[];
  /** every kind of card in the chapter that has designs, listed on its last page */
  kinds: AlbumKind[];
};

export type AlbumPage =
  | { type: 'title' }
  | { type: 'contents' }
  | { type: 'opener'; chapter: AlbumChapter; letter: string }
  | { type: 'design'; chapter: AlbumChapter; design: AlbumDesign }
  | { type: 'kinds'; chapter: AlbumChapter }
  | { type: 'end' }
  | { type: 'blank' };

export type AlbumSpread = { right: AlbumPage; left: AlbumPage; title: string };

export const LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];

/** the pages in reading order, paired into spreads; each chapter opens on a right-hand page */
export function buildBook(chapters: AlbumChapter[], designsPerChapter: number): AlbumSpread[] {
  const pages: { page: AlbumPage; title: string }[] = [
    { page: { type: 'title' }, title: 'פתיחה' },
    { page: { type: 'contents' }, title: 'תוכן העניינים' },
  ];
  chapters.forEach((chapter, i) => {
    // a right-hand page is an even place in the list
    if (pages.length % 2) pages.push({ page: { type: 'blank' }, title: pages[pages.length - 1].title });
    pages.push({ page: { type: 'opener', chapter, letter: LETTERS[i] ?? '' }, title: chapter.name });
    for (const design of chapter.designs.slice(0, designsPerChapter)) pages.push({ page: { type: 'design', chapter, design }, title: chapter.name });
    if (chapter.kinds.length > 1) pages.push({ page: { type: 'kinds', chapter }, title: chapter.name });
  });
  if (pages.length % 2) pages.push({ page: { type: 'end' }, title: 'סוף' });
  else pages.push({ page: { type: 'end' }, title: 'סוף' }, { page: { type: 'blank' }, title: 'סוף' });

  const spreads: AlbumSpread[] = [];
  for (let i = 0; i < pages.length; i += 2) spreads.push({ right: pages[i].page, left: pages[i + 1].page, title: pages[i].title });
  return spreads;
}

/** the spread a chapter opens on */
export const chapterSpread = (spreads: AlbumSpread[], id: string) =>
  spreads.findIndex((sp) => sp.right.type === 'opener' && sp.right.chapter.id === id);
