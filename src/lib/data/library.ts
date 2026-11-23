import type { Category, ImageAsset } from '../types';
import { newId } from './ids';
import { C, db, now } from './store';

// The platform image library: collections (the admin's image "categories") and their
// images. Workspace libraries come with the business features; until then every document
// here has workspaceId null.

export type CollectionDoc = {
  id: string;
  workspaceId: string | null;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetDoc = {
  id: string;
  workspaceId: string | null;
  collectionId: string | null;
  kind: 'image' | 'svg' | 'pattern' | 'sticker';
  name: string;
  fileKey: string;
  width: number;
  height: number;
  /** JSON text: what is kept with an image for looking into it later (Firestore takes no nested arrays) */
  metadata: string;
  /** where it is filed in the occasion tree */
  places: string[];
  createdAt: string;
  updatedAt: string;
};

const toCategory = (c: CollectionDoc): Category => ({ id: c.id, name: c.name, description: c.description, createdAt: c.createdAt });

const toImage = (a: AssetDoc): ImageAsset => ({
  id: a.id,
  categoryId: a.collectionId ?? '',
  name: a.name,
  file: a.fileKey.slice(a.fileKey.lastIndexOf('/') + 1),
  width: a.width,
  height: a.height,
  createdAt: a.createdAt,
});

const oldestFirst = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);

/** where a platform image is stored; its public name ("file") is the last part */
export const assetFileKey = (file: string) => `assets/platform/${file}`;

const platformCollections = () => db.find<CollectionDoc>(C.collections, ['workspaceId', '==', null]);

export async function listCategories(): Promise<Category[]> {
  return (await platformCollections()).sort(oldestFirst).map(toCategory);
}

export async function listImages(): Promise<ImageAsset[]> {
  const rows = await db.pick<AssetDoc>(
    C.assets,
    ['collectionId', 'name', 'fileKey', 'width', 'height', 'createdAt'],
    ['workspaceId', '==', null],
    ['kind', '==', 'image'],
  );
  return rows.sort(oldestFirst).map(toImage);
}

export async function getImage(id: string): Promise<ImageAsset | null> {
  const a = await db.get<AssetDoc>(C.assets, id);
  return a && toImage(a);
}

const platformCollection = async (id: string) => {
  const c = await db.get<CollectionDoc>(C.collections, id);
  return c && c.workspaceId === null ? c : null;
};

export async function categoryExists(id: string): Promise<boolean> {
  return !!(await platformCollection(id));
}

/** null when a category with this name exists */
export async function createCategory(name: string, description: string): Promise<Category | null> {
  return db.tx(async (t) => {
    const same = await t.find<CollectionDoc>(C.collections, ['workspaceId', '==', null], ['name', '==', name]);
    if (same.length) return null;
    const at = now();
    const c: CollectionDoc = { id: newId(), workspaceId: null, name, description, createdAt: at, updatedAt: at };
    t.set(C.collections, c.id, c);
    return toCategory(c);
  });
}

export async function updateCategory(
  id: string,
  patch: { name?: string; description?: string },
): Promise<Category | 'missing' | 'duplicate'> {
  return db.tx(async (t) => {
    const cat = await t.get<CollectionDoc>(C.collections, id);
    if (!cat || cat.workspaceId !== null) return 'missing' as const;
    if (patch.name) {
      const same = await t.find<CollectionDoc>(C.collections, ['workspaceId', '==', null], ['name', '==', patch.name]);
      if (same.some((c) => c.id !== id)) return 'duplicate' as const;
    }
    const next = { ...cat, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), updatedAt: now() };
    t.set(C.collections, id, next);
    return toCategory(next);
  });
}

/** Deletes the category and its images; returns the file keys to remove, or null if missing. */
export async function deleteCategory(id: string): Promise<string[] | null> {
  return db.tx(async (t) => {
    const cat = await t.get<CollectionDoc>(C.collections, id);
    if (!cat || cat.workspaceId !== null) return null;
    const assets = await t.pick<Pick<AssetDoc, 'id' | 'fileKey'>>(C.assets, ['fileKey'], ['collectionId', '==', id]);
    for (const a of assets) t.delete(C.assets, a.id);
    t.delete(C.collections, id);
    return assets.map((a) => a.fileKey);
  });
}

/** null when the category was deleted meanwhile */
export async function addImage(input: {
  id: string;
  categoryId: string;
  name: string;
  file: string;
  width: number;
  height: number;
  /** kept with the image, for looking into it later (a design import keeps what the model read) */
  metadata?: Record<string, unknown>;
}): Promise<ImageAsset | null> {
  return db.tx(async (t) => {
    const cat = await t.get<CollectionDoc>(C.collections, input.categoryId);
    if (!cat || cat.workspaceId !== null) return null;
    const at = now();
    const a: AssetDoc = {
      id: input.id,
      workspaceId: null,
      collectionId: input.categoryId,
      kind: 'image',
      name: input.name,
      fileKey: assetFileKey(input.file),
      width: input.width,
      height: input.height,
      metadata: JSON.stringify(input.metadata ?? {}),
      places: [],
      createdAt: at,
      updatedAt: at,
    };
    t.set(C.assets, a.id, a);
    return toImage(a);
  });
}

export async function renameImage(id: string, name: string): Promise<ImageAsset | null> {
  return db.tx(async (t) => {
    const a = await t.get<AssetDoc>(C.assets, id);
    if (!a) return null;
    t.update(C.assets, id, { name, updatedAt: now() });
    return toImage({ ...a, name });
  });
}

/** returns the file key to remove, or null if missing */
export async function deleteImage(id: string): Promise<string | null> {
  return db.tx(async (t) => {
    const a = await t.get<AssetDoc>(C.assets, id);
    if (!a) return null;
    t.delete(C.assets, id);
    return a.fileKey;
  });
}

/** the stored key behind a public image name "<id>.<ext>", or null */
export async function fileKeyOfImage(file: string): Promise<string | null> {
  const id = file.slice(0, file.lastIndexOf('.'));
  if (!id) return null;
  const a = await db.get<AssetDoc>(C.assets, id);
  return a && a.fileKey.endsWith(`/${file}`) ? a.fileKey : null;
}
