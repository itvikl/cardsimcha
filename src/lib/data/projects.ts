import type { Creative, Prisma, Template, Topic } from '@/generated/prisma/client';
import type { Audience } from '../categories';
import { canRead, canWrite } from '../access';
import { files } from '../files';
import { topicConflict } from '../topics';
import type { CanvasDoc, Project, User } from '../types';
import { newId } from './ids';
import { prisma } from './prisma';
import { ensureTopic, topicDoors } from './topics';
import { ensurePersonalWorkspace } from './users';

// Templates (platform catalogue) and creatives (a customer's copy of a template) are two
// tables. The app still sees both as a `Project` with `kind` 'template' | 'design', so the
// pages and the editor did not have to change.

type Tx = Prisma.TransactionClient;
const json = (doc: CanvasDoc) => doc as unknown as Prisma.InputJsonValue;
const doc = (v: Prisma.JsonValue) => v as unknown as CanvasDoc;

/** thumbnails are served by /api/thumbnails/<id>; `v` changes the URL when the card is saved */
const thumbUrl = (id: string, key: string | null, updatedAt: Date) =>
  key ? `/api/thumbnails/${id}?v=${updatedAt.getTime()}` : undefined;

const fromTemplate = (t: Template & { topic: Topic | null }): Project => ({
  id: t.id,
  kind: 'template',
  ownerId: '',
  status: t.status,
  name: t.name,
  topic: t.topic?.name,
  canvas: doc(t.canvas),
  thumbnail: thumbUrl(t.id, t.thumbnailKey, t.updatedAt),
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

const fromCreative = (c: Creative): Project => ({
  id: c.id,
  kind: 'design',
  ownerId: c.userId,
  templateId: c.templateId ?? undefined,
  status: 'draft',
  name: c.name,
  canvas: doc(c.canvas),
  thumbnail: thumbUrl(c.id, c.thumbnailKey, c.updatedAt),
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const withTopic = { topic: true } as const;

export async function getProject(id: string, tx: Tx = prisma): Promise<Project | null> {
  const t = await tx.template.findUnique({ where: { id }, include: withTopic });
  if (t) return fromTemplate(t);
  const c = await tx.creative.findUnique({ where: { id } });
  return c && fromCreative(c);
}

/** Admin: every catalogue template plus their own designs. Customer: their own designs. */
export async function listProjectsFor(user: User): Promise<Project[]> {
  const [templates, creatives] = await Promise.all([
    user.role === 'admin' ? prisma.template.findMany({ where: { workspaceId: null }, include: withTopic }) : [],
    prisma.creative.findMany({ where: { userId: user.id } }),
  ]);
  return [...templates.map(fromTemplate), ...creatives.map(fromCreative)];
}

export async function listPublishedTemplates(): Promise<Project[]> {
  const rows = await prisma.template.findMany({
    where: { workspaceId: null, status: 'published' },
    include: withTopic,
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map(fromTemplate);
}

export async function getPublishedTemplate(id: string): Promise<Project | null> {
  const t = await prisma.template.findFirst({ where: { id, workspaceId: null, status: 'published' }, include: withTopic });
  return t && fromTemplate(t);
}

/** thumbnail URL of a catalogue template (the carousel can use it as a cover) */
export async function templateThumbnail(id: string): Promise<string | null> {
  const t = await prisma.template.findUnique({ where: { id }, select: { id: true, thumbnailKey: true, updatedAt: true } });
  return (t && thumbUrl(t.id, t.thumbnailKey, t.updatedAt)) ?? null;
}

/**
 * The caller's own design as a copy of a template (customers: published templates only;
 * admins may copy any template to test it). `edit` may change the copy's canvas first.
 */
export async function createDesignFromTemplate(user: User, templateId: string, edit: (canvas: CanvasDoc) => void): Promise<string | null> {
  const t = await prisma.template.findUnique({ where: { id: templateId } });
  if (!t || (t.status !== 'published' && user.role !== 'admin')) return null;
  const workspaceId = await ensurePersonalWorkspace(user);
  const canvas = structuredClone(doc(t.canvas));
  edit(canvas);
  const id = newId();
  // the copy starts with the template's thumbnail until its first save
  const thumbnailKey = t.thumbnailKey ? await copyThumbnail(t.thumbnailKey, id) : null;
  await prisma.creative.create({ data: { id, workspaceId, userId: user.id, templateId: t.id, name: t.name, canvas: json(canvas), thumbnailKey } });
  return id;
}

/** a new blank catalogue template; with `audience` its topic must belong to that door */
export async function createTemplate(input: { name: string; topic: string; canvas: CanvasDoc; audience?: Audience }) {
  return prisma.$transaction(async (tx): Promise<{ id: string } | { conflict: string }> => {
    if (input.audience) {
      const why = topicConflict(await topicDoors(tx), input.topic, input.audience);
      if (why) return { conflict: why };
    }
    const topicId = input.topic ? await ensureTopic(tx, input.topic, input.audience) : null;
    const t = await tx.template.create({ data: { name: input.name, topicId, canvas: json(input.canvas) } });
    return { id: t.id };
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
  const result = await prisma.$transaction(async (tx): Promise<PatchResult> => {
    const p = await getProject(id, tx);
    if (!p || !canWrite(user, p)) return 'missing';
    const template = p.kind === 'template';
    // checked before anything changes: a template only takes a topic of the admin's current door
    if (patch.topic !== undefined && template && patch.audience) {
      const why = topicConflict(await topicDoors(tx), patch.topic, patch.audience);
      if (why) return { conflict: why };
    }
    let canvas: CanvasDoc | undefined;
    if (patch.canvas) {
      const next = patch.canvas(p);
      if (!next) return 'invalid';
      canvas = next;
    }
    const common = { ...(canvas && { canvas: json(canvas) }), ...(patch.name && { name: patch.name }) };
    if (template) {
      const topicId =
        patch.topic === undefined ? undefined : patch.topic ? await ensureTopic(tx, patch.topic, patch.audience) : null;
      const status = patch.status;
      const row = await tx.template.update({
        where: { id },
        data: {
          ...common,
          ...(topicId !== undefined && { topicId }),
          ...(status && { status, ...(status === 'published' && p.status !== 'published' && { publishedAt: new Date() }) }),
        },
      });
      return { id, updatedAt: row.updatedAt.toISOString() };
    }
    const row = await tx.creative.update({ where: { id }, data: common });
    return { id, updatedAt: row.updatedAt.toISOString() };
  });

  if (typeof result === 'object' && 'updatedAt' in result && patch.thumbnail) {
    const updatedAt = await saveThumbnail(id, patch.thumbnail);
    if (updatedAt) result.updatedAt = updatedAt;
  }
  return result;
}

export async function deleteProject(user: User, id: string): Promise<boolean> {
  const p = await getProject(id);
  if (!p || !canWrite(user, p)) return false;
  const row =
    p.kind === 'template'
      ? await prisma.template.delete({ where: { id }, select: { thumbnailKey: true } })
      : await prisma.creative.delete({ where: { id }, select: { thumbnailKey: true } });
  if (row.thumbnailKey) await files.remove([row.thumbnailKey]);
  return true;
}

// --- thumbnails ---

const thumbKey = (id: string, ext: string) => `thumbnails/${id}.${ext}`;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function copyThumbnail(fromKey: string, toId: string): Promise<string | null> {
  const data = await files.get(fromKey);
  if (!data) return null;
  const key = thumbKey(toId, fromKey.slice(fromKey.lastIndexOf('.') + 1));
  await files.put(key, data, IMAGE_TYPES[key.slice(key.lastIndexOf('.'))] ?? 'image/jpeg');
  return key;
}

async function saveThumbnail(id: string, t: { data: Buffer; ext: 'png' | 'jpg' }): Promise<string | null> {
  const key = thumbKey(id, t.ext);
  await files.put(key, t.data, t.ext === 'png' ? 'image/png' : 'image/jpeg');
  const select = { thumbnailKey: true } as const;
  const before = (await prisma.template.findUnique({ where: { id }, select })) ?? (await prisma.creative.findUnique({ where: { id }, select }));
  const tpl = await prisma.template.updateMany({ where: { id }, data: { thumbnailKey: key } });
  if (!tpl.count) await prisma.creative.updateMany({ where: { id }, data: { thumbnailKey: key } });
  // the previous file, when it had another extension (a migrated card may have .webp)
  if (before?.thumbnailKey && before.thumbnailKey !== key) await files.remove([before.thumbnailKey]);
  const p = await getProject(id);
  return p?.updatedAt ?? null;
}

/** the stored thumbnail of a card the user may see, or null */
export async function readThumbnail(user: User | null, id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const p = await getProject(id);
  if (!p) return null;
  const visible = (p.kind === 'template' && p.status === 'published') || (user && canRead(user, p));
  if (!visible) return null;
  const row =
    p.kind === 'template'
      ? await prisma.template.findUnique({ where: { id }, select: { thumbnailKey: true } })
      : await prisma.creative.findUnique({ where: { id }, select: { thumbnailKey: true } });
  if (!row?.thumbnailKey) return null;
  const data = await files.get(row.thumbnailKey);
  return data && { data, contentType: IMAGE_TYPES[row.thumbnailKey.slice(row.thumbnailKey.lastIndexOf('.'))] ?? 'image/jpeg' };
}
