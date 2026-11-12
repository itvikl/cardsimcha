import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { deleteImage, renameImage } from '@/lib/data/library';
import { files } from '@/lib/files';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) return NextResponse.json({ error: 'שם חובה' }, { status: 400 });
  const img = await renameImage(id, name);
  if (!img) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json(img);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const key = await deleteImage(id);
  if (!key) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await files.remove([key]);
  return NextResponse.json({ ok: true });
}
