/** templates without a topic are listed here, so nothing becomes invisible */
export const GENERAL_TOPIC = 'כללי';

/** the home-page categories, in display order; `image` is the cover shown in the carousel */
export const CATEGORIES = [
  { name: 'בית כנסת', image: '/categories/synagogue.svg' },
  { name: 'תעודות', image: '/categories/certificates.svg' },
  { name: 'שלום זכר', image: '/categories/shalom-zachar.svg' },
  { name: 'שמחת בית השואבה', image: '/categories/simchat-beit-hashoeva.svg' },
  { name: 'חתונה', image: '/categories/wedding.svg' },
  { name: 'בר מצווה', image: '/categories/bar-mitzvah.svg' },
];

export const categoryHref = (name: string) => `/category/${encodeURIComponent(name)}`;

/** what GET /api/carousel returns, in the admin's order; `src` is `image` resolved to a URL */
export type CarouselSetting = { name: string; image: string | null; src: string | null; hidden: boolean };

export type HomeCard = { name: string; background: string };

/** the fixed categories first, then any other topic an admin gave a published template */
export function defaultCards(templates: { topic: string | null; thumbnail: string | null }[]): HomeCard[] {
  const list = CATEGORIES.map((c) => ({ name: c.name, background: `url(${c.image})` }));
  const known = new Set(list.map((c) => c.name));
  for (const t of templates) {
    const name = t.topic || GENERAL_TOPIC;
    if (known.has(name)) continue;
    known.add(name);
    list.push({
      name,
      background: t.thumbnail ? `url(${t.thumbnail})` : 'linear-gradient(135deg,#1a8059,#3ad29f)',
    });
  }
  return list;
}

/** Orders the cards as the admin chose and swaps in their images. Topics the admin never saw go last, visible. */
export function applyCarousel(cards: HomeCard[], settings: CarouselSetting[]): (HomeCard & { hidden: boolean })[] {
  const pos = new Map(settings.map((s, i) => [s.name, i]));
  return cards
    .map((c, i) => {
      const s = settings[pos.get(c.name) ?? -1];
      return {
        name: c.name,
        background: s?.src ? `url(${s.src})` : c.background,
        hidden: !!s?.hidden,
        rank: pos.get(c.name) ?? settings.length + i,
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...c }) => c);
}
