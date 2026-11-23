import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { deleteTextStyle } from '@/lib/data/textStyles';

export const dynamic = 'force-dynamic';

/** Deletes a saved style. Texts that took its look keep it: a style is copied onto a text, not linked. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!(await deleteTextStyle(id))) return NextResponse.json({ error: 'הסגנון לא נמצא' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
