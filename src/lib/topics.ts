import { audienceOf, CATEGORIES, GENERAL_TOPIC, type Audience } from './categories';
import type { Db } from './types';

/**
 * Every topic belongs to exactly one door, and a template's door is its topic's door.
 * So keeping the two doors apart comes down to: a template only gets a topic of the
 * door the admin is working behind. A category moves between doors only on the carousel
 * page, and its templates move with it.
 */

/** the door a topic already belongs to, or undefined for a topic nobody used yet */
export function topicOwner(db: Db, topic: string): Audience | undefined {
  const slide = db.carousel.find((s) => s.name === topic);
  if (slide) return slide.audience ?? audienceOf(topic);
  if (CATEGORIES.some((c) => c.name === topic) || topic === GENERAL_TOPIC) return audienceOf(topic);
  // a free topic already on some template, never placed on the carousel page: the private default
  return db.projects.some((p) => p.kind === 'template' && p.topic === topic) ? 'private' : undefined;
}

/** why `topic` can't be used behind `audience`'s door, or null when it can */
export function topicConflict(db: Db, topic: string, audience: Audience): string | null {
  // no topic means "כללי", which is on the private side
  if (!topic) return audience === 'business' ? 'לתבנית לעסקים צריך לבחור נושא.' : null;
  const owner = topicOwner(db, topic);
  if (!owner || owner === audience) return null;
  const other = owner === 'business' ? 'לעסקים' : 'לשמחות';
  return `הנושא "${topic}" שייך לתבניות ${other}. בחרו נושא אחר, או העבירו את הקטגוריה בעמוד "קרוסלה".`;
}

/** a new topic typed behind one door is recorded for that door */
export function claimTopic(db: Db, topic: string, audience: Audience) {
  if (!topic || topicOwner(db, topic)) return;
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
