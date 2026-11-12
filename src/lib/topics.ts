import { audienceOf, CATEGORIES, GENERAL_TOPIC, type Audience } from './categories';

/**
 * Every topic belongs to exactly one door, and a template's door is its topic's door.
 * So keeping the two doors apart comes down to: a template only gets a topic of the
 * door the admin is working behind. A category moves between doors only on the carousel
 * page, and its templates move with it.
 *
 * `topics` is every row of the topics table (src/lib/data/topics.ts): a topic used by any
 * template has a row, so a topic without one is new.
 */
export type TopicDoor = { name: string; audience: Audience };

/** the door a topic already belongs to, or undefined for a topic nobody used yet */
export function topicOwner(topics: TopicDoor[], topic: string): Audience | undefined {
  const row = topics.find((t) => t.name === topic);
  if (row) return row.audience;
  if (CATEGORIES.some((c) => c.name === topic) || topic === GENERAL_TOPIC) return audienceOf(topic);
  return undefined;
}

/** why `topic` can't be used behind `audience`'s door, or null when it can */
export function topicConflict(topics: TopicDoor[], topic: string, audience: Audience): string | null {
  // no topic means "כללי", which is on the private side
  if (!topic) return audience === 'business' ? 'לתבנית לעסקים צריך לבחור נושא.' : null;
  const owner = topicOwner(topics, topic);
  if (!owner || owner === audience) return null;
  const other = owner === 'business' ? 'לעסקים' : 'לשמחות';
  return `הנושא "${topic}" שייך לתבניות ${other}. בחרו נושא אחר, או העבירו את הקטגוריה בעמוד "קרוסלה".`;
}

export const parseAudience = (v: unknown): Audience | undefined => (v === 'business' || v === 'private' ? v : undefined);
