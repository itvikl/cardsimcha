import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { createCategory } from '@/lib/data/library';

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'שם הקטגוריה חובה' }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: 'השם ארוך מדי' }, { status: 400 });
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) : '';

  const result = await createCategory(name, description);
  if (!result) return NextResponse.json({ error: 'קטגוריה בשם הזה כבר קיימת' }, { status: 409 });
  return NextResponse.json(result, { status: 201 });
}
