import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Stored files (uploaded images, thumbnails, later fonts and exports), addressed by key,
 * e.g. "assets/platform/<id>.png". FILES_DRIVER picks where they live:
 * - local (default): the folder data/files/
 * - s3: the private S3 bucket in S3_BUCKET (region from AWS_REGION)
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
 * A private S3 bucket. Credentials and region come from the environment as usual for AWS (on ECS, the task role;
 * locally, AWS_PROFILE or the AWS_* variables). The app serves files through its own routes, so the bucket never needs
 * to be public; a CDN in front of those routes comes later.
 */
function s3Store(bucket: string): FileStore {
  // loaded on first use, so the local driver never pulls in the AWS SDK
  let client: Promise<{ s3: import('@aws-sdk/client-s3').S3Client; sdk: typeof import('@aws-sdk/client-s3') }> | null = null;
  const s3 = () =>
    (client ??= import('@aws-sdk/client-s3').then((sdk) => ({ sdk, s3: new sdk.S3Client({ region: process.env.AWS_REGION }) })));
  return {
    async put(key, data, contentType) {
      const { s3: c, sdk } = await s3();
      await c.send(new sdk.PutObjectCommand({ Bucket: bucket, Key: checkKey(key), Body: data, ContentType: contentType }));
    },
    async get(key) {
      const { s3: c, sdk } = await s3();
      try {
        const r = await c.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: checkKey(key) }));
        return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
      } catch (e) {
        if (e instanceof sdk.NoSuchKey || (e as { name?: string }).name === 'NoSuchKey') return null;
        throw e;
      }
    },
    async remove(keys) {
      if (!keys.length) return;
      const { s3: c, sdk } = await s3();
      // one request deletes up to 1,000 keys
      for (let i = 0; i < keys.length; i += 1000) {
        const Objects = keys.slice(i, i + 1000).map((k) => ({ Key: checkKey(k) }));
        await c.send(new sdk.DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }));
      }
    },
  };
}

function createStore(): FileStore {
  const driver = process.env.FILES_DRIVER ?? 'local';
  if (driver === 'local') return localStore(path.join(process.cwd(), 'data', 'files'));
  if (driver === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('FILES_DRIVER=s3 needs S3_BUCKET');
    return s3Store(bucket);
  }
  throw new Error(`FILES_DRIVER=${driver} is not supported (local or s3)`);
}

export const files: FileStore = createStore();
