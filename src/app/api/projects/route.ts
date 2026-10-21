import { NextResponse } from 'next/server';
import { newId, readDb, updateDb } from '@/lib/db';
import { emptyDoc, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { summarize } from '@/lib/summary';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** Admin: every template plus their own designs. Customer: their own designs. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const db = await readDb();
  const list = db.projects
    .filter((p) => (user.role === 'admin' ? p.kind === 'template' || p.ownerId === user.id : p.ownerId === user.id))
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json(list);
}

/**
 * - { templateId, prefill? }: create the caller's own design as a copy of a template
 *   (customers: published templates only; admins may copy any template to test it).
 *   `prefill` only fills an editable text field whose label mentions a name.
 * - { name, width_mm, height_mm }: create a new blank template (admin only).
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const now = new Date().toISOString();

  if (typeof body?.templateId === 'string') {
    const created = await updateDb((db) => {
      const t = db.projects.find((p) => p.id === body.templateId && p.kind === 'template');
      if (!t || (t.status !== 'published' && user.role !== 'admin')) return null;
      const copy: Project = {
        id: newId(),
        kind: 'design',
        ownerId: user.id,
        templateId: t.id,
        status: 'draft',
        name: t.name,
        canvas: structuredClone(t.canvas),
        thumbnail: t.thumbnail,
        createdAt: now,
        updatedAt: now,
      };
      // the name typed on the home page goes into the first editable field labelled as a name
      const prefill = typeof body.prefill === 'string' ? body.prefill.trim().slice(0, 80) : '';
      const field = prefill
        ? copy.canvas.elements.find((e) => e.type === 'text' && e.editable && (e.label ?? '').includes('שם'))
        : undefined;
      if (field?.type === 'text') field.text = prefill;
      db.projects.push(copy);
      return copy;
    });
    if (!created) return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
    return NextResponse.json({ id: created.id }, { status: 201 });
  }

  if (user.role !== 'admin') return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'תבנית חדשה';
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 60) : '';
  const canvas = validateDoc(emptyDoc(Number(body?.width_mm) || 210, Number(body?.height_mm) || 297));
  if (!canvas) return NextResponse.json({ error: 'מידות לא תקינות' }, { status: 400 });
  const db = await readDb();
  const bg = typeof body?.backgroundAssetId === 'string' ? db.images.find((i) => i.id === body.backgroundAssetId) : undefined;
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
  await updateDb((db) => void db.projects.push(project));
  return NextResponse.json({ id: project.id }, { status: 201 });
}
