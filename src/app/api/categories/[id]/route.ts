import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { deleteCategory, updateCategory } from '@/lib/data/library';
import { files } from '@/lib/files';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const patch: { name?: string; description?: string } = {};
  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name || name.length > 80) return NextResponse.json({ error: 'שם לא תקין' }, { status: 400 });
    patch.name = name;
  }
  if (typeof body?.description === 'string') patch.description = body.description.trim().slice(0, 300);
  const result = await updateCategory(id, patch);
  if (result === 'missing') return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  if (result === 'duplicate') return NextResponse.json({ error: 'קטגוריה בשם הזה כבר קיימת' }, { status: 409 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const keys = await deleteCategory(id);
  if (!keys) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await files.remove(keys);
  return NextResponse.json({ ok: true });
}
