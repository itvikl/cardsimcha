import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { createLabel, listLabels } from '@/lib/data/tree';
import { parseAudience } from '@/lib/topics';

export const dynamic = 'force-dynamic';

/** the "what it is" labels of both doors. Public: customers filter by them. */
export async function GET() {
  return NextResponse.json((await listLabels()).map(({ id, name, audience, position }) => ({ id, name, audience, position })));
}

/** a new label: `{ name, audience }` (admin) */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  const audience = parseAudience(body?.audience);
  if (!name || name.length > 40 || !audience) return NextResponse.json({ error: 'צריך שם, עד 40 תווים, ודלת' }, { status: 400 });
  const r = await createLabel(name, audience);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
