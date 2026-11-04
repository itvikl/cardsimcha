import { NextResponse } from 'next/server';
import { findRows } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Published templates. Public on purpose: this is the gallery visitors see before signing up. */
export async function GET() {
  const published = await findRows('projects', { kind: 'template', status: 'published' });
  const list = published
    .map((p) => ({
      id: p.id,
      name: p.name,
      topic: p.topic ?? null,
      price: p.price ?? null,
      series: p.series ?? null,
      sizeGroup: p.sizeGroup ?? null,
      width_mm: p.canvas.page.width_mm,
      height_mm: p.canvas.page.height_mm,
      thumbnail: p.thumbnail ?? null,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json(list);
}
