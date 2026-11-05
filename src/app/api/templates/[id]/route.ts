import { NextResponse } from 'next/server';
import { getPublishedTemplate } from '@/lib/data/projects';
import { allElements } from '@/lib/canvas';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/** Public preview of one published template (no canvas data, only what the page needs). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const p = await getPublishedTemplate(id);
  if (!p) return NextResponse.json({ error: 'הכרטיס לא נמצא' }, { status: 404 });
  return NextResponse.json({
    id: p.id,
    name: p.name,
    width_mm: p.canvas.page.width_mm,
    height_mm: p.canvas.page.height_mm,
    thumbnail: p.thumbnail ?? null,
    canSwapBackground: p.canvas.layers.background.locks.content || allElements(p.canvas).some((e) => e.type === 'image' && e.locks.content),
    fields: allElements(p.canvas).filter((e) => e.type === 'text' && e.locks.content).map((e) => e.field?.label || 'טקסט'),
  });
}
