import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { findRows } from '@/lib/db';
import { wordingTexts, type Wording } from '@/lib/wording';

export const dynamic = 'force-dynamic';

/** The wordings a card can take: its topic and page size, published ones only (an admin also sees drafts, to try them). */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const q = new URL(req.url).searchParams;
  const topic = q.get('topic')?.trim();
  const width = Number(q.get('width'));
  const height = Number(q.get('height'));
  if (!topic || !width || !height) return NextResponse.json({ error: 'חסרים פרטי הכרטיס' }, { status: 400 });
  const rows = await findRows('projects', { kind: 'wording', topic });
  const list: Wording[] = rows
    .filter((w) => (w.status === 'published' || user.role === 'admin') && w.canvas.page.width_mm === width && w.canvas.page.height_mm === height)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    .map((w) => ({ id: w.id, name: w.name, elements: wordingTexts(w.canvas) }));
  return NextResponse.json(list);
}
