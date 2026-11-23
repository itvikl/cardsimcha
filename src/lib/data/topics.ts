import { audienceOf, type Audience } from '../categories';
import type { CarouselSlide } from '../types';
import type { TopicDoor } from '../topics';
import { newId } from './ids';
import { C, db, now, type Reader, type Tx } from './store';

// Home-page topics (categories), which are also the nodes of the occasion tree (tree.ts).
// One document per topic in use: the carousel settings of the admin plus every topic a
// template has. A topic the admin never placed on the carousel page has sortOrder -1 and is
// not part of the carousel setup.

export type TopicLevel = 'category' | 'event' | 'type';

export type TopicDoc = {
  id: string;
  name: string;
  /** null for a category; an event's parent is a category, a type's parent an event */
  parentId: string | null;
  level: TopicLevel;
  /** order among its siblings in the tree */
  position: number;
  audience: Audience;
  coverUrl: string | null;
  /** the old home-page carousel order; -1 when not on the carousel */
  sortOrder: number;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
};

const UNPLACED = -1;
export const LEVEL_RANK: Record<TopicLevel, number> = { category: 0, event: 1, type: 2 };

export function newTopic(fields: Partial<TopicDoc> & { name: string }): TopicDoc {
  const t = now();
  return {
    id: newId(), parentId: null, level: 'type', position: 0, audience: 'private', coverUrl: null,
    sortOrder: 0, hidden: false, createdAt: t, updatedAt: t, ...fields,
  };
}

export const allTopics = (r: Reader = db) => r.find<TopicDoc>(C.topics);

/** every topic with its door, for the rules in src/lib/topics.ts */
export async function topicDoors(r: Reader = db): Promise<TopicDoor[]> {
  return (await allTopics(r)).map((t) => ({ name: t.name, audience: t.audience }));
}

const toSlide = (t: TopicDoc): CarouselSlide => ({ id: t.id, name: t.name, image: t.coverUrl, hidden: t.hidden, order: t.sortOrder, audience: t.audience });
const slidesOf = (topics: TopicDoc[]) => topics.filter((t) => t.sortOrder >= 0).sort((a, b) => a.sortOrder - b.sortOrder);

/** the carousel setup, in the admin's order */
export async function listSlides(r: Reader = db): Promise<CarouselSlide[]> {
  return slidesOf(await allTopics(r)).map(toSlide);
}

/**
 * The pages from before the tree name a topic by its name, and since the tree a name can be
 * used twice (the event "חתונה" and its type "חתונה"). The one meant is the carousel's, then
 * the deepest (a type before an event before a category).
 */
export function pickByName(topics: TopicDoc[], name: string): TopicDoc | null {
  const hits = topics.filter((t) => t.name === name);
  hits.sort((a, b) => b.sortOrder - a.sortOrder || LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return hits[0] ?? null;
}

export async function topicByName(r: Reader, name: string) {
  const t = pickByName(await r.find<TopicDoc>(C.topics, ['name', '==', name]), name);
  return t && { id: t.id };
}

/**
 * The topic for a template's topic, created when missing. With `door` (the admin is working
 * behind it) a new topic is placed on the carousel for that door; without it a new topic gets
 * the built-in default.
 */
export async function ensureTopic(t: Tx, name: string, door?: Audience): Promise<string> {
  const found = await topicByName(t, name);
  if (found) return found.id;
  const sortOrder = door ? slidesOf(await allTopics(t)).length : UNPLACED;
  const created = newTopic({ name, audience: door ?? audienceOf(name), sortOrder });
  t.set(C.topics, created.id, created);
  return created.id;
}

/**
 * Replaces the carousel setup with `slides`, in order. Topics the page did not send keep
 * their document (e.g. a business topic whose templates are all drafts, so it doesn't lose
 * its door) and go after them.
 */
export async function replaceSlides(slides: { name: string; image: string | null; hidden: boolean; audience?: Audience }[]) {
  await db.tx(async (t) => {
    const topics = await allTopics(t);
    const sent = new Set(slides.map((s) => s.name));
    const rest = slidesOf(topics).filter((s) => !sent.has(s.name));
    let order = 0;
    const at = now();
    for (const s of slides) {
      const data = { coverUrl: s.image, hidden: s.hidden, sortOrder: order++, audience: s.audience ?? audienceOf(s.name), updatedAt: at };
      const row = pickByName(topics, s.name);
      if (row) t.update(C.topics, row.id, data);
      else {
        const created = newTopic({ name: s.name, ...data });
        t.set(C.topics, created.id, created);
      }
    }
    for (const s of rest) t.update(C.topics, s.id, { sortOrder: order++, updatedAt: at });
  });
  return listSlides();
}
