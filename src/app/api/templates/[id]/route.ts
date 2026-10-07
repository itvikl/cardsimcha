import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** Public preview of one published template (no canvas data, only what the page needs). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await readDb();
  const p = db.projects.find((x) => x.id === id && x.kind === 'template' && x.status === 'published');
  if (!p) return NextResponse.json({ error: 'הכרטיס לא נמצא' }, { status: 404 });
  return NextResponse.json({
    id: p.id,
    name: p.name,
    width_mm: p.canvas.page.width_mm,
    height_mm: p.canvas.page.height_mm,
    thumbnail: p.thumbnail ?? null,
    canSwapBackground: p.canvas.elements.some((e) => e.type === 'image' && e.swappable),
    fields: p.canvas.elements.filter((e) => e.type === 'text' && e.editable).map((e) => (e.type === 'text' ? e.label || 'טקסט' : '')),
  });
}
