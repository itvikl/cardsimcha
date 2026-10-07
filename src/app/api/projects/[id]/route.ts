import { NextResponse } from 'next/server';
import { readDb, updateDb } from '@/lib/db';
import { applyCustomerEdits, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import type { Project, User } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

const MAX_THUMB = 700_000;
const validThumb = (t: unknown): t is string =>
  typeof t === 'string' && t.length <= MAX_THUMB && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(t);

/** Admins manage templates; everyone manages their own designs. */
const canWrite = (u: User, p: Project) => (p.kind === 'template' ? u.role === 'admin' : p.ownerId === u.id);
const canRead = (u: User, p: Project) =>
  canWrite(u, p) || (p.kind === 'template' && p.status === 'published') || u.role === 'admin';

export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const db = await readDb();
  const project = db.projects.find((p) => p.id === id);
  if (!project || !canRead(user, project)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  // `canEdit` tells the editor which mode to open in; the server enforces it again on save.
  return NextResponse.json({ ...project, canManage: canWrite(user, project) && project.kind === 'template' });
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : undefined;
  if (name === '') return NextResponse.json({ error: 'שם חובה' }, { status: 400 });
  const thumbnail = body?.thumbnail === undefined ? undefined : validThumb(body.thumbnail) ? body.thumbnail : null;
  const status = body?.status === 'draft' || body?.status === 'published' ? body.status : undefined;

  type Result = 'missing' | 'invalid' | { id: string; updatedAt: string };
  const result = await updateDb<Result>((db) => {
    const p = db.projects.find((x) => x.id === id);
    if (!p || !canWrite(user, p)) return 'missing';

    if (body?.canvas !== undefined) {
      // admin editing a template: full control. A customer's design: text of editable fields only.
      const next = p.kind === 'template' ? validateDoc(body.canvas) : applyCustomerEdits(p.canvas, body.canvas, db.images);
      if (!next) return 'invalid';
      p.canvas = next;
    }
    if (name) p.name = name;
    if (thumbnail) p.thumbnail = thumbnail;
    if (status && p.kind === 'template') p.status = status;
    p.updatedAt = new Date().toISOString();
    return { id: p.id, updatedAt: p.updatedAt };
  });
  if (result === 'missing') return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  if (result === 'invalid') return NextResponse.json({ error: 'מסמך העיצוב לא תקין' }, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const found = await updateDb((db) => {
    const p = db.projects.find((x) => x.id === id);
    if (!p || !canWrite(user, p)) return false;
    db.projects = db.projects.filter((x) => x.id !== id);
    return true;
  });
  if (!found) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
