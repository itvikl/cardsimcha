import { NextResponse } from 'next/server';
import { parseAdTexts } from '@/lib/adTextsParse';
import { requireUser } from '@/lib/auth';
import { parseColors } from '@/lib/brand';
import { copyTemplate } from '@/lib/copyTemplate';
import { findRows, getRow, newId, setRow } from '@/lib/db';
import { hasActiveSubscription } from '@/lib/entitlement';

export const dynamic = 'force-dynamic';

const MAX = 24;

/**
 * All the published templates of a series as the caller's own designs, in one action: { series, useBrand?, colors?, details?, only? }.
 * `details` (field label -> text) are written once and go into every piece that has the field; `only` (template ids) keeps just those pieces.
 * Returns each copy's id with its template, so the page can give each one the preview it already drew.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const series = typeof body?.series === 'string' ? body.series.trim() : '';
  if (!series) return NextResponse.json({ error: 'חסרה סדרה' }, { status: 400 });

  const only: unknown = body?.only;
  const templates = (await findRows('projects', { kind: 'template', status: 'published', series }))
    .filter((t) => !Array.isArray(only) || only.includes(t.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  if (!templates.length) return NextResponse.json({ error: 'הסדרה לא נמצאה' }, { status: 404 });
  if (templates.length > MAX) return NextResponse.json({ error: 'הסדרה גדולה מדי' }, { status: 400 });

  const [brand, noCredit] = await Promise.all([body.useBrand === true ? getRow('brands', user.id) : null, hasActiveSubscription(user.id)]);
  const colors = parseColors(body.colors);
  const adTexts = parseAdTexts(body.details);
  const seriesRun = newId();
  const copies = await Promise.all(templates.map((t) => copyTemplate(t, user.id, { brand, colors, noCredit, seriesRun, adTexts })));
  await Promise.all(copies.map((c) => setRow('projects', c)));
  return NextResponse.json({ seriesRun, designs: copies.map((c) => ({ id: c.id, templateId: c.templateId })) }, { status: 201 });
}
