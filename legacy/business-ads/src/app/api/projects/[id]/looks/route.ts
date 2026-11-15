import { NextResponse } from 'next/server';
import { canRead } from '@/lib/access';
import { requireUser } from '@/lib/auth';
import { getRow } from '@/lib/db';
import { cardLooks } from '@/lib/looks';
import { projectContext } from '@/lib/projectContext';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** The wordings and backdrops a customer can move between inside this private card (see looks.ts). */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const p = await getRow('projects', id);
  if (!p || !canRead(user, p)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json(await cardLooks(p, await projectContext(p), user));
}
