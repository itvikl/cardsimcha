import type { Audience } from '../categories';
import { toV2 } from '../canvas-v1';
import { canRead, canWrite } from '../access';
import { files } from '../files';
import { topicConflict } from '../topics';
import type { CanvasDoc, Project, User } from '../types';
import { newId } from './ids';
import { C, db, now, type Reader } from './store';
import { allTopics, ensureTopic, topicDoors, type TopicDoc } from './topics';
import { placesPatch } from './tree';
import { ensurePersonalWorkspace } from './users';

// Templates (platform catalogue) and creatives (a customer's copy of a template) are two
// collections. The app still sees both as a `Project` with `kind` 'template' | 'design', so
// the pages and the editor did not have to change.

export type TemplateDoc = {
  id: string;
  /** null: the platform catalogue */
  workspaceId: string | null;
  /** the first place in the tree, read by the pages from before it */
  topicId: string | null;
  labelId: string | null;
  /** where it is filed in the occasion tree */
  places: string[];
  name: string;
  status: 'draft' | 'published';
  /** JSON text of the card document (Firestore takes no nested arrays) */
  canvas: string;
  thumbnailKey: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreativeDoc = {
  id: string;
  workspaceId: string;
  userId: string;
  templateId: string | null;
  name: string;
  canvas: string;
  thumbnailKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export const cardText = (doc: CanvasDoc) => JSON.stringify(doc);

/** stored cards may still be format v1 (copied from main before scripts/migrate-to-v2.ts converted them); they are converted on read */
function doc(text: string, id: string): CanvasDoc {
  const d = toV2(JSON.parse(text));
  if (!d) throw new Error(`card ${id} has an invalid canvas`);
  return d;
}

/** thumbnails are served by /api/thumbnails/<id>; `v` changes the URL when the card is saved */
const thumbUrl = (id: string, key: string | null, updatedAt: string) => (key ? `/api/thumbnails/${id}?v=${Date.parse(updatedAt)}` : undefined);

const fromTemplate = (t: TemplateDoc, topics: Map<string, TopicDoc>): Project => ({
  id: t.id,
  kind: 'template',
  ownerId: '',
  status: t.status,
  name: t.name,
  topic: t.topicId ? topics.get(t.topicId)?.name : undefined,
  places: t.places ?? [],
  labelId: t.labelId ?? undefined,
  canvas: doc(t.canvas, t.id),
  thumbnail: thumbUrl(t.id, t.thumbnailKey, t.updatedAt),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

const fromCreative = (c: CreativeDoc): Project => ({
  id: c.id,
  kind: 'design',
  ownerId: c.userId,
  templateId: c.templateId ?? undefined,
  status: 'draft',
  name: c.name,
  canvas: doc(c.canvas, c.id),
  thumbnail: thumbUrl(c.id, c.thumbnailKey, c.updatedAt),
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const topicMap = async (r: Reader = db) => new Map((await allTopics(r)).map((t) => [t.id, t]));

export async function getProject(id: string, r: Reader = db): Promise<Project | null> {
  const [t, c] = await Promise.all([r.get<TemplateDoc>(C.templates, id), r.get<CreativeDoc>(C.creatives, id)]);
  if (t) return fromTemplate(t, await topicMap(r));
  return c && fromCreative(c);
}

/** Admin: every catalogue template plus their own designs. Customer: their own designs. */
export async function listProjectsFor(user: User): Promise<Project[]> {
  const [templates, creatives, topics] = await Promise.all([
    user.role === 'admin' ? db.find<TemplateDoc>(C.templates, ['workspaceId', '==', null]) : [],
    db.find<CreativeDoc>(C.creatives, ['userId', '==', user.id]),
    topicMap(),
  ]);
  return [...templates.map((t) => fromTemplate(t, topics)), ...creatives.map(fromCreative)];
}

export async function listPublishedTemplates(): Promise<Project[]> {
  const [rows, topics] = await Promise.all([
    db.find<TemplateDoc>(C.templates, ['workspaceId', '==', null], ['status', '==', 'published']),
    topicMap(),
  ]);
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((t) => fromTemplate(t, topics));
}

export async function getPublishedTemplate(id: string): Promise<Project | null> {
  const t = await db.get<TemplateDoc>(C.templates, id);
  if (!t || t.workspaceId !== null || t.status !== 'published') return null;
  return fromTemplate(t, await topicMap());
}

/** thumbnail URL of a catalogue template (the carousel can use it as a cover) */
export async function templateThumbnail(id: string): Promise<string | null> {
  const [t] = await db.pick<TemplateDoc>(C.templates, ['thumbnailKey', 'updatedAt'], ['id', '==', id]);
  return (t && thumbUrl(t.id, t.thumbnailKey, t.updatedAt)) ?? null;
}

/**
 * The caller's own design as a copy of a template (customers: published templates only;
 * admins may copy any template to test it). `edit` may change the copy's canvas first.
 */
export async function createDesignFromTemplate(user: User, templateId: string, edit: (canvas: CanvasDoc) => void): Promise<string | null> {
  const t = await db.get<TemplateDoc>(C.templates, templateId);
  if (!t || (t.status !== 'published' && user.role !== 'admin')) return null;
  const workspaceId = await ensurePersonalWorkspace(user);
  const canvas = doc(t.canvas, t.id);
  edit(canvas);
  const id = newId();
  // the copy starts with the template's thumbnail until its first save
  const thumbnailKey = t.thumbnailKey ? await copyThumbnail(t.thumbnailKey, id) : null;
  const at = now();
  await db.set(C.creatives, id, {
    id, workspaceId, userId: user.id, templateId: t.id, name: t.name, canvas: cardText(canvas), thumbnailKey, createdAt: at, updatedAt: at,
  } satisfies CreativeDoc);
  return id;
}

function newTemplate(name: string, canvas: CanvasDoc): TemplateDoc {
  const at = now();
  return {
    id: newId(), workspaceId: null, topicId: null, labelId: null, places: [], name, status: 'draft',
    canvas: cardText(canvas), thumbnailKey: null, publishedAt: null, createdAt: at, updatedAt: at,
  };
}

/**
 * A new blank catalogue template; with `audience` its topic must belong to that door. With
 * `places` it is filed on those nodes of the tree (all behind `audience`'s door) instead of `topic`.
 */
export async function createTemplate(input: {
  name: string;
  topic: string;
  canvas: CanvasDoc;
  audience?: Audience;
  places?: string[];
  labelId?: string | null;
}): Promise<{ id: string } | { conflict: string }> {
  return db.tx(async (t) => {
    const row = newTemplate(input.name, input.canvas);
    if (input.places?.length) {
      const p = await placesPatch(t, row, input.places, input.labelId ?? undefined, input.audience);
      if ('error' in p) return { conflict: p.error };
      t.set(C.templates, row.id, { ...row, ...p });
      return { id: row.id };
    }
    if (input.audience) {
      const why = topicConflict(await topicDoors(t), input.topic, input.audience);
      if (why) return { conflict: why };
    }
    const topicId = input.topic ? await ensureTopic(t, input.topic, input.audience) : null;
    t.set(C.templates, row.id, { ...row, topicId, places: topicId ? [topicId] : [] });
    return { id: row.id };
  });
}

/** a fast early check, before work the request would waste (createTemplate checks again) */
export async function topicConflictFor(topic: string, audience: Audience) {
  return topicConflict(await topicDoors(), topic, audience);
}

export type ProjectPatch = {
  /** turns the sent canvas into the one to store, or null when it is not acceptable */
  canvas?: (current: Project) => CanvasDoc | null;
  name?: string;
  thumbnail?: { data: Buffer; ext: 'png' | 'jpg' };
  status?: 'draft' | 'published';
  topic?: string;
  audience?: Audience;
};

export type PatchResult = 'missing' | 'invalid' | { conflict: string } | { id: string; updatedAt: string };

export async function updateProject(user: User, id: string, patch: ProjectPatch): Promise<PatchResult> {
  const result = await db.tx(async (t): Promise<PatchResult> => {
    const [tpl, cre] = await Promise.all([t.get<TemplateDoc>(C.templates, id), t.get<CreativeDoc>(C.creatives, id)]);
    if (!tpl && !cre) return 'missing';
    const p = tpl ? fromTemplate(tpl, await topicMap(t)) : fromCreative(cre!);
    if (!canWrite(user, p)) return 'missing';
    // checked before anything changes: a template only takes a topic of the admin's current door
    if (patch.topic !== undefined && tpl && patch.audience) {
      const why = topicConflict(await topicDoors(t), patch.topic, patch.audience);
      if (why) return { conflict: why };
    }
    let canvas: CanvasDoc | undefined;
    if (patch.canvas) {
      const next = patch.canvas(p);
      if (!next) return 'invalid';
      canvas = next;
    }
    const updatedAt = now();
    const common = { ...(canvas && { canvas: cardText(canvas) }), ...(patch.name && { name: patch.name }), updatedAt };
    if (tpl) {
      const topicId =
        patch.topic === undefined ? undefined : patch.topic ? await ensureTopic(t, patch.topic, patch.audience) : null;
      const status = patch.status;
      // the single topic field swaps one place in the tree and leaves the template's other places
      let places: string[] | undefined;
      if (topicId !== undefined && topicId !== tpl.topicId) {
        places = (tpl.places ?? []).filter((x) => x !== tpl.topicId);
        if (topicId && !places.includes(topicId)) places.push(topicId);
      }
      t.update(C.templates, id, {
        ...common,
        ...(topicId !== undefined && { topicId }),
        ...(places && { places }),
        ...(status && { status, ...(status === 'published' && tpl.status !== 'published' && { publishedAt: updatedAt }) }),
      });
      return { id, updatedAt };
    }
    t.update(C.creatives, id, common);
    return { id, updatedAt };
  });

  if (typeof result === 'object' && 'updatedAt' in result && patch.thumbnail) {
    result.updatedAt = await saveThumbnail(id, patch.thumbnail);
  }
  return result;
}

export async function deleteProject(user: User, id: string): Promise<boolean> {
  const [tpl, cre] = await Promise.all([db.get<TemplateDoc>(C.templates, id), db.get<CreativeDoc>(C.creatives, id)]);
  const row = tpl ?? cre;
  if (!row) return false;
  const p = tpl ? fromTemplate(tpl, new Map()) : fromCreative(cre!);
  if (!canWrite(user, p)) return false;
  await db.delete(tpl ? C.templates : C.creatives, id);
  if (row.thumbnailKey) await files.remove([row.thumbnailKey]);
  return true;
}

// --- thumbnails ---

const thumbKey = (id: string, ext: string) => `thumbnails/${id}.${ext}`;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function saveThumbnail(id: string, t: { data: Buffer; ext: 'png' | 'jpg' }): Promise<string> {
  const key = thumbKey(id, t.ext);
  await files.put(key, t.data, t.ext === 'png' ? 'image/png' : 'image/jpeg');
  const updatedAt = now();
  const before = await db.tx(async (tx) => {
    const [tpl, cre] = await Promise.all([tx.get<TemplateDoc>(C.templates, id), tx.get<CreativeDoc>(C.creatives, id)]);
    const row = tpl ?? cre;
    if (row) tx.update(tpl ? C.templates : C.creatives, id, { thumbnailKey: key, updatedAt });
    return row?.thumbnailKey ?? null;
  });
  // the previous file, when it had another extension (a migrated card may have .webp)
  if (before && before !== key) await files.remove([before]);
  return updatedAt;
}

async function copyThumbnail(fromKey: string, toId: string): Promise<string | null> {
  const data = await files.get(fromKey);
  if (!data) return null;
  const key = thumbKey(toId, fromKey.slice(fromKey.lastIndexOf('.') + 1));
  await files.put(key, data, IMAGE_TYPES[key.slice(key.lastIndexOf('.'))] ?? 'image/jpeg');
  return key;
}

/** the stored thumbnail of a card the user may see, or null */
export async function readThumbnail(user: User | null, id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const [tpl, cre] = await Promise.all([db.get<TemplateDoc>(C.templates, id), db.get<CreativeDoc>(C.creatives, id)]);
  const row = tpl ?? cre;
  if (!row?.thumbnailKey) return null;
  const p = tpl ? fromTemplate(tpl, new Map()) : fromCreative(cre!);
  const visible = (p.kind === 'template' && p.status === 'published') || (user && canRead(user, p));
  if (!visible) return null;
  const data = await files.get(row.thumbnailKey);
  return data && { data, contentType: IMAGE_TYPES[row.thumbnailKey.slice(row.thumbnailKey.lastIndexOf('.'))] ?? 'image/jpeg' };
}
