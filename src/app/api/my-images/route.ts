import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { brandCategory } from '@/lib/brand';
import { getRow } from '@/lib/db';
import { saveUserImage } from '@/lib/imageUpload';

export const dynamic = 'force-dynamic';

/**
 * A picture of the business's own for its ads: { file, width, height, name?, sticker? }. It goes in its private category,
 * so only it sees it. Answers with the library row, ready for the editor.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const form = await req.formData().catch(() => null);
  const sticker = form?.get('sticker') === 'true';
  const sent = form?.get('name');
  const name = typeof sent === 'string' && sent.trim() ? sent.trim().slice(0, 60) : sticker ? 'מדבקה שלי' : 'תמונה שלי';
  const saved = await saveUserImage(form, user.id, name, sticker ? { ownSticker: true } : {});
  if (typeof saved === 'string') return NextResponse.json({ error: saved }, { status: 400 });
  const asset = await getRow('images', saved.assetId);
  if (asset?.categoryId !== brandCategory(user.id)) return NextResponse.json({ error: 'השמירה נכשלה' }, { status: 500 });
  return NextResponse.json(asset, { status: 201 });
}
