import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { firestore, bucket } from './firebase';
import type { Db } from './types';

// Data lives in Firebase: one Firestore document per record (collections named after the Db
// keys) and uploaded images in Cloud Storage under "uploads/". Everything goes through this
// module, so callers still see a plain `Db` object.
const KEYS = ['brands', 'categories', 'carousel', 'images', 'projects', 'users', 'sessions', 'subscriptions', 'purchases'] as const;
type Key = (typeof KEYS)[number];

type Row<K extends Key> = Db[K][number];

// sessions have no id; their token hash is the document id
const docId = (key: Key, row: Record<string, unknown>) => String(key === 'sessions' ? row.tokenHash : row.id);

function normalize<K extends Key>(key: K, row: Row<K>): Row<K> {
  // projects saved before accounts existed become draft templates
  if (key === 'projects') {
    const p = row as Db['projects'][number];
    p.kind ??= 'template';
    p.status ??= 'draft';
    p.ownerId ??= '';
  }
  return row;
}

// --- single records: the hot paths (editor, lists, sign-in) read and write only what they touch ---

/** One record by id, or null. */
export async function getRow<K extends Key>(key: K, id: string): Promise<Row<K> | null> {
  if (!id) return null;
  const snap = await firestore().collection(key).doc(id).get();
  return snap.exists ? normalize(key, snap.data() as Row<K>) : null;
}

/** Several records by id, in one round trip; missing ones are skipped. */
export async function getRows<K extends Key>(key: K, ids: string[]): Promise<Row<K>[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const fs = firestore();
  const snaps = await fs.getAll(...unique.map((id) => fs.collection(key).doc(id)));
  return snaps.filter((s) => s.exists).map((s) => normalize(key, s.data() as Row<K>));
}

/** Records matching every `field == value` pair (equality only, so no composite index is needed). */
export async function findRows<K extends Key>(key: K, where: Record<string, string | number | boolean>): Promise<Row<K>[]> {
  let q: FirebaseFirestore.Query = firestore().collection(key);
  for (const [field, value] of Object.entries(where)) q = q.where(field, '==', value);
  const snap = await q.get();
  return snap.docs.map((d) => normalize(key, d.data() as Row<K>));
}

export async function setRow<K extends Key>(key: K, row: Row<K>) {
  const r = row as unknown as Record<string, unknown>;
  // JSON round-trip drops `undefined` fields, which Firestore rejects
  await firestore().collection(key).doc(docId(key, r)).set(JSON.parse(JSON.stringify(r)));
}

export async function deleteRow(key: Key, id: string) {
  await firestore().collection(key).doc(id).delete();
}

/**
 * Read-modify-write of one record in a Firestore transaction. `fn` gets the record (null when
 * missing), may change it in place, and returns `{ result, write }`; the record is saved only
 * when `write` is true. Firestore retries `fn` if the record changed meanwhile.
 */
export function updateRow<K extends Key, T>(
  key: K,
  id: string,
  fn: (row: Row<K> | null) => { result: T; write: boolean } | Promise<{ result: T; write: boolean }>,
): Promise<T> {
  const fs = firestore();
  const ref = fs.collection(key).doc(id);
  return fs.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const row = snap.exists ? normalize(key, snap.data() as Row<K>) : null;
    const { result, write } = await fn(row);
    if (write && row) tx.set(ref, JSON.parse(JSON.stringify(row)));
    return result;
  });
}

// --- whole collections: rare admin paths that look across records ---

// Serialize writes so concurrent requests cannot corrupt each other.
let queue: Promise<unknown> = Promise.resolve();

/** Loads only `keys`; the other collections come back empty, so pass every one the caller reads. */
async function read(keys: readonly Key[]): Promise<Db> {
  const fs = firestore();
  const snaps = await Promise.all(keys.map((k) => fs.collection(k).get()));
  const db = Object.fromEntries(KEYS.map((k) => [k, []])) as unknown as Db;
  keys.forEach((k, i) => {
    (db as unknown as Record<Key, unknown[]>)[k] = snaps[i].docs.map((d) => normalize(k, d.data() as Row<typeof k>));
  });
  return db;
}

export function readDb(keys: readonly Key[] = KEYS): Promise<Db> {
  return queue.then(() => read(keys));
}

export function updateDb<T>(fn: (db: Db) => T | Promise<T>, keys: readonly Key[] = KEYS): Promise<T> {
  const run = queue.then(async () => {
    const db = await read(keys);
    const before = structuredClone(db);
    const result = await fn(db);

    const fs = firestore();
    const batch = fs.batch();
    let ops = 0;
    for (const key of keys) {
      const old = new Map((before[key] as unknown as Record<string, unknown>[]).map((r) => [docId(key, r), r]));
      for (const row of db[key] as unknown as Record<string, unknown>[]) {
        const id = docId(key, row);
        const prev = old.get(id);
        old.delete(id);
        if (prev && isDeepStrictEqual(prev, row)) continue;
        // JSON round-trip drops `undefined` fields, which Firestore rejects
        batch.set(fs.collection(key).doc(id), JSON.parse(JSON.stringify(row)));
        ops++;
      }
      for (const id of old.keys()) {
        batch.delete(fs.collection(key).doc(id));
        ops++;
      }
    }
    // a Firestore batch holds at most 500 writes
    if (ops > 500) throw new Error('too many changes in one update');
    if (ops) await batch.commit();
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export const newId = () => randomUUID();

// --- uploaded files (Cloud Storage) ---

const uploadPath = (file: string) => `uploads/${file}`;

export async function saveUpload(file: string, data: Buffer, contentType: string) {
  await bucket().file(uploadPath(file)).save(data, { contentType, resumable: false });
}

export async function readUpload(file: string): Promise<Buffer | null> {
  try {
    const [data] = await bucket().file(uploadPath(file)).download();
    return data;
  } catch (e: unknown) {
    if ((e as { code?: number }).code === 404) return null;
    throw e;
  }
}

export async function removeUploads(files: string[]) {
  await Promise.all(files.map((f) => bucket().file(uploadPath(f)).delete({ ignoreNotFound: true })));
}

// --- project thumbnails: files in Storage, so browsers can cache them and records stay small ---

/** "<projectId>.<12 hex of the content hash>.<ext>": a new name per new image, so it can be cached forever. */
export const THUMB_FILE = /^[0-9a-f-]{36}\.[0-9a-f]{12}\.(png|jpg)$/;
const THUMB_URL = '/api/uploads/';

/**
 * A `data:image/...;base64,` thumbnail as a file: its URL (the same image always gets the same URL)
 * and `save`, which uploads it. Callers skip `save` when the project already has that URL.
 */
export function thumbnailFile(projectId: string, dataUrl: string) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('not a data URL');
  const data = Buffer.from(m[2], 'base64');
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  const file = `${projectId}.${hash}.${m[1] === 'png' ? 'png' : 'jpg'}`;
  return { url: THUMB_URL + file, save: () => saveUpload(file, data, `image/${m[1]}`) };
}

/**
 * Deletes a thumbnail file this project owns. A design starts with its template's thumbnail URL,
 * so only files named after `projectId` are ever removed.
 */
export async function removeThumbnail(projectId: string, url: string | undefined) {
  const file = url?.startsWith(THUMB_URL) ? url.slice(THUMB_URL.length) : '';
  if (THUMB_FILE.test(file) && file.startsWith(projectId + '.')) await removeUploads([file]);
}

/** A new project's own copy of another project's thumbnail file (old inline thumbnails are kept as they are). */
export async function copyThumbnail(url: string | undefined, toProjectId: string): Promise<string | undefined> {
  const file = url?.startsWith(THUMB_URL) ? url.slice(THUMB_URL.length) : '';
  if (!THUMB_FILE.test(file)) return url;
  const copy = toProjectId + file.slice(file.indexOf('.'));
  await bucket().file(uploadPath(file)).copy(bucket().file(uploadPath(copy)));
  return THUMB_URL + copy;
}
