import { NextResponse } from 'next/server';
import { allElements, emptyDoc, setBackground, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { summarize } from '@/lib/summary';
import { parseAudience } from '@/lib/topics';
import { getImage } from '@/lib/data/library';
import { createDesignFromTemplate, createTemplate, listProjectsFor, topicConflictFor } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

/** Admin: every template plus their own designs. Customer: their own designs. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const list = (await listProjectsFor(user)).map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json(list);
}

/**
 * - { templateId, prefill? }: create the caller's own design as a copy of a template
 *   (customers: published templates only; admins may copy any template to test it).
 *   `prefill` only fills an editable text field whose label mentions a name.
 * - { name, width_mm, height_mm, topic?, audience? }: create a new blank template (admin only);
 *   with `audience`, the topic must belong to that door (a new topic is claimed for it).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);

  if (typeof body?.templateId === 'string') {
    // the name typed on the home page goes into the first editable field labelled as a name
    const prefill = typeof body.prefill === 'string' ? body.prefill.trim().slice(0, 80) : '';
    const id = await createDesignFromTemplate(user, body.templateId, (canvas) => {
      if (!prefill) return;
      const field = allElements(canvas).find((e) => e.type === 'text' && e.locks.content && (e.field?.label ?? '').includes('שם'));
      if (field?.type === 'text') field.text = prefill;
    });
    if (!id) return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
    return NextResponse.json({ id }, { status: 201 });
  }

  if (user.role !== 'admin') return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'תבנית חדשה';
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 60) : '';
  let canvas = validateDoc(emptyDoc(Number(body?.width_mm) || 210, Number(body?.height_mm) || 297));
  if (!canvas) return NextResponse.json({ error: 'מידות לא תקינות' }, { status: 400 });
  const audience = parseAudience(body?.audience);
  // fail before the work below is wasted (checked again, atomically, when saving)
  if (audience) {
    const why = await topicConflictFor(topic, audience);
    if (why) return NextResponse.json({ error: why }, { status: 400 });
  }
  const bg = typeof body?.backgroundAssetId === 'string' ? await getImage(body.backgroundAssetId) : null;
  // the chosen image fills the page like CSS "cover"
  if (bg) canvas = setBackground(canvas, { image: { asset_id: bg.id, fit: 'cover' } });
  const result = await createTemplate({ name, topic, canvas, audience });
  if ('conflict' in result) return NextResponse.json({ error: result.conflict }, { status: 400 });
  return NextResponse.json({ id: result.id }, { status: 201 });
}
