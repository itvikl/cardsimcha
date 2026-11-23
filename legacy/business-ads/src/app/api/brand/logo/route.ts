import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { emptyBrand } from '@/lib/brand';
import { getRow, setRow } from '@/lib/db';
import { saveUserImage } from '@/lib/imageUpload';

/**
 * Sets the kit's logo. The previous file stays in storage: designs already made with it keep showing it.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const form = await req.formData().catch(() => null);
  const logo = await saveUserImage(form, user.id, 'לוגו');
  if (typeof logo === 'string') return NextResponse.json({ error: logo }, { status: 400 });
  const kit = { ...((await getRow('brands', user.id)) ?? emptyBrand(user.id)), logo, updatedAt: new Date().toISOString() };
  await setRow('brands', kit);
  return NextResponse.json(kit, { status: 201 });
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
