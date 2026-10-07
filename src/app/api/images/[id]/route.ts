import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { updateDb, uploadsDir } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) return NextResponse.json({ error: 'שם חובה' }, { status: 400 });
  const img = await updateDb((db) => {
    const i = db.images.find((x) => x.id === id);
    if (i) i.name = name;
    return i ?? null;
  });
  if (!img) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json(img);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const file = await updateDb((db) => {
    const i = db.images.find((x) => x.id === id);
    if (!i) return null;
    db.images = db.images.filter((x) => x.id !== id);
    return i.file;
  });
  if (!file) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await fs.rm(path.join(uploadsDir, file), { force: true });
  return NextResponse.json({ ok: true });
}
