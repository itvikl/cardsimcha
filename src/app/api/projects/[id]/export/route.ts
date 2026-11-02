import { NextResponse } from 'next/server';
import { canRead } from '@/lib/access';
import { requireUser } from '@/lib/auth';
import { getRow } from '@/lib/db';
import { entitlement } from '@/lib/entitlement';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/**
 * Asked before each download: the answer says whether this design may be taken away, or what it costs.
 * The picture itself is drawn in the browser, which already holds the design to show it, so someone working
 * in the browser's developer tools could get around this; the video is made on the server and can't be.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const project = await getRow('projects', id);
  if (!project || !canRead(user, project)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const e = await entitlement(user, project);
  return NextResponse.json(e, { status: e.allowed ? 200 : 402 });
}
