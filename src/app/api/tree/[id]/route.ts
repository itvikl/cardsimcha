import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { deleteNode, moveNode, renameNode, type TreeError } from '@/lib/data/tree';

type Ctx = { params: Promise<{ id: string }> };

const answer = (r: { ok: true } | TreeError) =>
  'error' in r ? NextResponse.json({ error: r.error }, { status: r.status }) : NextResponse.json(r);

/** `{ name }` renames; `{ parentId, index? }` moves (parentId null makes it a category) */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.name === 'string') {
    const name = body.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) return NextResponse.json({ error: 'צריך שם, עד 60 תווים' }, { status: 400 });
    const r = await renameNode(id, name);
    if ('error' in r) return answer(r);
  }
  if (body && 'parentId' in body) {
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    const index = Number.isInteger(body.index) ? (body.index as number) : undefined;
    return answer(await moveNode(id, parentId, index));
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  return answer(await deleteNode(id));
}
