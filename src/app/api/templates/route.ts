import { NextResponse } from 'next/server';
import { listPublishedTemplates } from '@/lib/data/projects';

export const dynamic = 'force-dynamic';

/** Published templates. Public on purpose: this is the gallery visitors see before signing up. */
export async function GET() {
  const list = (await listPublishedTemplates()).map((p) => ({
      id: p.id,
      name: p.name,
      topic: p.topic ?? null,
      width_mm: p.canvas.page.width_mm,
      height_mm: p.canvas.page.height_mm,
      thumbnail: p.thumbnail ?? null,
      updatedAt: p.updatedAt,
    }));
  return NextResponse.json(list);
}
