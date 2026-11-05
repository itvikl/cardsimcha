import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Stored files (uploaded images, thumbnails, later fonts and exports), addressed by key,
 * e.g. "assets/platform/<id>.png". FILES_DRIVER picks where they live:
 * - local (default): the folder data/files/
 * - s3: the S3 bucket in S3_BUCKET (added with the AWS environment, rollout step 5)
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

function createStore(): FileStore {
  const driver = process.env.FILES_DRIVER ?? 'local';
  if (driver === 'local') return localStore(path.join(process.cwd(), 'data', 'files'));
  throw new Error(`FILES_DRIVER=${driver} is not available yet (supported: local)`);
}

export const files: FileStore = createStore();
