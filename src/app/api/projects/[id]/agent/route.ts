import { NextResponse } from 'next/server';
import { findRows, getRow, readDb } from '@/lib/db';
import { formatOfPage } from '@/lib/adFormats';
import { applyCustomerEdits, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { canRead, canWrite } from '@/lib/access';
import { visibleImages } from '@/lib/brand';
import { AGENT_ENABLED } from '@/lib/config';
import { runAgent, type ChatTurn } from '@/lib/agent/run';
import { businessBrief } from '@/lib/businessBrief';
import { customerRules } from '@/lib/customerSave';
import { projectContext } from '@/lib/projectContext';
import type { AgentMode } from '@/lib/agent/tools';
import type { CanvasDoc, Project, User } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 150;

/** What the assistant knows about a business's ad, and what it can reach from it; nothing for a private customer's card. */
async function businessContext(project: Project, user: User) {
  const { topic, audience } = await projectContext(project);
  if (audience !== 'business') return { topic };
  const source = project.kind === 'design' && project.templateId ? await getRow('projects', project.templateId) : project;
  const [kit, items, sizes] = await Promise.all([
    getRow('brands', user.id),
    findRows('catalog', { ownerId: user.id }),
    source?.sizeGroup ? findRows('projects', { kind: 'template', status: 'published', sizeGroup: source.sizeGroup }) : [],
  ]);
  return {
    topic,
    items,
    brief: businessBrief(topic, kit, items),
    sizes: sizes.flatMap((t) => formatOfPage(t.canvas.page.width_mm, t.canvas.page.height_mm)?.id ?? []),
  };
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
  if (user.guest) return NextResponse.json({ error: 'כדי להשתמש בעוזר נרשמים בחינם' }, { status: 401 });
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
  const mode: AgentMode = project.kind !== 'design' ? 'full' : 'customer';
  // the same rules as saving: a customer's copy only takes the changes a customer may make.
  // The editor's canvas may be on a wording or products it hasn't saved yet, so the rules apply to the design as it stands on those.
  const enforce = async (d: unknown): Promise<CanvasDoc | null> => {
    if (mode === 'full') return validateDoc(d);
    const { stored, free } = await customerRules(project, d, user);
    return applyCustomerEdits(stored, d, images, free);
  };
  const base = await enforce(body?.canvas);
  if (!base) return NextResponse.json({ error: 'מסמך העיצוב לא תקין' }, { status: 400 });

  const { free } = mode === 'customer' ? await customerRules(project, base, user) : { free: null };
  const state = { doc: structuredClone(base), mode, images, categories: db.categories, changed: false, free, ...(await businessContext(project, user)) } as Parameters<typeof runAgent>[0];
  try {
    const { reply } = await runAgent(state, message, history);
    const canvas = state.changed ? await enforce(state.doc) : base;
    if (!canvas) return NextResponse.json({ error: 'העוזר יצר עיצוב לא תקין. נסו לנסח אחרת.' }, { status: 422 });
    return NextResponse.json({ canvas, reply, changed: state.changed, openSize: state.openSize });
  } catch (e) {
    console.error('agent failed', e);
    return NextResponse.json({ error: 'העוזר לא הצליח להשלים את הבקשה. נסו שוב.' }, { status: 502 });
  }
}
