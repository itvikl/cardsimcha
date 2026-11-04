import { NextResponse } from 'next/server';
import { formatById, formatOfPage } from '@/lib/adFormats';
import { backedByFacts, composeAds } from '@/lib/agent/compose';
import { requireUser } from '@/lib/auth';
import { businessBrief } from '@/lib/businessBrief';
import { AGENT_ENABLED, COMPOSE_DAILY_LIMIT } from '@/lib/config';
import { findRows, getRow, setRow } from '@/lib/db';
import { professionOf } from '@/lib/professions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * "Make me an ad": one sentence in, three ads back, each on a different layout of the profession and in the chosen size.
 * Nothing is saved: the page draws them, and the one the business picks is created through POST /api/projects like any design.
 * It's free for now, and every request costs a model call, so each user has a daily limit.
 */
export async function POST(req: Request) {
  if (!AGENT_ENABLED) return NextResponse.json({ error: 'הכתיבה האוטומטית לא זמינה כרגע' }, { status: 503 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const request = typeof body?.request === 'string' ? body.request.trim().slice(0, 500) : '';
  if (request.length < 3) return NextResponse.json({ error: 'כתבו מה תרצו לפרסם' }, { status: 400 });
  const profession = professionOf(typeof body?.topic === 'string' ? body.topic : null);
  if (!profession) return NextResponse.json({ error: 'בוחרים קודם מקצוע' }, { status: 400 });
  const format = formatById(body?.format) ?? formatById('status')!;

  // the layouts: the profession's first ads, which between them show its different looks
  const published = await findRows('projects', { kind: 'template', status: 'published', topic: profession.topic });
  const templates = profession.ads.flatMap((ad) => {
    const t = published.find((p) => p.sizeGroup === `${profession.topic}:${ad.key}` && formatOfPage(p.canvas.page.width_mm, p.canvas.page.height_mm)?.id === format.id);
    return t ? [t] : [];
  });
  if (templates.length < 3) return NextResponse.json({ error: 'אין עדיין מספיק עיצובים במידה הזו' }, { status: 404 });

  const useId = `${user.id}:${new Date().toISOString().slice(0, 10)}`;
  const used = (await getRow('usage', useId))?.count ?? 0;
  if (used >= COMPOSE_DAILY_LIMIT) return NextResponse.json({ error: 'הגעתם למספר הבקשות להיום. אפשר לבחור מודעה מהגלריה, או לחזור מחר.' }, { status: 429 });
  await setRow('usage', { id: useId, count: used + 1 });

  const [kit, items] = await Promise.all([getRow('brands', user.id), findRows('catalog', { ownerId: user.id })]);
  const brief = businessBrief(profession.topic, kit, items);
  try {
    const result = await composeAds(request, brief);
    if ('question' in result) return NextResponse.json({ question: result.question });
    const facts = `${request}\n${brief}\n${kit?.phone ?? ''}`;
    const ads = result.ads.filter((ad) => backedByFacts(ad, facts));
    if (!ads.length) return NextResponse.json({ error: 'לא הצלחנו לכתוב מודעה רק מהעובדות שנמסרו. נסו להוסיף פרטים.' }, { status: 422 });
    return NextResponse.json({
      options: ads.map((ad, i) => ({
        templateId: templates[i].id,
        direction: ad.direction,
        itemId: items.some((x) => x.id === ad.itemId) ? ad.itemId : null,
        texts: { כותרת: ad.headline, 'משפט משנה': ad.sub, 'נקודה 1': ad.points[0], 'נקודה 2': ad.points[1], 'נקודה 3': ad.points[2], 'קריאה לפעולה': ad.cta },
      })),
    });
  } catch (e) {
    console.error('compose failed', e);
    return NextResponse.json({ error: 'לא הצלחנו לכתוב את המודעות. נסו שוב.' }, { status: 502 });
  }
}
