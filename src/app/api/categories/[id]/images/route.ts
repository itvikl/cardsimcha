import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { addImage, assetFileKey, categoryExists } from '@/lib/data/library';
import { newId } from '@/lib/data/ids';
import { files } from '@/lib/files';

type Ctx = { params: Promise<{ id: string }> };

const MAX_BYTES = 25 * 1024 * 1024;
const TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export async function POST(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!(await categoryExists(id))) {
    return NextResponse.json({ error: 'הקטגוריה לא נמצאה' }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'סוג קובץ לא נתמך (PNG, JPG, WebP, GIF)' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'הקובץ גדול מ-25MB' }, { status: 400 });

  const width = Math.round(Number(form?.get('width')));
  const height = Math.round(Number(form?.get('height')));
  if (!(width > 0 && height > 0 && width < 20000 && height < 20000)) {
    return NextResponse.json({ error: 'מידות התמונה חסרות' }, { status: 400 });
  }

  const assetId = newId();
  const fileName = assetId + ext;
  await files.put(assetFileKey(fileName), Buffer.from(await file.arrayBuffer()), file.type);

  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'תמונה';
  // null when the category was deleted while the file was uploading
  const asset = await addImage({ id: assetId, categoryId: id, name, file: fileName, width, height });
  if (!asset) {
    await files.remove([assetFileKey(fileName)]);
    return NextResponse.json({ error: 'הקטגוריה נמחקה' }, { status: 404 });
  }
  return NextResponse.json(asset, { status: 201 });
}
