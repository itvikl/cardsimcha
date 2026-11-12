import { NextResponse } from 'next/server';
import { applyEdits } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { canRead, canWrite } from '@/lib/access';
import { AGENT_ENABLED } from '@/lib/config';
import { parseAudience } from '@/lib/topics';
import { listImages } from '@/lib/data/library';
import { deleteProject, getProject, updateProject, type ProjectPatch } from '@/lib/data/projects';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

const MAX_THUMB = 700_000;
const THUMB = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

/** the editor sends the thumbnail as a data URL; it is stored as a file */
function parseThumb(t: unknown): ProjectPatch['thumbnail'] | null {
  if (typeof t !== 'string' || t.length > MAX_THUMB) return null;
  const m = THUMB.exec(t);
  return m ? { data: Buffer.from(m[2], 'base64'), ext: m[1] === 'png' ? 'png' : 'jpg' } : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const project = await getProject(id);
  if (!project || !canRead(user, project)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  // `canEdit` tells the editor which mode to open in; the server enforces it again on save.
  return NextResponse.json({
    ...project,
    canManage: canWrite(user, project) && project.kind === 'template',
    canAgent: AGENT_ENABLED && canWrite(user, project),
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : undefined;
  if (name === '') return NextResponse.json({ error: 'שם חובה' }, { status: 400 });

  const patch: ProjectPatch = {
    name,
    thumbnail: body?.thumbnail === undefined ? undefined : (parseThumb(body.thumbnail) ?? undefined),
    status: body?.status === 'draft' || body?.status === 'published' ? body.status : undefined,
    topic: typeof body?.topic === 'string' ? body.topic.trim().slice(0, 60) : undefined,
    audience: parseAudience(body?.audience),
  };
  if (body?.canvas !== undefined) {
    // a customer's design takes only the changes a customer may make; that needs the image library
    const images = await listImages();
    // admin editing a template: full control. A customer's design: what each element's locks allow.
    patch.canvas = (p) => applyEdits(p.canvas, body.canvas, p.kind === 'template' ? 'author' : 'customer', images);
  }

  const result = await updateProject(user, id, patch);
  if (result === 'missing') return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  if (result === 'invalid') return NextResponse.json({ error: 'מסמך העיצוב לא תקין' }, { status: 400 });
  if ('conflict' in result) return NextResponse.json({ error: result.conflict }, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!(await deleteProject(user, id))) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
