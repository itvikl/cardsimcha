import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { FONTS } from '@/lib/canvas';
import { findRows, getRow, newId, saveUpload, setRow } from '@/lib/db';
import type { FontAsset } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

/** a font's type by its first bytes: an upload's claimed type says nothing */
function fontType(b: Buffer): { ext: string; mime: string } | null {
  const head = b.subarray(0, 4).toString('latin1');
  if (head === 'wOF2') return { ext: '.woff2', mime: 'font/woff2' };
  if (head === 'wOFF') return { ext: '.woff', mime: 'font/woff' };
  if (head === 'OTTO') return { ext: '.otf', mime: 'font/otf' };
  if (b.subarray(0, 4).toString('hex') === '00010000' || head === 'true') return { ext: '.ttf', mime: 'font/ttf' };
  return null;
}

/** Everyone draws designs with these, so the list is open. */
export async function GET() {
  const list = await findRows('fonts', {});
  return NextResponse.json(list.map(({ id, family, file, customer }) => ({ id, family, file, customer })).sort((a, b) => a.family.localeCompare(b.family)));
}

/** Admin: a new font for designs, { file, family }. Businesses are offered it only once the admin says so. */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const sent = form?.get('family');
  const family = typeof sent === 'string' ? sent.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!(file instanceof File)) return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  if (!family || !/^[\p{L}\p{N} ._-]+$/u.test(family)) return NextResponse.json({ error: 'שם הפונט: אותיות, מספרים ורווחים בלבד' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'הקובץ גדול מ-10MB' }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  const type = fontType(data);
  if (!type) return NextResponse.json({ error: 'זה לא קובץ פונט (WOFF2, WOFF, TTF, OTF)' }, { status: 400 });
  const taken = (await findRows('fonts', { family })).length > 0 || (FONTS as readonly string[]).includes(family);
  if (taken) return NextResponse.json({ error: 'פונט בשם הזה כבר קיים' }, { status: 409 });
  const id = newId();
  const fileName = id + type.ext;
  await saveUpload(fileName, data, type.mime);
  const row: FontAsset = { id, family, file: fileName, customer: false, createdAt: new Date().toISOString() };
  await setRow('fonts', row);
  return NextResponse.json((await getRow('fonts', id)) ?? row, { status: 201 });
}
