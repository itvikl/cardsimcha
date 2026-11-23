import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Stored files (uploaded images, thumbnails, later fonts and exports), addressed by key,
 * e.g. "assets/platform/<id>.png". FILES_DRIVER picks where they live:
 * - firebase (default): the Firebase project's Cloud Storage bucket
 * - local: the folder data/files/, for development without Firebase credentials
 */
export interface FileStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(keys: string[]): Promise<void>;
}

const KEY = /^[\w-]+(\/[\w.-]+)+$/;

function checkKey(key: string) {
  if (!KEY.test(key) || key.includes('..')) throw new Error(`bad file key: ${key}`);
  return key;
}

function localStore(root: string): FileStore {
  const full = (key: string) => path.join(root, ...checkKey(key).split('/'));
  return {
    async put(key, data) {
      const file = full(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      try {
        return await readFile(full(key));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    async remove(keys) {
      await Promise.all(keys.map((k) => rm(full(k), { force: true })));
    },
  };
}

/**
 * The Firebase project's Cloud Storage bucket (FIREBASE_STORAGE_BUCKET, default
 * <project>.firebasestorage.app). Keys live beside main's "uploads/" folder, never in it. The
 * app serves files through its own routes, so the bucket stays private.
 */
function firebaseStore(): FileStore {
  // loaded on first use, so the local driver never needs Firebase credentials
  const bucket = () => import('./firebase').then((m) => m.bucket());
  return {
    async put(key, data, contentType) {
      await (await bucket()).file(checkKey(key)).save(data, { contentType, resumable: false });
    },
    async get(key) {
      try {
        const [data] = await (await bucket()).file(checkKey(key)).download();
        return data;
      } catch (e) {
        if ((e as { code?: number }).code === 404) return null;
        throw e;
      }
    },
    async remove(keys) {
      const b = await bucket();
      await Promise.all(keys.map((k) => b.file(checkKey(k)).delete({ ignoreNotFound: true })));
    },
  };
}

function createStore(): FileStore {
  const driver = process.env.FILES_DRIVER ?? 'firebase';
  if (driver === 'local') return localStore(path.join(process.cwd(), 'data', 'files'));
  if (driver === 'firebase') return firebaseStore();
  throw new Error(`FILES_DRIVER=${driver} is not supported (firebase or local)`);
}

export const files: FileStore = createStore();
