import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { deleteRow, getRow, updateRow } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** Admin: whether businesses are offered this font for their own texts. */
export async function PATCH(req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.customer !== 'boolean') return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  const row = await updateRow('fonts', id, (f) => {
    if (!f) return { result: null, write: false };
    f.customer = body.customer;
    return { result: f, write: true };
  });
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json(row);
}

/** Admin: takes the font off the list. Its file stays, so designs made with it still have it. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  if (!(await getRow('fonts', id))) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await deleteRow('fonts', id);
  return NextResponse.json({ ok: true });
}
