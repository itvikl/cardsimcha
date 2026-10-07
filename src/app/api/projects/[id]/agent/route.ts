import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';
import { applyCustomerEdits, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { canRead, canWrite } from '@/lib/access';
import { AGENT_ENABLED } from '@/lib/config';
import { runAgent, type ChatTurn } from '@/lib/agent/run';
import type { AgentMode } from '@/lib/agent/tools';
import type { CanvasDoc } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;

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

  const db = await readDb();
  const project = db.projects.find((p) => p.id === id);
  if (!project || !canRead(user, project) || !canWrite(user, project)) {
    return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  }

  const mode: AgentMode = project.kind === 'template' ? 'full' : 'customer';
  // the same rules as saving: a customer's copy only takes the changes a customer may make
  const enforce = (d: unknown): CanvasDoc | null =>
    mode === 'full' ? validateDoc(d) : applyCustomerEdits(project.canvas, d, db.images);
  const base = enforce(body?.canvas);
  if (!base) return NextResponse.json({ error: 'מסמך העיצוב לא תקין' }, { status: 400 });

  const state = { doc: structuredClone(base), mode, images: db.images, categories: db.categories, changed: false };
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
