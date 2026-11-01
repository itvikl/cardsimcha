import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { brandCategory, emptyBrand } from '@/lib/brand';
import { getRow, newId, removeUploads, saveUpload, setRow } from '@/lib/db';
import type { ImageAsset } from '@/lib/types';

const MAX_BYTES = 5 * 1024 * 1024;

/** Any customer can upload here, so the file's first bytes must agree with the type it claims. */
const TYPES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'image/png': { ext: '.png', matches: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/jpeg': { ext: '.jpg', matches: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  'image/webp': { ext: '.webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

/**
 * Sets the kit's logo. The previous file stays in storage: designs already made with it keep showing it.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  const type = TYPES[file.type];
  if (!type) return NextResponse.json({ error: 'סוג קובץ לא נתמך (PNG, JPG, WebP)' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'הקובץ גדול מ-5MB' }, { status: 400 });

  const width = Math.round(Number(form?.get('width')));
  const height = Math.round(Number(form?.get('height')));
  if (!(width > 0 && height > 0 && width < 20000 && height < 20000)) {
    return NextResponse.json({ error: 'מידות התמונה חסרות' }, { status: 400 });
  }
  const data = Buffer.from(await file.arrayBuffer());
  if (!type.matches(data)) return NextResponse.json({ error: 'הקובץ אינו תמונה תקינה' }, { status: 400 });

  const id = newId();
  const fileName = id + type.ext;
  const now = new Date().toISOString();
  await saveUpload(fileName, data, file.type);
  const asset: ImageAsset = { id, categoryId: brandCategory(user.id), name: 'לוגו', file: fileName, width, height, createdAt: now };
  try {
    await setRow('images', asset);
    const kit = { ...((await getRow('brands', user.id)) ?? emptyBrand(user.id)), logo: { assetId: id, file: fileName, width, height }, updatedAt: now };
    await setRow('brands', kit);
    return NextResponse.json(kit, { status: 201 });
  } catch (e) {
    await removeUploads([fileName]).catch(() => {});
    throw e;
  }
}

/** Takes the logo off the kit; designs already made with it keep it. */
export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const old = await getRow('brands', user.id);
  if (!old) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const { logo: _logo, ...rest } = old;
  void _logo;
  const kit = { ...rest, updatedAt: new Date().toISOString() };
  await setRow('brands', kit);
  return NextResponse.json(kit);
}
