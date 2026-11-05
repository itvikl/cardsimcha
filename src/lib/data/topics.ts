import type { Prisma } from '@/generated/prisma/client';
import { audienceOf, type Audience } from '../categories';
import type { CarouselSlide } from '../types';
import type { TopicDoor } from '../topics';
import { prisma } from './prisma';

// Home-page topics (categories). One row per topic in use: the carousel settings of the
// admin plus every topic a template has. A row the admin never placed on the carousel page
// has sort_order -1 and is not part of the carousel setup.

type Tx = Prisma.TransactionClient;
const UNPLACED = -1;

/** every topic with its door, for the rules in src/lib/topics.ts */
export async function topicDoors(tx: Tx = prisma): Promise<TopicDoor[]> {
  return tx.topic.findMany({ select: { name: true, audience: true } });
}

/** the carousel setup, in the admin's order */
export async function listSlides(tx: Tx = prisma): Promise<CarouselSlide[]> {
  const rows = await tx.topic.findMany({ where: { sortOrder: { gte: 0 } }, orderBy: { sortOrder: 'asc' } });
  return rows.map((t) => ({ id: t.id, name: t.name, image: t.coverUrl, hidden: t.hidden, order: t.sortOrder, audience: t.audience }));
}

/**
 * The topic row for a template's topic, created when missing. With `door` (the admin is
 * working behind it) a new topic is placed on the carousel for that door; without it a new
 * topic gets the built-in default.
 */
export async function ensureTopic(tx: Tx, name: string, door?: Audience): Promise<string> {
  const found = await tx.topic.findUnique({ where: { name }, select: { id: true } });
  if (found) return found.id;
  const sortOrder = door ? await tx.topic.count({ where: { sortOrder: { gte: 0 } } }) : UNPLACED;
  const created = await tx.topic.create({ data: { name, audience: door ?? audienceOf(name), sortOrder } });
  return created.id;
}

/**
 * Replaces the carousel setup with `slides`, in order. Topics the page did not send keep
 * their row (e.g. a business topic whose templates are all drafts, so it doesn't lose its
 * door) and go after them.
 */
export async function replaceSlides(slides: { name: string; image: string | null; hidden: boolean; audience?: Audience }[]) {
  return prisma.$transaction(async (tx) => {
    const sent = new Set(slides.map((s) => s.name));
    const rest = (await listSlides(tx)).filter((s) => !sent.has(s.name));
    let order = 0;
    for (const s of slides) {
      const data = { coverUrl: s.image, hidden: s.hidden, sortOrder: order++, audience: s.audience ?? audienceOf(s.name) };
      await tx.topic.upsert({ where: { name: s.name }, update: data, create: { name: s.name, ...data } });
    }
    for (const s of rest) await tx.topic.update({ where: { id: s.id }, data: { sortOrder: order++ } });
    return listSlides(tx);
  });
}
