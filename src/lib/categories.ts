/** templates without a topic are listed here, so nothing becomes invisible */
export const GENERAL_TOPIC = 'כללי';

/** the category whose designs a business can keep as its logo (see "זה הלוגו שלי" in the editor) */
export const LOGO_TOPIC = 'לוגו';

/** who a category is for: the home page has a door for each (`/` and `/business`) */
export type Audience = 'private' | 'business';

/**
 * The home-page categories, in display order (the admin can reorder them in /carousel).
 * `image` is the built-in cover; null until one is made: the ring then shows a plain gilded card with the name,
 * and the admin can pick a picture for it in /carousel.
 */
export const CATEGORIES: { name: string; image: string | null; audience: Audience; hidden?: boolean }[] = [
  { name: 'חתונה', image: '/categories/wedding.webp', audience: 'private' },
  { name: 'אירוסין', image: null, audience: 'private' },
  { name: 'קידוש', image: null, audience: 'private' },
  { name: 'שלום זכר', image: '/categories/shalom-zachar.webp', audience: 'private' },
  { name: 'ברית', image: null, audience: 'private' },
  { name: 'וואך נאכט', image: null, audience: 'private' },
  { name: 'פדיון הבן', image: null, audience: 'private' },
  { name: 'חלאקה', image: null, audience: 'private' },
  { name: 'לידת בן', image: null, audience: 'private' },
  { name: 'לידת בת', image: null, audience: 'private' },
  { name: 'בר מצווה', image: '/categories/bar-mitzvah.webp', audience: 'private' },
  { name: 'חנוכת הבית', image: null, audience: 'private' },
  { name: 'בית כנסת', image: '/categories/synagogue.webp', audience: 'private' },
  { name: 'תעודות', image: '/categories/certificates.webp', audience: 'private' },
  { name: 'שמחת בית השואבה', image: '/categories/simchat-beit-hashoeva.webp', audience: 'private' },
  { name: 'ברכות', image: '/categories/greetings.webp', audience: 'private' },
  { name: 'איחולים', image: '/categories/wishes.webp', audience: 'private' },
  { name: 'מיתוג שמחה', image: '/categories/simcha-set.webp', audience: 'private' },
  { name: 'ייעוץ משכנתאות', image: '/categories/mortgage.webp', audience: 'business' },
  { name: 'מיזוג אוויר', image: '/categories/air-conditioning.webp', audience: 'business' },
  { name: 'ייעוץ עסקי', image: '/categories/consulting.webp', audience: 'business' },
  { name: LOGO_TOPIC, image: '/categories/logo.webp', audience: 'business' },
  { name: 'זמני שבת', image: '/categories/shabbat.webp', audience: 'business' },
  { name: 'מודעות מבצע', image: '/categories/sale.webp', audience: 'business' },
  { name: 'פתיחת עסק', image: '/categories/opening.webp', audience: 'business' },
  { name: 'פוסטים לרשתות', image: '/categories/social.webp', audience: 'business' },
  { name: 'מודעה חופשית', image: null, audience: 'business' },
  // not advertising, so they step back from the door; the admin can bring them back in /carousel
  { name: 'כרטיסי ביקור', image: '/categories/business-cards.webp', audience: 'business', hidden: true },
  { name: 'תפריטים', image: '/categories/menus.webp', audience: 'business', hidden: true },
];

/**
 * The private door's ring: three cards, each opening a screen of its kinds of cards; with the business door, the site's
 * four parts. An invitation is anything that invites, big or small. Branding an event is the rest of what it needs around it.
 */
export const PRIVATE_GROUPS: { id: string; name: string; image: string; lead: string; topics: string[] }[] = [
  {
    id: 'invitations',
    name: 'הזמנות',
    image: '/categories/wedding.webp',
    lead: 'הזמנה לכל שמחה, מהחתונה ועד שלום זכר.',
    topics: ['חתונה', 'אירוסין', 'בר מצווה', 'ברית', 'פדיון הבן', 'חנוכת הבית', 'שלום זכר', 'וואך נאכט', 'קידוש', 'חלאקה', 'לידת בן', 'לידת בת'],
  },
  {
    id: 'wishes',
    name: 'ברכות ואיחולים',
    image: '/categories/wishes.webp',
    lead: 'ברכות, איחולים ותעודות לאנשים שלכם.',
    topics: ['ברכות', 'איחולים', 'תעודות'],
  },
  {
    id: 'events',
    name: 'מיתוג אירועים',
    image: '/categories/simcha-set.webp',
    lead: 'כותבים את הפרטים פעם אחת, ומקבלים את כל מה שצריך לאירוע באותו עיצוב.',
    topics: ['מיתוג שמחה', 'שמחת בית השואבה', 'בית כנסת'],
  },
];

/** a private topic's group; topics no group names (free ones, "כללי") go in the first, so nothing becomes invisible */
export const groupOf = (topic: string) => PRIVATE_GROUPS.find((g) => g.topics.includes(topic)) ?? PRIVATE_GROUPS[0];

export const groupHref = (id: string) => `/group/${id}`;

/** one shortcut to a kind of cards */
export type QuickLink = { name: string; topic: string };

/** The shortcuts along the top of the private side, for what people most often come for; one with `items` opens a list. */
export const QUICK_LINKS: (QuickLink | { name: string; items: QuickLink[] })[] = [
  {
    name: 'לידת בן',
    items: [
      { name: 'הודעה על לידה', topic: 'לידת בן' },
      { name: 'שלום זכר', topic: 'שלום זכר' },
      { name: 'וואך נאכט', topic: 'וואך נאכט' },
      { name: 'ברית', topic: 'ברית' },
      { name: 'פדיון הבן', topic: 'פדיון הבן' },
    ],
  },
  {
    name: 'לידת בת',
    items: [
      { name: 'הודעה על לידה', topic: 'לידת בת' },
      { name: 'קידוש', topic: 'קידוש' },
    ],
  },
  { name: 'קידוש', topic: 'קידוש' },
  { name: 'חלאקה', topic: 'חלאקה' },
  { name: 'בר מצווה', topic: 'בר מצווה' },
  { name: 'אירוסין', topic: 'אירוסין' },
  { name: 'חתונה', topic: 'חתונה' },
  { name: 'ברכות', topic: 'ברכות' },
];

/** the built-in default: topics an admin typed freely (not in CATEGORIES) belong to the private side */
export const audienceOf = (name: string): Audience => CATEGORIES.find((c) => c.name === name)?.audience ?? 'private';

/** the admin's choice (saved with the carousel) wins over the built-in default */
export const topicAudience = (name: string, settings: { name: string; audience: Audience }[]): Audience =>
  settings.find((s) => s.name === name)?.audience ?? audienceOf(name);

/** a category's page; business categories live under /business so the page keeps that door's theme */
export const categoryHref = (name: string, audience: Audience = 'private') =>
  `${audience === 'business' ? '/business' : ''}/category/${encodeURIComponent(name)}`;

/** a category's name from its URL segment (encoded by categoryHref; a malformed one is kept as it is) */
export const decodeTopic = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** what GET /api/carousel returns, in the admin's order; `src` is `image` resolved to a URL */
export type CarouselSetting = { name: string; image: string | null; src: string | null; hidden: boolean; audience: Audience };

/** `image` is the cover's URL (null: none, `background` then holds a gradient); `background` is it as a CSS value */
export type HomeCard = { name: string; image: string | null; background: string; hidden?: boolean };

/** the fixed categories first, then any other topic an admin gave a published template */
export function defaultCards(templates: { topic: string | null; thumbnail: string | null }[]): HomeCard[] {
  const list: HomeCard[] = CATEGORIES.map((c) => {
    // no built-in cover yet: one of the category's own designs, else a plain gilded card (see MirrorRing)
    const image = c.image ?? templates.find((t) => (t.topic || GENERAL_TOPIC) === c.name && t.thumbnail)?.thumbnail ?? null;
    return { name: c.name, image, hidden: c.hidden, background: image ? `url(${image})` : 'linear-gradient(160deg, #fbf6ec, #efe2c8)' };
  });
  const known = new Set(list.map((c) => c.name));
  for (const t of templates) {
    const name = t.topic || GENERAL_TOPIC;
    if (known.has(name)) continue;
    known.add(name);
    list.push({
      name,
      image: t.thumbnail,
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
        image: s?.src ?? c.image,
        background: s?.src ? `url(${s.src})` : c.background,
        // the admin's choice wins over the built-in default
        hidden: s ? !!s.hidden : !!c.hidden,
        rank: pos.get(c.name) ?? settings.length + i,
      };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _, ...c }) => c);
}
