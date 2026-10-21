/** templates without a topic are listed here, so nothing becomes invisible */
export const GENERAL_TOPIC = 'כללי';

/** who a category is for: the home page has a door for each (`/` and `/business`) */
export type Audience = 'private' | 'business';

/** the home-page categories, in display order; `image` is the cover shown in the carousel */
export const CATEGORIES: { name: string; image: string; audience: Audience }[] = [
  { name: 'בית כנסת', image: '/categories/synagogue.svg', audience: 'private' },
  { name: 'תעודות', image: '/categories/certificates.svg', audience: 'private' },
  { name: 'שלום זכר', image: '/categories/shalom-zachar.svg', audience: 'private' },
  { name: 'שמחת בית השואבה', image: '/categories/simchat-beit-hashoeva.svg', audience: 'private' },
  { name: 'חתונה', image: '/categories/wedding.svg', audience: 'private' },
  { name: 'בר מצווה', image: '/categories/bar-mitzvah.svg', audience: 'private' },
  { name: 'מודעות מבצע', image: '/categories/sale.svg', audience: 'business' },
  { name: 'פתיחת עסק', image: '/categories/opening.svg', audience: 'business' },
  { name: 'לוגו', image: '/categories/logo.svg', audience: 'business' },
  { name: 'כרטיסי ביקור', image: '/categories/business-cards.svg', audience: 'business' },
  { name: 'פוסטים לרשתות', image: '/categories/social.svg', audience: 'business' },
  { name: 'תפריטים', image: '/categories/menus.svg', audience: 'business' },
];

/** topics an admin typed freely (not in CATEGORIES) belong to the private side */
export const audienceOf = (name: string): Audience => CATEGORIES.find((c) => c.name === name)?.audience ?? 'private';

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
