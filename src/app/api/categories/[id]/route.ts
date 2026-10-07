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
  const result = await updateDb((db) => {
    const cat = db.categories.find((c) => c.id === id);
    if (!cat) return 'missing' as const;
    if (typeof body?.name === 'string') {
      const name = body.name.trim();
      if (!name || name.length > 80) return 'invalid' as const;
      if (db.categories.some((c) => c.id !== id && c.name === name)) return 'duplicate' as const;
      cat.name = name;
    }
    if (typeof body?.description === 'string') cat.description = body.description.trim().slice(0, 300);
    return cat;
  });
  if (result === 'missing') return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  if (result === 'invalid') return NextResponse.json({ error: 'שם לא תקין' }, { status: 400 });
  if (result === 'duplicate') return NextResponse.json({ error: 'קטגוריה בשם הזה כבר קיימת' }, { status: 409 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const files = await updateDb((db) => {
    if (!db.categories.some((c) => c.id === id)) return null;
    const removed = db.images.filter((i) => i.categoryId === id).map((i) => i.file);
    db.images = db.images.filter((i) => i.categoryId !== id);
    db.categories = db.categories.filter((c) => c.id !== id);
    return removed;
  });
  if (!files) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await Promise.all(files.map((f) => fs.rm(path.join(uploadsDir, f), { force: true })));
  return NextResponse.json({ ok: true });
}
