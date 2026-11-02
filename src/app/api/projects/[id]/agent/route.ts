import { NextResponse } from 'next/server';
import { getRow, readDb } from '@/lib/db';
import { applyCustomerEdits, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { canRead, canWrite } from '@/lib/access';
import { visibleImages } from '@/lib/brand';
import { AGENT_ENABLED } from '@/lib/config';
import { runAgent, type ChatTurn } from '@/lib/agent/run';
import { projectContext } from '@/lib/projectContext';
import { professionOf } from '@/lib/professions';
import type { AgentMode } from '@/lib/agent/tools';
import type { CanvasDoc, Project } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;

/** What the assistant knows about a business's ad: the profession's worries and offers, and the business's own details. */
async function businessBrief(project: Project, userId: string): Promise<string | undefined> {
  const { topic, audience } = await projectContext(project);
  if (audience !== 'business') return undefined;
  const p = professionOf(topic);
  const kit = await getRow('brands', userId);
  return [
    `Category: ${topic ?? 'general'}.`,
    p && `The advertiser: ${p.who}.\nWhat their customers worry about: ${p.pains.join('; ')}.\nWhat they can offer: ${p.offers.join('; ')}.\nNever claim: ${p.avoid}`,
    kit?.businessName && `The business: ${kit.businessName}${kit.slogan ? `, slogan: ${kit.slogan}` : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * One agent turn over the editor's current (possibly unsaved) canvas. Returns the new canvas
 * without saving it: the editor commits it (so undo works) and autosave stores it, which
 * enforces the same rules again.
 */
export async function POST(req: Request, { params }: Ctx) {
  if (!AGENT_ENABLED) return NextResponse.json({ error: 'העוזר כבוי' }, { status: 503 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  if (!message) return NextResponse.json({ error: 'כתבו מה לעשות' }, { status: 400 });
  const history: ChatTurn[] = (Array.isArray(body?.history) ? body.history : [])
    .filter((t: ChatTurn) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string')
    .slice(-10)
    .map((t: ChatTurn) => ({ role: t.role, text: t.text.slice(0, 1000) }));

  const project = await getRow('projects', id);
  if (!project || !canRead(user, project) || !canWrite(user, project)) {
    return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  }

  // the assistant picks from the whole library, so it needs every category and image (but other businesses' logos)
  const db = await readDb(['categories', 'images']);
  const images = visibleImages(db.images, user.id);
  const mode: AgentMode = project.kind === 'template' ? 'full' : 'customer';
  // the same rules as saving: a customer's copy only takes the changes a customer may make
  const enforce = (d: unknown): CanvasDoc | null =>
    mode === 'full' ? validateDoc(d) : applyCustomerEdits(project.canvas, d, images);
  const base = enforce(body?.canvas);
  if (!base) return NextResponse.json({ error: 'מסמך העיצוב לא תקין' }, { status: 400 });

  const state = { doc: structuredClone(base), mode, images, categories: db.categories, changed: false, brief: await businessBrief(project, user.id) };
  try {
    const { reply } = await runAgent(state, message, history);
    const canvas = state.changed ? enforce(state.doc) : base;
    if (!canvas) return NextResponse.json({ error: 'העוזר יצר עיצוב לא תקין. נסו לנסח אחרת.' }, { status: 422 });
    return NextResponse.json({ canvas, reply, changed: state.changed });
  } catch (e) {
    console.error('agent failed', e);
    return NextResponse.json({ error: 'העוזר לא הצליח להשלים את הבקשה. נסו שוב.' }, { status: 502 });
  }
}
