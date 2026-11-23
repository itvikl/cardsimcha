import type { Audience } from '../categories';
import type { AssetDoc } from './library';
import type { TemplateDoc } from './projects';
import { newId } from './ids';
import { C, db, now, type Reader, type Tx } from './store';
import { allTopics, newTopic, type TopicDoc, type TopicLevel } from './topics';

// The occasion tree: קטגוריה → אירוע → סוג (see TopicDoc). Every node is a topic document;
// a template or a background is filed on one or more nodes through its `places` list, and
// shows in everything under a node it is filed on.
//
// Topics from before the tree sit at the root with level "type" until the admin places them;
// they are listed apart as "not in the tree yet".
//
// The tree is small (tens of nodes), so it is read whole and worked on in memory.

export type { TopicLevel };

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

export type LabelDoc = { id: string; name: string; audience: Audience; position: number; createdAt: string };

export type Tree = { nodes: TreeNode[]; unfiled: UnfiledTemplate[]; labels: Label[] };

const CHILD: Record<TopicLevel, TopicLevel | null> = { category: 'event', event: 'type', type: null };
/** what a node becomes under `parent` (a root node is a category) */
const levelUnder = (parent: { level: TopicLevel } | null): TopicLevel | null => (parent ? CHILD[parent.level] : 'category');

export const LEVEL_NAME: Record<TopicLevel, string> = { category: 'קטגוריה', event: 'אירוע', type: 'סוג' };

const byPosition = (a: { position: number; name: string }, b: { position: number; name: string }) =>
  a.position - b.position || a.name.localeCompare(b.name);

/** a root that isn't a category yet: a topic from before the tree */
const loose = (t: Pick<TopicDoc, 'parentId' | 'level'>) => t.parentId === null && t.level !== 'category';

type TemplateRef = Pick<TemplateDoc, 'id' | 'name' | 'status' | 'thumbnailKey' | 'updatedAt' | 'topicId' | 'labelId' | 'places'>;
const templateRefs = (r: Reader = db) =>
  r.pick<TemplateRef>(C.templates, ['name', 'status', 'thumbnailKey', 'updatedAt', 'topicId', 'labelId', 'places'], ['workspaceId', '==', null]);
const assetRefs = (r: Reader = db) => r.pick<Pick<AssetDoc, 'id' | 'places'>>(C.assets, ['places']);

export async function getTree(): Promise<Tree> {
  const [topics, templates, assets, labels] = await Promise.all([allTopics(), templateRefs(), assetRefs(), listLabels()]);
  const count = (rows: { places?: string[] }[], id: string) => rows.filter((r) => r.places?.includes(id)).length;
  return {
    nodes: topics.sort(byPosition).map((t) => ({
      id: t.id,
      name: t.name,
      parentId: t.parentId,
      level: t.level,
      position: t.position,
      audience: t.audience,
      // a topic outside the tree is only read by the pages from before it, through the old single topic
      templates: loose(t) ? templates.filter((x) => x.topicId === t.id).length : count(templates, t.id),
      assets: count(assets, t.id),
    })),
    labels,
    unfiled: templates
      .filter((t) => !t.places?.length)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        thumbnail: t.thumbnailKey ? `/api/thumbnails/${t.id}?v=${Date.parse(t.updatedAt)}` : null,
      })),
  };
}

export type TreeError = { error: string; status: number };
const fail = (error: string, status = 400): TreeError => ({ error, status });

function siblingTaken(topics: TopicDoc[], parentId: string | null, name: string, except?: string) {
  // a root that isn't a category yet is not a sibling of the categories
  return topics.some((t) => t.parentId === parentId && t.name === name && (parentId !== null || t.level === 'category') && t.id !== except);
}

const nextPosition = (topics: TopicDoc[], parentId: string | null) =>
  Math.max(-1, ...topics.filter((t) => t.parentId === parentId).map((t) => t.position)) + 1;

/** every node under `id` */
function descendants(topics: TopicDoc[], id: string): string[] {
  const out: string[] = [];
  let layer = [id];
  while (layer.length) {
    layer = topics.filter((t) => t.parentId !== null && layer.includes(t.parentId)).map((t) => t.id);
    out.push(...layer);
  }
  return out;
}

/** a new node under `parentId` (or a new category, for `audience`'s door) */
export async function createNode(input: { name: string; parentId: string | null; audience?: Audience }): Promise<TreeNode | TreeError> {
  return db.tx(async (t) => {
    const topics = await allTopics(t);
    const parent = input.parentId ? topics.find((x) => x.id === input.parentId) : null;
    if (input.parentId && !parent) return fail('המקום בעץ לא נמצא', 404);
    if (parent && loose(parent)) return fail('קודם משבצים את הפריט הזה בעץ');
    const level = levelUnder(parent ?? null);
    if (!level) return fail('אין רמה מתחת לסוג');
    if (siblingTaken(topics, input.parentId, input.name)) return fail(`כבר יש כאן "${input.name}"`, 409);
    const row = newTopic({
      name: input.name,
      parentId: input.parentId,
      level,
      audience: parent?.audience ?? input.audience ?? 'private',
      position: nextPosition(topics, input.parentId),
      sortOrder: -1,
    });
    t.set(C.topics, row.id, row);
    return { id: row.id, name: row.name, parentId: row.parentId, level: row.level, position: row.position, audience: row.audience, templates: 0, assets: 0 };
  });
}

export async function renameNode(id: string, name: string): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    const topics = await allTopics(t);
    const row = topics.find((x) => x.id === id);
    if (!row) return fail('לא נמצא', 404);
    if (row.name === name) return { ok: true as const };
    if (siblingTaken(topics, row.parentId, name, id)) return fail(`כבר יש כאן "${name}"`, 409);
    t.update(C.topics, id, { name, updatedAt: now() });
    return { ok: true as const };
  });
}

/**
 * Moves a node under `parentId` (null: to the root, as a category) at `index` among its new
 * siblings. A node takes the level its new place gives it; one with children keeps its level,
 * so an event moves only to another category and a type only to another event.
 */
export async function moveNode(id: string, parentId: string | null, index?: number): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    const topics = await allTopics(t);
    const row = topics.find((x) => x.id === id);
    if (!row) return fail('לא נמצא', 404);
    const parent = parentId ? topics.find((x) => x.id === parentId) : null;
    if (parentId && !parent) return fail('המקום בעץ לא נמצא', 404);
    if (parent && loose(parent)) return fail('אי אפשר לשבץ תחת פריט שעוד לא בעץ');
    const under = descendants(topics, id);
    if (parentId && (parentId === id || under.includes(parentId))) return fail('אי אפשר להעביר פריט לתוך עצמו');
    const level = levelUnder(parent ?? null);
    if (!level) return fail('אין רמה מתחת לסוג');
    const hasChildren = topics.some((x) => x.parentId === id);
    if (hasChildren && level !== row.level) {
      return fail(`ל"${row.name}" יש פריטים בתוכו, אז הוא נשאר ${LEVEL_NAME[row.level]} ועובר רק למקום של ${LEVEL_NAME[row.level]}`);
    }
    if (siblingTaken(topics, parentId, row.name, id)) return fail(`כבר יש שם "${row.name}"`, 409);

    // the new siblings in order, with this node put in at `index`
    const siblings = topics
      .filter((x) => x.parentId === parentId && x.id !== id && (parentId !== null || x.level === 'category'))
      .sort(byPosition)
      .map((s) => s.id);
    const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
    siblings.splice(at, 0, id);

    const audience = parent?.audience ?? row.audience;
    const stamp = now();
    t.update(C.topics, id, { parentId, level, audience, position: siblings.indexOf(id), updatedAt: stamp });
    for (const [i, s] of siblings.entries()) if (s !== id) t.update(C.topics, s, { position: i });
    if (audience !== row.audience) for (const u of under) t.update(C.topics, u, { audience, updatedAt: stamp });
    return { ok: true as const };
  });
}

/** deletes an empty node: no nodes under it and nothing filed on it */
export async function deleteNode(id: string): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    const [row, children, filed, onTopic, assets] = await Promise.all([
      t.get<TopicDoc>(C.topics, id),
      t.find<TopicDoc>(C.topics, ['parentId', '==', id]),
      t.pick(C.templates, ['places'], ['places', 'array-contains', id]),
      t.pick(C.templates, ['topicId'], ['topicId', '==', id]),
      t.pick(C.assets, ['places'], ['places', 'array-contains', id]),
    ]);
    if (!row) return fail('לא נמצא', 404);
    if (children.length) return fail(`ב"${row.name}" יש עוד פריטים. קודם מעבירים או מוחקים אותם.`);
    if (filed.length || onTopic.length || assets.length) return fail(`על "${row.name}" יש עיצובים או רקעים. קודם משייכים אותם למקום אחר.`);
    t.delete(C.topics, id);
    return { ok: true as const };
  });
}

/** checks that `ids` are nodes of the tree (not topics left outside it), all behind `door` when given */
function checkPlaces(topics: TopicDoc[], ids: string[], door?: Audience): TreeError | null {
  const rows = topics.filter((t) => ids.includes(t.id));
  if (rows.length !== ids.length) return fail('אחד המקומות בעץ לא נמצא', 404);
  const outside = rows.find(loose);
  if (outside) return fail(`"${outside.name}" עוד לא בעץ, אז אי אפשר לשייך אליו`);
  const other = door && rows.find((r) => r.audience !== door);
  if (other) return fail(`"${other.name}" שייך ל${other.audience === 'business' ? 'עסקים' : 'שמחות'}. בוחרים מקום מאותה דלת.`);
  return null;
}

/**
 * The changes that file a template on these nodes, replacing where it was (`topicIds`
 * undefined leaves them), and set its label when `labelId` is given (null clears it). The
 * first place is also kept as the template's single topic, which the pages from before the
 * tree read; a template those pages still list under a topic outside the tree keeps that one
 * until they move to the tree.
 */
export async function placesPatch(
  t: Reader,
  template: { topicId: string | null } | null,
  topicIds: string[] | undefined,
  labelId?: string | null,
  door?: Audience,
  topics?: TopicDoc[],
): Promise<Partial<TemplateDoc> | TreeError> {
  if (!template) return fail('העיצוב לא נמצא', 404);
  const patch: Partial<TemplateDoc> = {};
  if (labelId) {
    const label = await t.get<LabelDoc>(C.labels, labelId);
    if (!label) return fail('התווית לא נמצאה', 404);
    if (door && label.audience !== door) return fail('התווית שייכת לדלת השנייה');
  }
  if (topicIds) {
    const all = topics ?? (await allTopics(t));
    const ids = [...new Set(topicIds)];
    const why = checkPlaces(all, ids, door);
    if (why) return why;
    patch.places = ids;
    const current = template.topicId ? all.find((x) => x.id === template.topicId) : null;
    if (!(current && loose(current))) patch.topicId = ids[0] ?? null;
  }
  if (labelId !== undefined) patch.labelId = labelId;
  return patch;
}

export async function setTemplatePlaces(templateId: string, topicIds: string[] | undefined, labelId?: string | null, door?: Audience) {
  return setTemplatesPlaces([templateId], topicIds, labelId, door);
}

/** setTemplatePlaces for several templates at once, all or none */
export async function setTemplatesPlaces(
  templateIds: string[],
  topicIds: string[] | undefined,
  labelId?: string | null,
  door?: Audience,
): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t: Tx) => {
    const topics = await allTopics(t);
    const ids = [...new Set(templateIds)];
    const rows = await Promise.all(ids.map((id) => t.get<TemplateDoc>(C.templates, id)));
    const patches: Partial<TemplateDoc>[] = [];
    for (const row of rows) {
      const p = await placesPatch(t, row, topicIds, labelId, door, topics);
      if ('error' in p) return p as TreeError;
      patches.push(p);
    }
    const stamp = now();
    ids.forEach((id, i) => t.update(C.templates, id, { ...patches[i], updatedAt: stamp }));
    return { ok: true as const };
  });
}

/** files library images (backgrounds) on these nodes, replacing where each of them was */
export async function setAssetPlaces(assetIds: string | string[], topicIds: string[]): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    const assets = [...new Set(Array.isArray(assetIds) ? assetIds : [assetIds])];
    const ids = [...new Set(topicIds)];
    const found = await Promise.all(assets.map((id) => t.get(C.assets, id)));
    if (found.some((a) => !a)) return fail('אחת התמונות לא נמצאה', 404);
    const why = checkPlaces(await allTopics(t), ids);
    if (why) return why;
    for (const id of assets) t.update(C.assets, id, { places: ids });
    return { ok: true as const };
  });
}

/** where each library image is filed: asset id → node ids */
export async function assetPlaces(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const a of await assetRefs()) if (a.places?.length) out[a.id] = a.places;
  return out;
}

/**
 * The backgrounds a template's customers are offered: images filed on any of its places or on
 * a node above one (a background on "הולדת בן" serves "ברית"). Empty when it has no place.
 */
export async function backgroundsFor(templateId: string): Promise<string[]> {
  const t = await db.pick<Pick<TemplateDoc, 'id' | 'places'>>(C.templates, ['places'], ['id', '==', templateId]);
  const places = t[0]?.places ?? [];
  if (!places.length) return [];
  const topics = new Map((await allTopics()).map((x) => [x.id, x]));
  const up = new Set<string>();
  for (let id of places) {
    for (let guard = 0; id && !up.has(id) && guard < 10; guard++) {
      up.add(id);
      id = topics.get(id)?.parentId ?? '';
    }
  }
  const rows = await db.pick<Pick<AssetDoc, 'id'>>(C.assets, ['id'], ['places', 'array-contains-any', [...up]]);
  return [...new Set(rows.map((r) => r.id))];
}

// ---- product labels ("what it is") ---------------------------------------------------

export async function listLabels(): Promise<Label[]> {
  const [rows, templates] = await Promise.all([db.find<LabelDoc>(C.labels), templateRefs()]);
  return rows
    .sort((a, b) => a.audience.localeCompare(b.audience) || byPosition(a, b))
    .map((l) => ({ id: l.id, name: l.name, audience: l.audience, position: l.position, templates: templates.filter((t) => t.labelId === l.id).length }));
}

export async function createLabel(name: string, audience: Audience): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    const same = await t.find<LabelDoc>(C.labels, ['audience', '==', audience]);
    if (same.some((l) => l.name === name)) return fail(`כבר יש תווית "${name}"`, 409);
    const position = Math.max(-1, ...same.map((l) => l.position)) + 1;
    const id = newId();
    t.set(C.labels, id, { id, name, audience, position, createdAt: now() } satisfies LabelDoc);
    return { ok: true as const };
  });
}

export async function renameLabel(id: string, name: string): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    const row = await t.get<LabelDoc>(C.labels, id);
    if (!row) return fail('לא נמצא', 404);
    const same = await t.find<LabelDoc>(C.labels, ['audience', '==', row.audience]);
    if (same.some((l) => l.name === name && l.id !== id)) return fail(`כבר יש תווית "${name}"`, 409);
    t.update(C.labels, id, { name });
    return { ok: true as const };
  });
}

/** deletes a label; its templates keep their places and only lose the label */
export async function deleteLabel(id: string): Promise<{ ok: true } | TreeError> {
  return db.tx(async (t) => {
    if (!(await t.get(C.labels, id))) return fail('לא נמצא', 404);
    const tagged = await t.pick<{ id: string }>(C.templates, ['labelId'], ['labelId', '==', id]);
    for (const x of tagged) t.update(C.templates, x.id, { labelId: null });
    t.delete(C.labels, id);
    return { ok: true as const };
  });
}
