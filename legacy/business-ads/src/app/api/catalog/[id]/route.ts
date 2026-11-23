import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { deleteRow, getRow, setRow } from '@/lib/db';
import { parseCatalogFields } from '@/lib/catalog';
import { saveUserImage } from '@/lib/imageUpload';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** Changes an item; a new picture replaces the old one on this item, and designs already made with it keep theirs. */
export async function PUT(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const old = await getRow('catalog', id);
  if (!old || old.ownerId !== user.id) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const fields = parseCatalogFields(form);
  if (typeof fields === 'string') return NextResponse.json({ error: fields }, { status: 400 });
  const photo = form?.get('file') instanceof File ? await saveUserImage(form, user.id, fields.name) : old.photo;
  if (typeof photo === 'string') return NextResponse.json({ error: photo }, { status: 400 });
  const item = { ...old, ...fields, ...(photo ? { photo } : {}), updatedAt: new Date().toISOString() };
  await setRow('catalog', item);
  return NextResponse.json(item);
}

/** Takes the item off the catalog; designs already made with it keep their picture. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const old = await getRow('catalog', id);
  if (!old || old.ownerId !== user.id) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await deleteRow('catalog', id);
  return NextResponse.json({ ok: true });
}
