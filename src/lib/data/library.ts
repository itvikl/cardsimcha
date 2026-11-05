import type { Asset, Collection } from '@/generated/prisma/client';
import type { Category, ImageAsset } from '../types';
import { prisma } from './prisma';

// The platform image library: collections (the admin's image "categories") and their
// images. Workspace libraries come with the business features; until then every row here
// has workspace_id null.

const toCategory = (c: Collection): Category => ({
  id: c.id,
  name: c.name,
  description: c.description,
  createdAt: c.createdAt.toISOString(),
});

const toImage = (a: Asset): ImageAsset => ({
  id: a.id,
  categoryId: a.collectionId ?? '',
  name: a.name,
  file: a.fileKey.slice(a.fileKey.lastIndexOf('/') + 1),
  width: a.width,
  height: a.height,
  createdAt: a.createdAt.toISOString(),
});

/** where a platform image is stored; its public name ("file") is the last part */
export const assetFileKey = (file: string) => `assets/platform/${file}`;

export async function listCategories(): Promise<Category[]> {
  return (await prisma.collection.findMany({ where: { workspaceId: null }, orderBy: { createdAt: 'asc' } })).map(toCategory);
}

export async function listImages(): Promise<ImageAsset[]> {
  return (await prisma.asset.findMany({ where: { workspaceId: null, kind: 'image' }, orderBy: { createdAt: 'asc' } })).map(toImage);
}

export async function getImage(id: string): Promise<ImageAsset | null> {
  const a = await prisma.asset.findUnique({ where: { id } });
  return a && toImage(a);
}

export async function categoryExists(id: string): Promise<boolean> {
  return (await prisma.collection.count({ where: { id, workspaceId: null } })) > 0;
}

/** null when a category with this name exists */
export async function createCategory(name: string, description: string): Promise<Category | null> {
  return prisma.$transaction(async (tx) => {
    if (await tx.collection.findFirst({ where: { workspaceId: null, name } })) return null;
    return toCategory(await tx.collection.create({ data: { name, description } }));
  });
}

export async function updateCategory(
  id: string,
  patch: { name?: string; description?: string },
): Promise<Category | 'missing' | 'duplicate'> {
  return prisma.$transaction(async (tx) => {
    const cat = await tx.collection.findFirst({ where: { id, workspaceId: null } });
    if (!cat) return 'missing' as const;
    if (patch.name && (await tx.collection.findFirst({ where: { workspaceId: null, name: patch.name, id: { not: id } } }))) {
      return 'duplicate' as const;
    }
    return toCategory(await tx.collection.update({ where: { id }, data: patch }));
  });
}

/** Deletes the category and its images; returns the file keys to remove, or null if missing. */
export async function deleteCategory(id: string): Promise<string[] | null> {
  return prisma.$transaction(async (tx) => {
    if (!(await tx.collection.findFirst({ where: { id, workspaceId: null } }))) return null;
    const assets = await tx.asset.findMany({ where: { collectionId: id }, select: { fileKey: true } });
    await tx.asset.deleteMany({ where: { collectionId: id } });
    await tx.collection.delete({ where: { id } });
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
}): Promise<ImageAsset | null> {
  return prisma.$transaction(async (tx) => {
    if (!(await tx.collection.findFirst({ where: { id: input.categoryId, workspaceId: null } }))) return null;
    const a = await tx.asset.create({
      data: {
        id: input.id,
        collectionId: input.categoryId,
        kind: 'image',
        name: input.name,
        fileKey: assetFileKey(input.file),
        width: input.width,
        height: input.height,
      },
    });
    return toImage(a);
  });
}

export async function renameImage(id: string, name: string): Promise<ImageAsset | null> {
  const r = await prisma.asset.updateMany({ where: { id }, data: { name } });
  return r.count ? getImage(id) : null;
}

/** returns the file key to remove, or null if missing */
export async function deleteImage(id: string): Promise<string | null> {
  const a = await prisma.asset.findUnique({ where: { id }, select: { fileKey: true } });
  if (!a) return null;
  const r = await prisma.asset.deleteMany({ where: { id } });
  return r.count ? a.fileKey : null;
}

/** the stored key behind a public image name "<id>.<ext>", or null */
export async function fileKeyOfImage(file: string): Promise<string | null> {
  const id = file.slice(0, file.lastIndexOf('.'));
  const a = await prisma.asset.findUnique({ where: { id }, select: { fileKey: true } });
  return a && a.fileKey.endsWith(`/${file}`) ? a.fileKey : null;
}
