import type { Prisma, TopicLevel } from '@/generated/prisma/client';
import type { Audience } from '../categories';
import { prisma } from './prisma';

// The occasion tree: קטגוריה → אירוע → סוג (see the Topic model). Every node is a row of
// `topics`; a template or a background is filed on one or more nodes through
// `template_places` / `asset_places`, and shows in everything under a node it is filed on.
//
// Rows from before the tree sit at the root with level "type" until the admin places them;
// they are listed apart as "not in the tree yet".

type Tx = Prisma.TransactionClient;

export type TreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  level: TopicLevel;
  position: number;
  audience: Audience;
  /** templates / library images filed directly on this node */
  templates: number;
  assets: number;
};

export type UnfiledTemplate = { id: string; name: string; status: string; thumbnail: string | null };

/** "what it is": a product label beside the tree, per door */
export type Label = { id: string; name: string; audience: Audience; position: number; templates: number };

export type Tree = { nodes: TreeNode[]; unfiled: UnfiledTemplate[]; labels: Label[] };

const CHILD: Record<TopicLevel, TopicLevel | null> = { category: 'event', event: 'type', type: null };
/** what a node becomes under `parent` (a root node is a category) */
const levelUnder = (parent: { level: TopicLevel } | null): TopicLevel | null => (parent ? CHILD[parent.level] : 'category');

export const LEVEL_NAME: Record<TopicLevel, string> = { category: 'קטגוריה', event: 'אירוע', type: 'סוג' };

export async function getTree(): Promise<Tree> {
  const [rows, unfiled, labels] = await Promise.all([
    prisma.topic.findMany({
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { templatePlaces: true, assetPlaces: true, templates: true } } },
    }),
    prisma.template.findMany({
      where: { places: { none: {} } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, status: true, thumbnailKey: true, updatedAt: true },
    }),
    listLabels(),
  ]);
  return {
    nodes: rows.map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
      level: t.level,
      position: t.position,
      audience: t.audience,
      // a topic outside the tree is only read by the pages from before it, through the old single topic
      templates: t.parentId === null && t.level !== 'category' ? t._count.templates : t._count.templatePlaces,
      assets: t._count.assetPlaces,
    })),
    labels,
    unfiled: unfiled.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      thumbnail: t.thumbnailKey ? `/api/thumbnails/${t.id}?v=${t.updatedAt.getTime()}` : null,
    })),
  };
}

export type TreeError = { error: string; status: number };
const fail = (error: string, status = 400): TreeError => ({ error, status });

async function siblingTaken(tx: Tx, parentId: string | null, name: string, except?: string) {
  const hit = await tx.topic.findFirst({
    // a root that isn't a category yet is not a sibling of the categories
    where: { parentId, name, ...(parentId === null && { level: 'category' }), ...(except && { id: { not: except } }) },
    select: { id: true },
  });
  return !!hit;
}

const nextPosition = async (tx: Tx, parentId: string | null) =>
  ((await tx.topic.aggregate({ where: { parentId }, _max: { position: true } }))._max.position ?? -1) + 1;

/** a new node under `parentId` (or a new category, for `audience`'s door) */
export async function createNode(input: { name: string; parentId: string | null; audience?: Audience }): Promise<TreeNode | TreeError> {
  return prisma.$transaction(async (tx) => {
    const parent = input.parentId ? await tx.topic.findUnique({ where: { id: input.parentId } }) : null;
    if (input.parentId && !parent) return fail('המקום בעץ לא נמצא', 404);
    if (parent && parent.parentId === null && parent.level !== 'category') return fail('קודם משבצים את הפריט הזה בעץ');
    const level = levelUnder(parent);
    if (!level) return fail('אין רמה מתחת לסוג');
    if (await siblingTaken(tx, input.parentId, input.name)) return fail(`כבר יש כאן "${input.name}"`, 409);
    const row = await tx.topic.create({
      data: {
        name: input.name,
        parentId: input.parentId,
        level,
        audience: parent?.audience ?? input.audience ?? 'private',
        position: await nextPosition(tx, input.parentId),
        sortOrder: -1,
      },
    });
    return { id: row.id, name: row.name, parentId: row.parentId, level: row.level, position: row.position, audience: row.audience, templates: 0, assets: 0 };
  });
}

export async function renameNode(id: string, name: string): Promise<{ ok: true } | TreeError> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.topic.findUnique({ where: { id } });
    if (!row) return fail('לא נמצא', 404);
    if (row.name === name) return { ok: true as const };
    if (await siblingTaken(tx, row.parentId, name, id)) return fail(`כבר יש כאן "${name}"`, 409);
    await tx.topic.update({ where: { id }, data: { name } });
    return { ok: true as const };
  });
}

/** every node under `id`, deepest last */
async function descendants(tx: Tx, id: string): Promise<string[]> {
  const out: string[] = [];
  let layer = [id];
  while (layer.length) {
    const kids = await tx.topic.findMany({ where: { parentId: { in: layer } }, select: { id: true } });
    layer = kids.map((k) => k.id);
    out.push(...layer);
  }
  return out;
}

/**
 * Moves a node under `parentId` (null: to the root, as a category) at `index` among its new
 * siblings. A node takes the level its new place gives it; one with children keeps its level,
 * so an event moves only to another category and a type only to another event.
 */
export async function moveNode(id: string, parentId: string | null, index?: number): Promise<{ ok: true } | TreeError> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.topic.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
    if (!row) return fail('לא נמצא', 404);
    const parent = parentId ? await tx.topic.findUnique({ where: { id: parentId } }) : null;
    if (parentId && !parent) return fail('המקום בעץ לא נמצא', 404);
    if (parent && parent.parentId === null && parent.level !== 'category') return fail('אי אפשר לשבץ תחת פריט שעוד לא בעץ');
    if (parentId && (parentId === id || (await descendants(tx, id)).includes(parentId))) return fail('אי אפשר להעביר פריט לתוך עצמו');
    const level = levelUnder(parent);
    if (!level) return fail('אין רמה מתחת לסוג');
    if (row._count.children && level !== row.level) {
      return fail(`ל"${row.name}" יש פריטים בתוכו, אז הוא נשאר ${LEVEL_NAME[row.level]} ועובר רק למקום של ${LEVEL_NAME[row.level]}`);
    }
    if (await siblingTaken(tx, parentId, row.name, id)) return fail(`כבר יש שם "${row.name}"`, 409);

    // the new siblings in order, with this node put in at `index`
    const siblings = (
      await tx.topic.findMany({
        where: { parentId, id: { not: id }, ...(parentId === null && { level: 'category' }) },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { id: true },
      })
    ).map((s) => s.id);
    const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    siblings.splice(at, 0, id);

    const audience = parent?.audience ?? row.audience;
    await tx.topic.update({ where: { id }, data: { parentId, level, audience } });
    for (const [i, s] of siblings.entries()) await tx.topic.update({ where: { id: s }, data: { position: i } });
    if (audience !== row.audience) {
      const under = await descendants(tx, id);
      if (under.length) await tx.topic.updateMany({ where: { id: { in: under } }, data: { audience } });
    }
    return { ok: true as const };
  });
}

/** deletes an empty node: no nodes under it and nothing filed on it */
export async function deleteNode(id: string): Promise<{ ok: true } | TreeError> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.topic.findUnique({
      where: { id },
      include: { _count: { select: { children: true, templatePlaces: true, assetPlaces: true, templates: true } } },
    });
    if (!row) return fail('לא נמצא', 404);
    const c = row._count;
    if (c.children) return fail(`ב"${row.name}" יש עוד פריטים. קודם מעבירים או מוחקים אותם.`);
    if (c.templatePlaces || c.assetPlaces || c.templates) return fail(`על "${row.name}" יש עיצובים או רקעים. קודם משייכים אותם למקום אחר.`);
    await tx.topic.delete({ where: { id } });
    return { ok: true as const };
  });
}

/** checks that `ids` are nodes of the tree (not topics left outside it), all behind `door` when given */
async function checkPlaces(tx: Tx, ids: string[], door?: Audience): Promise<TreeError | null> {
  const rows = await tx.topic.findMany({ where: { id: { in: ids } }, select: { name: true, parentId: true, level: true, audience: true } });
  if (rows.length !== ids.length) return fail('אחד המקומות בעץ לא נמצא', 404);
  const loose = rows.find((r) => r.parentId === null && r.level !== 'category');
  if (loose) return fail(`"${loose.name}" עוד לא בעץ, אז אי אפשר לשייך אליו`);
  const other = door && rows.find((r) => r.audience !== door);
  if (other) return fail(`"${other.name}" שייך ל${other.audience === 'business' ? 'עסקים' : 'שמחות'}. בוחרים מקום מאותה דלת.`);
  return null;
}

/**
 * Files a template on these nodes, replacing where it was (`topicIds` undefined leaves them),
 * and sets its label when `labelId` is given (null clears it). The first place is also kept as
 * the template's single topic, which the pages from before the tree read; a template those
 * pages still list under a topic outside the tree keeps that one until they move to the tree.
 */
export async function setTemplatePlaces(
  templateId: string,
  topicIds: string[] | undefined,
  labelId?: string | null,
  door?: Audience,
  inTx?: Tx,
): Promise<{ ok: true } | TreeError> {
  const run = async (tx: Tx): Promise<{ ok: true } | TreeError> => {
    const t = await tx.template.findUnique({ where: { id: templateId }, select: { topic: { select: { parentId: true, level: true } } } });
    if (!t) return fail('העיצוב לא נמצא', 404);
    if (labelId) {
      const label = await tx.productLabel.findUnique({ where: { id: labelId }, select: { audience: true } });
      if (!label) return fail('התווית לא נמצאה', 404);
      if (door && label.audience !== door) return fail('התווית שייכת לדלת השנייה');
    }
    if (topicIds) {
      const ids = [...new Set(topicIds)];
      const why = await checkPlaces(tx, ids, door);
      if (why) return why;
      await tx.templatePlace.deleteMany({ where: { templateId } });
      if (ids.length) await tx.templatePlace.createMany({ data: ids.map((topicId) => ({ templateId, topicId })) });
      const legacy = t.topic && t.topic.parentId === null && t.topic.level !== 'category';
      if (!legacy) await tx.template.update({ where: { id: templateId }, data: { topicId: ids[0] ?? null } });
    }
    if (labelId !== undefined) await tx.template.update({ where: { id: templateId }, data: { labelId } });
    return { ok: true as const };
  };
  return inTx ? run(inTx) : prisma.$transaction(run);
}

/** setTemplatePlaces for several templates at once, all or none */
export async function setTemplatesPlaces(
  templateIds: string[],
  topicIds: string[] | undefined,
  labelId?: string | null,
  door?: Audience,
): Promise<{ ok: true } | TreeError> {
  try {
    return await prisma.$transaction(async (tx) => {
      for (const id of new Set(templateIds)) {
        const r = await setTemplatePlaces(id, topicIds, labelId, door, tx);
        if ('error' in r) throw r;
      }
      return { ok: true as const };
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'error' in e && 'status' in e) return e as TreeError;
    throw e;
  }
}

/** files library images (backgrounds) on these nodes, replacing where each of them was */
export async function setAssetPlaces(assetIds: string | string[], topicIds: string[]): Promise<{ ok: true } | TreeError> {
  return prisma.$transaction(async (tx) => {
    const assets = [...new Set(Array.isArray(assetIds) ? assetIds : [assetIds])];
    const ids = [...new Set(topicIds)];
    if ((await tx.asset.count({ where: { id: { in: assets } } })) !== assets.length) return fail('אחת התמונות לא נמצאה', 404);
    const why = await checkPlaces(tx, ids);
    if (why) return why;
    await tx.assetPlace.deleteMany({ where: { assetId: { in: assets } } });
    const rows = assets.flatMap((assetId) => ids.map((topicId) => ({ assetId, topicId })));
    if (rows.length) await tx.assetPlace.createMany({ data: rows });
    return { ok: true as const };
  });
}

/** where each library image is filed: asset id → node ids */
export async function assetPlaces(): Promise<Record<string, string[]>> {
  const rows = await prisma.assetPlace.findMany({ select: { assetId: true, topicId: true } });
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.assetId] ??= []).push(r.topicId);
  return out;
}

/**
 * The backgrounds a template's customers are offered: images filed on any of its places or on
 * a node above one (a background on "הולדת בן" serves "ברית"). Empty when it has no place.
 */
export async function backgroundsFor(templateId: string): Promise<string[]> {
  const places = await prisma.templatePlace.findMany({ where: { templateId }, select: { topicId: true } });
  const up = new Set<string>();
  let layer = places.map((p) => p.topicId);
  while (layer.length) {
    layer = layer.filter((id) => !up.has(id));
    layer.forEach((id) => up.add(id));
    if (!layer.length) break;
    const rows = await prisma.topic.findMany({ where: { id: { in: layer } }, select: { parentId: true } });
    layer = rows.flatMap((r) => (r.parentId ? [r.parentId] : []));
  }
  if (!up.size) return [];
  const rows = await prisma.assetPlace.findMany({ where: { topicId: { in: [...up] } }, select: { assetId: true }, distinct: ['assetId'] });
  return rows.map((r) => r.assetId);
}

// ---- product labels ("what it is") ---------------------------------------------------

export async function listLabels(): Promise<Label[]> {
  const rows = await prisma.productLabel.findMany({
    orderBy: [{ audience: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { templates: true } } },
  });
  return rows.map((l) => ({ id: l.id, name: l.name, audience: l.audience, position: l.position, templates: l._count.templates }));
}

export async function createLabel(name: string, audience: Audience): Promise<{ ok: true } | TreeError> {
  if (await prisma.productLabel.findUnique({ where: { audience_name: { audience, name } } })) return fail(`כבר יש תווית "${name}"`, 409);
  const position = ((await prisma.productLabel.aggregate({ where: { audience }, _max: { position: true } }))._max.position ?? -1) + 1;
  await prisma.productLabel.create({ data: { name, audience, position } });
  return { ok: true };
}

export async function renameLabel(id: string, name: string): Promise<{ ok: true } | TreeError> {
  const row = await prisma.productLabel.findUnique({ where: { id } });
  if (!row) return fail('לא נמצא', 404);
  if (await prisma.productLabel.findFirst({ where: { audience: row.audience, name, id: { not: id } } })) return fail(`כבר יש תווית "${name}"`, 409);
  await prisma.productLabel.update({ where: { id }, data: { name } });
  return { ok: true };
}

/** deletes a label; its templates keep their places and only lose the label */
export async function deleteLabel(id: string): Promise<{ ok: true } | TreeError> {
  if (!(await prisma.productLabel.findUnique({ where: { id } }))) return fail('לא נמצא', 404);
  await prisma.productLabel.delete({ where: { id } });
  return { ok: true };
}
