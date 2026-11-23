import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { createNode, getTree } from '@/lib/data/tree';
import { parseAudience } from '@/lib/topics';

export const dynamic = 'force-dynamic';

const cleanName = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** the whole occasion tree, with what is filed on each node and the templates filed nowhere (admin) */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  return NextResponse.json(await getTree());
}

/** a new node: `{ name, parentId }`, or `{ name, audience }` for a new category */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const name = cleanName(body?.name);
  if (!name || name.length > 60) return NextResponse.json({ error: 'צריך שם, עד 60 תווים' }, { status: 400 });
  const parentId = typeof body?.parentId === 'string' ? body.parentId : null;
  const result = await createNode({ name, parentId, audience: parseAudience(body?.audience) });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
