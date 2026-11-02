import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { parseColors } from '@/lib/brand';
import { copyTemplate } from '@/lib/copyTemplate';
import { findRows, getRow, newId, setRow } from '@/lib/db';
import { hasActiveSubscription } from '@/lib/entitlement';
import { fillFor, type Answers } from '@/lib/story';

export const dynamic = 'force-dynamic';

const MAX = 24;

const parseAnswers = (v: unknown): Answers => {
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(Object.entries(v).flatMap(([k, x]) => (typeof x === 'string' ? [[k, x.slice(0, 120)]] : []))) as Answers;
};

/**
 * All the published templates of a series as the caller's own designs, in one action: { series, useBrand?, answers?, colors? }.
 * Returns each copy's id with its template, so the page can give each one the preview it already drew.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const series = typeof body?.series === 'string' ? body.series.trim() : '';
  if (!series) return NextResponse.json({ error: 'חסרה סדרה' }, { status: 400 });

  const templates = (await findRows('projects', { kind: 'template', status: 'published', series })).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  if (!templates.length) return NextResponse.json({ error: 'הסדרה לא נמצאה' }, { status: 404 });
  if (templates.length > MAX) return NextResponse.json({ error: 'הסדרה גדולה מדי' }, { status: 400 });

  const [brand, noCredit] = await Promise.all([body.useBrand === true ? getRow('brands', user.id) : null, hasActiveSubscription(user.id)]);
  const answers = parseAnswers(body.answers);
  const colors = parseColors(body.colors);
  const seriesRun = newId();
  const copies = await Promise.all(templates.map((t) => copyTemplate(t, user.id, { brand, colors, noCredit, seriesRun, fill: fillFor(t.canvas, answers) })));
  await Promise.all(copies.map((c) => setRow('projects', c)));
  return NextResponse.json({ seriesRun, designs: copies.map((c) => ({ id: c.id, templateId: c.templateId })) }, { status: 201 });
}
