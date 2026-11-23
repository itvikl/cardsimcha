/**
 * Copies main's data (Firestore collections categories, carousel, images, projects, users and
 * the "uploads/" files) into the v2 collections ("v2_…") and file keys this branch reads.
 *
 *   npm run migrate:v2                  # from main's Firestore + Cloud Storage
 *   npm run migrate:v2 -- --from local  # from data/db.json + data/uploads
 *   npm run migrate:v2 -- --dry         # only report
 *
 * main's collections and files are only read, so main keeps running on them. Every document is
 * written by its id, so it can run again before the switch. Cards are converted to format v2.
 * Sessions are not copied: everyone signs in again. Then `npm run seed:tree` builds the tree.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { audienceOf } from '../src/lib/categories';
import { toV2 } from '../src/lib/canvas-v1';
import { files } from '../src/lib/files';
import { stableId } from '../src/lib/data/ids';
import { assetFileKey, type AssetDoc, type CollectionDoc } from '../src/lib/data/library';
import type { CreativeDoc, TemplateDoc } from '../src/lib/data/projects';
import { C, db } from '../src/lib/data/store';
import { newTopic, type TopicDoc } from '../src/lib/data/topics';
import { personalWorkspace, type UserDoc } from '../src/lib/data/users';
import type { Db } from '../src/lib/types';

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const from = arg('--from') ?? 'firestore';
const dry = process.argv.includes('--dry');
if (from !== 'firestore' && from !== 'local') throw new Error('--from firestore | local');

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const date = (s: string | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : new Date().toISOString());

async function source(): Promise<{ db: Db; readUpload: (file: string) => Promise<Buffer | null> }> {
  if (from === 'local') {
    const old = JSON.parse(await readFile(path.join('data', 'db.json'), 'utf8')) as Partial<Db>;
    return {
      db: { categories: [], carousel: [], images: [], projects: [], users: [], sessions: [], ...old },
      readUpload: (file) => readFile(path.join('data', 'uploads', file)).catch(() => null),
    };
  }
  // main's Firestore module, read-only use: readDb never writes
  const legacy = await import('../src/lib/db');
  return { db: await legacy.readDb(), readUpload: legacy.readUpload };
}

/** run `fn` over `items`, `n` at a time */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

const report: Record<string, number> = {};
const note = (k: string, n = 1) => (report[k] = (report[k] ?? 0) + n);
const put = async (col: string, id: string, doc: object) => {
  if (!dry) await db.set(col, id, doc);
};
const putFile = async (key: string, data: Buffer, type: string) => {
  if (!dry) await files.put(key, data, type);
};

const THUMB = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

console.log(`reading ${from}…${dry ? ' (dry run)' : ''}`);
const { db: old, readUpload } = await source();

// --- users + personal workspaces ---
const emails = new Set<string>();
const users = new Map<string, UserDoc>();
for (const u of old.users) {
  const email = u.email?.trim().toLowerCase() || null;
  if (email && emails.has(email)) { note('users skipped (duplicate email)'); continue; }
  if (email) emails.add(email);
  const at = date(u.createdAt);
  users.set(u.id, {
    id: u.id, email, name: u.name ?? '', passwordHash: u.passwordHash || null, salt: u.salt || null,
    platformRole: u.role === 'admin' ? 'admin' : 'none', createdAt: at, updatedAt: at,
  });
}
/** a design's owner: an account, or a guest (cookie id) who gets a document now */
function owner(id: string) {
  if (!users.has(id)) {
    const at = new Date().toISOString();
    users.set(id, { id, email: null, name: 'אורח', passwordHash: null, salt: null, platformRole: 'none', createdAt: at, updatedAt: at });
    note('guest users created for designs');
  }
  return personalWorkspace(id, users.get(id)!.name).id;
}

// --- image library ---
for (const c of old.categories) {
  const at = date(c.createdAt);
  await put(C.collections, c.id, { id: c.id, workspaceId: null, name: c.name, description: c.description ?? '', createdAt: at, updatedAt: at } satisfies CollectionDoc);
  note('collections');
}
const catIds = new Set(old.categories.map((c) => c.id));
await pool(old.images, 8, async (img) => {
  const key = assetFileKey(img.file);
  if (!(await files.get(key))) {
    const data = await readUpload(img.file);
    if (!data) { note('images skipped (file missing)'); return; }
    await putFile(key, data, MIME[path.extname(img.file)] ?? 'application/octet-stream');
    note('image files copied');
  }
  const at = date(img.createdAt);
  await put(C.assets, img.id, {
    id: img.id, workspaceId: null, collectionId: catIds.has(img.categoryId) ? img.categoryId : null, kind: 'image',
    name: img.name ?? '', fileKey: key, width: img.width, height: img.height, metadata: '{}', places: [], createdAt: at, updatedAt: at,
  } satisfies AssetDoc);
  note('assets');
});

// --- topics: the carousel settings, then every other topic a template uses ---
const topicId = new Map<string, string>();
for (const s of old.carousel) {
  const t: TopicDoc = newTopic({
    id: stableId(`topic:${s.name}`), name: s.name, coverUrl: s.image, hidden: !!s.hidden, sortOrder: s.order ?? 0,
    audience: s.audience ?? audienceOf(s.name),
  });
  topicId.set(s.name, t.id);
  await put(C.topics, t.id, t);
  note('topics (carousel)');
}
for (const p of old.projects) {
  if (p.kind !== 'template' || !p.topic || topicId.has(p.topic)) continue;
  const t = newTopic({ id: stableId(`topic:${p.topic}`), name: p.topic, audience: audienceOf(p.topic), sortOrder: -1 });
  topicId.set(p.topic, t.id);
  await put(C.topics, t.id, t);
  note('topics (from templates)');
}

// --- templates, then designs (a design may point at a template) ---
/** a thumbnail is a data URL or an "/api/uploads/<file>" link; either becomes thumbnails/<id>.<ext> */
async function thumbnail(p: { id: string; thumbnail?: string }): Promise<string | null> {
  const t = p.thumbnail ?? '';
  const m = THUMB.exec(t);
  if (m) {
    const key = `thumbnails/${p.id}.${m[1] === 'png' ? 'png' : 'jpg'}`;
    await putFile(key, Buffer.from(m[2], 'base64'), `image/${m[1]}`);
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
  await putFile(key, data, MIME[path.extname(file)]);
  note('thumbnail files copied');
  return key;
}
/** cards are stored as format v2; one that cannot be converted is kept as it is and reported */
const card = (p: { canvas: unknown }) => {
  const v2 = toV2(p.canvas);
  if (!v2) note('canvases not converted to v2 (kept as they are)');
  return JSON.stringify(v2 ?? p.canvas);
};
const templates = old.projects.filter((p) => p.kind === 'template');
const designs = old.projects.filter((p) => p.kind === 'design');
// a kind this branch does not know (e.g. 'wording' from another branch) is listed, not copied
for (const p of old.projects) if (p.kind !== 'template' && p.kind !== 'design') note(`projects skipped (kind '${p.kind}')`);

await pool(templates, 8, async (p) => {
  const tid = p.topic ? (topicId.get(p.topic) ?? null) : null;
  await put(C.templates, p.id, {
    id: p.id, workspaceId: null, topicId: tid, labelId: null, places: tid ? [tid] : [], name: p.name, status: p.status,
    canvas: card(p), thumbnailKey: await thumbnail(p), publishedAt: p.status === 'published' ? date(p.updatedAt) : null,
    createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
  } satisfies TemplateDoc);
  note('templates');
});
const templateIds = new Set(templates.map((t) => t.id));
await pool(designs, 8, async (p) => {
  if (!p.ownerId) { note('designs skipped (no owner)'); return; }
  await put(C.creatives, p.id, {
    id: p.id, workspaceId: owner(p.ownerId), userId: p.ownerId,
    templateId: p.templateId && templateIds.has(p.templateId) ? p.templateId : null,
    name: p.name, canvas: card(p), thumbnailKey: await thumbnail(p), createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
  } satisfies CreativeDoc);
  note('creatives');
});

// users last: designs may have added guests
for (const u of users.values()) {
  await put(C.users, u.id, u);
  const w = personalWorkspace(u.id, u.name);
  if (!(await db.get(C.workspaces, w.id))) await put(C.workspaces, w.id, w);
  note('users');
}

console.log('\ncopied:', report);
console.log(`source: ${old.users.length} users, ${old.categories.length} categories, ${old.images.length} images, ${old.carousel.length} carousel, ${templates.length} templates, ${designs.length} designs`);
if (!dry) console.log('next: npm run seed:tree');
