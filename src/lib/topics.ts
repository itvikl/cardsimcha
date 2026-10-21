import { CATEGORIES, type Audience } from './categories';
import type { Db } from './types';

/**
 * A topic the admin typed while working behind one door belongs to that door.
 * Only claims topics nobody placed yet: built-in categories and topics already
 * in the carousel keep their audience (the carousel page is where they move).
 */
export function claimTopic(db: Db, topic: string, audience: Audience) {
  if (!topic || CATEGORIES.some((c) => c.name === topic) || db.carousel.some((s) => s.name === topic)) return;
  db.carousel.push({
    id: 's_' + encodeURIComponent(topic),
    name: topic,
    image: null,
    hidden: false,
    order: db.carousel.length,
    audience,
  });
}

export const parseAudience = (v: unknown): Audience | undefined => (v === 'business' || v === 'private' ? v : undefined);
