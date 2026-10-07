import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from './types';

// Local storage for development. Everything goes through this module (and
// `uploadsDir`), so it can later be swapped for MongoDB + Cloud Storage.
const dataDir = path.join(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'db.json');
export const uploadsDir = path.join(dataDir, 'uploads');

const empty: Db = { categories: [], images: [], projects: [], users: [], sessions: [] };

// Serialize writes so concurrent requests cannot corrupt the file.
let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<Db> {
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    const db: Db = { ...empty, ...JSON.parse(raw) };
    // projects saved before accounts existed become draft templates
    for (const p of db.projects) {
      p.kind ??= 'template';
      p.status ??= 'draft';
      p.ownerId ??= '';
    }
    return db;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(empty);
    throw e;
  }
}

export function readDb(): Promise<Db> {
  return queue.then(read);
}

export function updateDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await read();
    const result = await fn(db);
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = dbFile + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.rename(tmp, dbFile);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export const newId = () => randomUUID();
