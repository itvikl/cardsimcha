import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { brandCategory } from '@/lib/brand';
import { updateRow } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** Takes a picture off the business's list. The row and file stay: designs already made with it keep showing it. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const found = await updateRow('images', id, async (i) => {
    if (i?.categoryId !== brandCategory(user.id)) return { result: false, write: false };
    i.removed = true;
    return { result: true, write: true };
  });
  if (!found) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
