import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Published templates. Public on purpose: this is the gallery visitors see before signing up. */
export async function GET() {
  const db = await readDb();
  const list = db.projects
    .filter((p) => p.kind === 'template' && p.status === 'published')
    .map((p) => ({
      id: p.id,
      name: p.name,
      width_mm: p.canvas.page.width_mm,
      height_mm: p.canvas.page.height_mm,
      thumbnail: p.thumbnail ?? null,
      updatedAt: p.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json(list);
}
