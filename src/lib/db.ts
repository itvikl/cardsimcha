import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { firestore, bucket } from './firebase';
import type { Db } from './types';

// Data lives in Firebase: one Firestore document per record (collections named after the Db
// keys) and uploaded images in Cloud Storage under "uploads/". Everything goes through this
// module, so callers still see a plain `Db` object.
const KEYS = ['categories', 'carousel', 'images', 'projects', 'users', 'sessions'] as const;
type Key = (typeof KEYS)[number];

// sessions have no id; their token hash is the document id
const docId = (key: Key, row: Record<string, unknown>) => String(key === 'sessions' ? row.tokenHash : row.id);

// Serialize writes so concurrent requests cannot corrupt each other.
let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<Db> {
  const fs = firestore();
  const snaps = await Promise.all(KEYS.map((k) => fs.collection(k).get()));
  const db = Object.fromEntries(KEYS.map((k, i) => [k, snaps[i].docs.map((d) => d.data())])) as unknown as Db;
  // projects saved before accounts existed become draft templates
  for (const p of db.projects) {
    p.kind ??= 'template';
    p.status ??= 'draft';
    p.ownerId ??= '';
  }
  return db;
}

export function readDb(): Promise<Db> {
  return queue.then(read);
}

export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await read();
    const before = structuredClone(db);
    const result = await fn(db);

    const fs = firestore();
    const batch = fs.batch();
    let ops = 0;
    for (const key of KEYS) {
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
