import { NextResponse } from 'next/server';
import { copyThumbnail, findRows, getRow, newId, readDb, setRow, updateDb } from '@/lib/db';
import { emptyDoc, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { summarize } from '@/lib/summary';
import { claimTopic, parseAudience, topicConflict } from '@/lib/topics';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** a design only reaches the basket once the customer edited it; older designs count if they were ever saved */
const started = (p: Project) =>
  p.kind !== 'design' || (p.editedAt === undefined ? p.updatedAt > p.createdAt : p.editedAt !== null);

/** Admin: every template plus their own designs. Customer: their own designs. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const [own, templates] = await Promise.all([
    findRows('projects', { ownerId: user.id }),
    user.role === 'admin' ? findRows('projects', { kind: 'template' }) : [],
  ]);
  const byId = new Map([...own, ...templates].map((p) => [p.id, p]));
  const list = [...byId.values()]
    .filter(started)
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json(list);
}

/**
 * - { templateId, fill? }: create the caller's own design as a copy of a template
 *   (customers: published templates only; admins may copy any template to test it).
 *   `fill` (element id -> text) sets the texts of editable fields, as the category page's story wrote them.
 * - { name, width_mm, height_mm, topic?, audience? }: create a new blank template (admin only);
 *   with `audience`, the topic must belong to that door (a new topic is claimed for it).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const now = new Date().toISOString();

  if (typeof body?.templateId === 'string') {
    const t = await getRow('projects', body.templateId);
    if (!t || t.kind !== 'template' || (t.status !== 'published' && user.role !== 'admin')) {
      return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
    }
    const id = newId();
    const copy: Project = {
      id,
      kind: 'design',
      ownerId: user.id,
      templateId: t.id,
      status: 'draft',
      name: t.name,
      canvas: structuredClone(t.canvas),
      thumbnail: await copyThumbnail(t.thumbnail, id),
      createdAt: now,
      updatedAt: now,
      editedAt: null,
    };
    // the story told on a category page: element id -> text, for the design's editable text fields only
    const fill = body.fill && typeof body.fill === 'object' ? (body.fill as Record<string, unknown>) : {};
    for (const e of copy.canvas.elements) {
      const text = fill[e.id];
      if (e.type === 'text' && e.editable && typeof text === 'string') {
        e.text = text.slice(0, 300);
        // it carries the customer's own details: it belongs in their basket right away
        copy.editedAt = now;
      }
    }
    await setRow('projects', copy);
    return NextResponse.json({ id }, { status: 201 });
  }

  if (user.role !== 'admin') return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'תבנית חדשה';
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 60) : '';
  const canvas = validateDoc(emptyDoc(Number(body?.width_mm) || 210, Number(body?.height_mm) || 297));
  if (!canvas) return NextResponse.json({ error: 'מידות לא תקינות' }, { status: 400 });
  const bg = typeof body?.backgroundAssetId === 'string' ? await getRow('images', body.backgroundAssetId) : null;
  if (bg) {
    // fill the page like CSS "cover": scale to the larger side, centred, anything beyond the page is cropped
    const { width_mm: pw, height_mm: ph } = canvas.page;
    const scale = Math.max(pw / bg.width, ph / bg.height);
    const w = bg.width * scale;
    const h = bg.height * scale;
    canvas.elements.push({
      id: newId(),
      type: 'image',
      x_mm: (pw - w) / 2,
      y_mm: (ph - h) / 2,
      w_mm: w,
      h_mm: h,
      rotation: 0,
      z: 0,
      asset_id: bg.id,
      label: 'רקע',
    });
  }
  const audience = parseAudience(body?.audience);
  // fail before the upload work below is wasted (checked again, atomically, when saving)
  if (audience) {
    const why = topicConflict(await readDb(['projects', 'carousel']), topic, audience);
    if (why) return NextResponse.json({ error: why }, { status: 400 });
  }
  const project: Project = {
    id: newId(),
    kind: 'template',
    ownerId: user.id,
    status: 'draft',
    name,
    topic: topic || undefined,
    canvas,
    createdAt: now,
    updatedAt: now,
  };
  const conflict = await updateDb((db) => {
    const why = audience ? topicConflict(db, topic, audience) : null;
    if (why) return why;
    if (audience) claimTopic(db, topic, audience);
    db.projects.push(project);
    return null;
  }, ['projects', 'carousel']);
  if (conflict) return NextResponse.json({ error: conflict }, { status: 400 });
  return NextResponse.json({ id: project.id }, { status: 201 });
}
