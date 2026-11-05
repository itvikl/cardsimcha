/**
 * Copies today's data into the v2 Postgres schema (design doc §6).
 *
 *   npm run migrate:postgres                 # from Firestore + Cloud Storage (read-only)
 *   npm run migrate:postgres -- --from local # from data/db.json + data/uploads
 *
 * Writes only to DATABASE_URL (default: the docker-compose Postgres) and the file store
 * (data/files/). Every row is upserted by its id, so it can run again before the switch.
 * Sessions are not copied: everyone signs in again.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { audienceOf } from '../src/lib/categories';
import { validateDoc } from '../src/lib/canvas';
import { files } from '../src/lib/files';
import { stableId } from '../src/lib/data/ids';
import { assetFileKey } from '../src/lib/data/library';
import { prisma } from '../src/lib/data/prisma';
import { personalWorkspaceId } from '../src/lib/data/users';
import type { Prisma } from '../src/generated/prisma/client';
import type { Db, Project } from '../src/lib/types';

const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : 'firestore';
if (from !== 'firestore' && from !== 'local') throw new Error('--from firestore | local');

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const date = (s: string | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s) : new Date());
const json = (v: unknown) => v as Prisma.InputJsonValue;

async function source(): Promise<{ db: Db; readUpload: (file: string) => Promise<Buffer | null> }> {
  if (from === 'local') {
    const db = JSON.parse(await readFile(path.join('data', 'db.json'), 'utf8')) as Partial<Db>;
    return {
      db: { categories: [], carousel: [], images: [], projects: [], users: [], sessions: [], ...db },
      readUpload: (file) => readFile(path.join('data', 'uploads', file)).catch(() => null),
    };
  }
  // the legacy Firestore module, read-only use: readDb never writes
  const { readDb, readUpload } = await import('../src/lib/db');
  return { db: await readDb(), readUpload };
}

/** run `fn` over `items`, `n` at a time */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const THUMB = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

async function main() {
  console.log(`reading ${from}…`);
  const { db, readUpload } = await source();
  const report: Record<string, number | string> = {};
  const note = (k: string, n = 1) => (report[k] = ((report[k] as number) ?? 0) + n);

  // --- users + personal workspaces ---
  const emails = new Set<string>();
  for (const u of db.users) {
    const email = u.email?.trim().toLowerCase() || null;
    if (email && emails.has(email)) { note('users skipped (duplicate email)'); continue; }
    if (email) emails.add(email);
    const data = { email, name: u.name ?? '', passwordHash: u.passwordHash || null, salt: u.salt || null, platformRole: u.role === 'admin' ? ('admin' as const) : ('none' as const), createdAt: date(u.createdAt) };
    await prisma.user.upsert({ where: { id: u.id }, update: data, create: { id: u.id, ...data } });
    note('users');
  }
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));

  /** a design's owner: an account, or a guest (cookie id) who gets a row now */
  async function workspaceOf(ownerId: string, name: string): Promise<string> {
    if (!userIds.has(ownerId)) {
      await prisma.user.upsert({ where: { id: ownerId }, update: {}, create: { id: ownerId, name: 'אורח' } });
      userIds.add(ownerId);
      note('guest users created for designs');
    }
    const id = personalWorkspaceId(ownerId);
    await prisma.workspace.upsert({ where: { id }, update: {}, create: { id, kind: 'personal', name } });
    await prisma.membership.upsert({ where: { workspaceId_userId: { workspaceId: id, userId: ownerId } }, update: {}, create: { workspaceId: id, userId: ownerId, role: 'owner' } });
    return id;
  }
  for (const u of db.users) if (userIds.has(u.id)) await workspaceOf(u.id, u.name ?? '');

  // --- image library ---
  for (const c of db.categories) {
    const data = { name: c.name, description: c.description ?? '', createdAt: date(c.createdAt) };
    await prisma.collection.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
    note('collections');
  }
  const catIds = new Set(db.categories.map((c) => c.id));
  await pool(db.images, 8, async (img) => {
    const key = assetFileKey(img.file);
    if (!(await files.get(key))) {
      const data = await readUpload(img.file);
      if (!data) { note('images skipped (file missing)'); return; }
      await files.put(key, data, MIME[path.extname(img.file)] ?? 'application/octet-stream');
      note('image files copied');
    }
    const row = { collectionId: catIds.has(img.categoryId) ? img.categoryId : null, kind: 'image' as const, name: img.name ?? '', fileKey: key, width: img.width, height: img.height, createdAt: date(img.createdAt) };
    await prisma.asset.upsert({ where: { id: img.id }, update: row, create: { id: img.id, ...row } });
    note('assets');
  });

  // --- topics: the carousel settings, then every other topic a template uses ---
  for (const s of db.carousel) {
    const data = { coverUrl: s.image, hidden: !!s.hidden, sortOrder: s.order ?? 0, audience: s.audience ?? audienceOf(s.name) };
    await prisma.topic.upsert({ where: { name: s.name }, update: data, create: { id: stableId(`topic:${s.name}`), name: s.name, ...data } });
    note('topics (carousel)');
  }
  const topicId = new Map((await prisma.topic.findMany({ select: { id: true, name: true } })).map((t) => [t.name, t.id]));
  for (const p of db.projects) {
    if (p.kind !== 'template' || !p.topic || topicId.has(p.topic)) continue;
    const t = await prisma.topic.create({ data: { id: stableId(`topic:${p.topic}`), name: p.topic, audience: audienceOf(p.topic), sortOrder: -1 } });
    topicId.set(p.topic, t.id);
    note('topics (from templates)');
  }

  // --- templates, then designs (a design may point at a template) ---
  /** a thumbnail is a data URL or an "/api/uploads/<file>" link; either becomes thumbnails/<id>.<ext> */
  async function thumbnail(p: Project): Promise<string | null> {
    const t = p.thumbnail ?? '';
    const m = THUMB.exec(t);
    if (m) {
      const key = `thumbnails/${p.id}.${m[1] === 'png' ? 'png' : 'jpg'}`;
      await files.put(key, Buffer.from(m[2], 'base64'), `image/${m[1]}`);
      return key;
    }
    const file = /^\/api\/uploads\/([\w-]+(\.[0-9a-f]+)?\.(png|jpg|webp|gif))$/.exec(t)?.[1];
    if (!file) {
      if (t) note('thumbnails skipped (unknown form)');
      return null;
    }
    const key = `thumbnails/${p.id}${path.extname(file)}`;
    if (await files.get(key)) return key;
    const data = await readUpload(file);
    if (!data) { note('thumbnails skipped (file missing)'); return null; }
    await files.put(key, data, MIME[path.extname(file)]);
    note('thumbnail files copied');
    return key;
  }
  const templates = db.projects.filter((p) => p.kind === 'template');
  const designs = db.projects.filter((p) => p.kind === 'design');
  for (const p of db.projects) if (!validateDoc(p.canvas)) note('canvases that fail validateDoc (kept as they are)');
  // a kind this branch does not know (e.g. 'wording' from an unpushed branch) is listed, not copied
  for (const p of db.projects) if (p.kind !== 'template' && p.kind !== 'design') note(`projects skipped (kind '${p.kind}')`);

  await pool(templates, 8, async (p) => {
    const data = {
      name: p.name, status: p.status, topicId: p.topic ? (topicId.get(p.topic) ?? null) : null, canvas: json(p.canvas),
      thumbnailKey: await thumbnail(p), publishedAt: p.status === 'published' ? date(p.updatedAt) : null,
      createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
    };
    await prisma.template.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    note('templates');
  });
  const templateIds = new Set(templates.map((t) => t.id));
  for (const p of designs) {
    if (!p.ownerId) { note('designs skipped (no owner)'); continue; }
    const data = {
      workspaceId: await workspaceOf(p.ownerId, 'אורח'), userId: p.ownerId,
      templateId: p.templateId && templateIds.has(p.templateId) ? p.templateId : null,
      name: p.name, canvas: json(p.canvas), thumbnailKey: await thumbnail(p),
      createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
    };
    await prisma.creative.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    note('creatives');
  }

  // --- verify ---
  const counts = {
    users: await prisma.user.count(), workspaces: await prisma.workspace.count(), collections: await prisma.collection.count(),
    assets: await prisma.asset.count(), topics: await prisma.topic.count(), templates: await prisma.template.count(), creatives: await prisma.creative.count(),
  };
  console.log('\nimported:', report);
  console.log(`source:   ${db.users.length} users, ${db.categories.length} categories, ${db.images.length} images, ${db.carousel.length} carousel, ${templates.length} templates, ${designs.length} designs`);
  console.log('postgres:', counts);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
