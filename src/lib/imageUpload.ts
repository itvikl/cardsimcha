import { brandCategory } from './brand';
import { newId, removeUploads, saveUpload, setRow } from './db';
import type { ImageAsset } from './types';

const MAX_BYTES = 5 * 1024 * 1024;

/** Any customer can upload here, so the file's first bytes must agree with the type it claims. */
const TYPES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'image/png': { ext: '.png', matches: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/jpeg': { ext: '.jpg', matches: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  'image/webp': { ext: '.webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export type SavedImage = { assetId: string; file: string; width: number; height: number };

/**
 * Stores the picture in a form's `file` field (with its `width` and `height`) as a private image of this user:
 * only they see it in the library, and the editor draws it like any picture. Returns the reason when it can't be stored.
 */
export async function saveUserImage(form: FormData | null, userId: string, name: string): Promise<SavedImage | string> {
  const file = form?.get('file');
  if (!(file instanceof File)) return 'לא נשלח קובץ';
  const type = TYPES[file.type];
  if (!type) return 'סוג קובץ לא נתמך (PNG, JPG, WebP)';
  if (file.size > MAX_BYTES) return 'הקובץ גדול מ-5MB';

  const width = Math.round(Number(form?.get('width')));
  const height = Math.round(Number(form?.get('height')));
  if (!(width > 0 && height > 0 && width < 20000 && height < 20000)) return 'מידות התמונה חסרות';
  const data = Buffer.from(await file.arrayBuffer());
  if (!type.matches(data)) return 'הקובץ אינו תמונה תקינה';

  const id = newId();
  const fileName = id + type.ext;
  await saveUpload(fileName, data, file.type);
  const asset: ImageAsset = { id, categoryId: brandCategory(userId), name, file: fileName, width, height, createdAt: new Date().toISOString() };
  try {
    await setRow('images', asset);
  } catch (e) {
    await removeUploads([fileName]).catch(() => {});
    throw e;
  }
  return { assetId: id, file: fileName, width, height };
}
