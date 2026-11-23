import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { setTemplatesPlaces } from '@/lib/data/tree';
import { parseAudience } from '@/lib/topics';

const strings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, max) : undefined;

/**
 * Files templates: `{ templateIds | templateId, topicIds?, labelId?, audience? }`. `topicIds`
 * replaces where each one is filed and `labelId` sets its "what it is" label (null clears it);
 * a field left out is left as it is. With `audience` both must belong to that door.
 */
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const templateIds = strings(body?.templateIds, 500) ?? (typeof body?.templateId === 'string' ? [body.templateId] : []);
  const topicIds = strings(body?.topicIds, 50);
  const labelId = typeof body?.labelId === 'string' ? body.labelId : body?.labelId === null ? null : undefined;
  if (!templateIds.length || (!topicIds && labelId === undefined)) return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  const r = await setTemplatesPlaces(templateIds, topicIds, labelId, parseAudience(body?.audience));
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
