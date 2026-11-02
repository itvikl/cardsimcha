import { NextResponse } from 'next/server';
import { deleteRow, getRow, getRows, removeThumbnail, thumbnailFile, updateDb, updateRow } from '@/lib/db';
import { applyCustomerEdits, sentAssetIds, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { canRead, canWrite } from '@/lib/access';
import { visibleImages } from '@/lib/brand';
import { AGENT_ENABLED } from '@/lib/config';
import { BILLING_ENABLED } from '@/lib/config';
import { entitlement } from '@/lib/entitlement';
import { projectContext } from '@/lib/projectContext';
import { isLoopId } from '@/lib/shabbatLoops';
import { parsePrice } from '@/lib/price';
import { claimTopic, parseAudience, topicConflict } from '@/lib/topics';
import type { ImageAsset, Project } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

const MAX_THUMB = 700_000;
const validThumb = (t: unknown): t is string =>
  typeof t === 'string' && t.length <= MAX_THUMB && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(t);

/** JSON with object keys sorted: applyCustomerEdits may rebuild an element with its keys in another order */
const sameKeys = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x
  );

export async function GET(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const project = await getRow('projects', id);
  if (!project || !canRead(user, project)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  // `canEdit` tells the editor which mode to open in; the server enforces it again on save.
  return NextResponse.json({
    ...project,
    canManage: canWrite(user, project) && project.kind === 'template',
    canAgent: AGENT_ENABLED && canWrite(user, project),
    ...(await projectContext(project)),
    billing: BILLING_ENABLED ? await entitlement(user, project) : { allowed: true },
    // the times written in a Shabbat design are for that Friday only
    shabbatOutOfDate: !!project.shabbatFor && project.shabbatFor < new Date().toISOString().slice(0, 10),
    hasVideo: project.canvas.elements.some((e) => e.type === 'image' && isLoopId(e.loopId)),
  });
}

/**
 * Autosave and other edits. Only this project's record is read and written (in a transaction);
 * a topic change looks across templates and the carousel, so only that one loads them.
 */
export async function PUT(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : undefined;
  if (name === '') return NextResponse.json({ error: 'שם חובה' }, { status: 400 });
  const thumb = validThumb(body?.thumbnail) ? thumbnailFile(id, body.thumbnail) : null;
  const status = body?.status === 'draft' || body?.status === 'published' ? body.status : undefined;
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 60) : undefined;
  const audience = parseAudience(body?.audience);
  const series = typeof body?.series === 'string' ? body.series.trim().slice(0, 60) : undefined;
  const price = body?.price === undefined ? undefined : parsePrice(body.price);
  if (price === 'invalid') return NextResponse.json({ error: 'מחיר לא תקין' }, { status: 400 });
  // a customer may only swap to library images; load just the ones the canvas points at
  const assets: ImageAsset[] = body?.canvas !== undefined ? visibleImages(await getRows('images', sentAssetIds(body.canvas)), user.id) : [];

  type Result = 'missing' | 'invalid' | { conflict: string } | { id: string; updatedAt: string; oldThumb?: string };
  /** Applies the request to `p` in place. */
  const apply = async (p: Project): Promise<Result> => {
    const before = sameKeys(p.canvas);
    const oldName = p.name;
    if (body?.canvas !== undefined) {
      // admin editing a template: full control. A customer's design: text of editable fields only.
      const next = p.kind === 'template' ? validateDoc(body.canvas) : applyCustomerEdits(p.canvas, body.canvas, assets);
      if (!next) return 'invalid';
      p.canvas = next;
    }
    if (name) p.name = name;
    // a save that only adds the preview image (the editor does that on first open) is not an edit
    if (p.kind === 'design' && !p.editedAt && (p.name !== oldName || sameKeys(p.canvas) !== before)) {
      p.editedAt = new Date().toISOString();
    }
    let oldThumb: string | undefined;
    if (thumb && p.thumbnail !== thumb.url) {
      await thumb.save();
      oldThumb = p.thumbnail;
      p.thumbnail = thumb.url;
    }
    if (status && p.kind === 'template') p.status = status;
    if (price !== undefined && p.kind === 'template') p.price = price ?? undefined;
    if (series !== undefined && p.kind === 'template') p.series = series || undefined;
    p.updatedAt = new Date().toISOString();
    return { id: p.id, updatedAt: p.updatedAt, oldThumb };
  };

  let result: Result;
  if (topic === undefined) {
    result = await updateRow('projects', id, async (p) => {
      if (!p || !canWrite(user, p)) return { result: 'missing', write: false };
      const r = await apply(p);
      return { result: r, write: typeof r === 'object' };
    });
  } else {
    result = await updateDb<Result>(
      async (db) => {
        const p = db.projects.find((x) => x.id === id);
        if (!p || !canWrite(user, p)) return 'missing';
        // checked before anything changes: a template only takes a topic of the admin's current door
        if (p.kind === 'template' && audience) {
          const why = topicConflict(db, topic, audience);
          if (why) return { conflict: why };
        }
        const r = await apply(p);
        if (typeof r === 'object' && p.kind === 'template') {
          p.topic = topic || undefined;
          if (audience) claimTopic(db, topic, audience);
        }
        return r;
      },
      ['projects', 'carousel'],
    );
  }
  if (result === 'missing') return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  if (result === 'invalid') return NextResponse.json({ error: 'מסמך העיצוב לא תקין' }, { status: 400 });
  if ('conflict' in result) return NextResponse.json({ error: result.conflict }, { status: 400 });
  const { oldThumb, ...saved } = result;
  await removeThumbnail(id, oldThumb).catch((e) => console.error('could not remove old thumbnail', e));
  return NextResponse.json(saved);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const p = await getRow('projects', id);
  if (!p || !canWrite(user, p)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await deleteRow('projects', id);
  await removeThumbnail(id, p.thumbnail).catch((e) => console.error('could not remove thumbnail', e));
  return NextResponse.json({ ok: true });
}
