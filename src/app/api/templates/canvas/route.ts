import { NextResponse } from 'next/server';
import { findRows, getRows } from '@/lib/db';
import { GENERAL_TOPIC } from '@/lib/categories';
import type { CanvasElement } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The published designs of one category with their canvas, so the category page can draw each of them with the
 * business's or the event's details. Public like the gallery: a signed-in customer gets the same canvas
 * anyway when they open a copy. Image elements carry `src`, the URL of their picture, so no library access is needed.
 */
export async function GET(req: Request) {
  const topic = new URL(req.url).searchParams.get('topic')?.trim();
  if (!topic) return NextResponse.json({ error: 'חסרה קטגוריה' }, { status: 400 });
  const published = (await findRows('projects', { kind: 'template', status: 'published' })).filter((p) => (p.topic || GENERAL_TOPIC) === topic);
  const ids = published.flatMap((p) => p.canvas.elements.flatMap((e) => (e.type === 'image' ? [e.asset_id] : [])));
  const files = new Map((await getRows('images', [...new Set(ids)])).map((i) => [i.id, i.file]));
  const withSrc = (e: CanvasElement) => (e.type === 'image' ? { ...e, src: files.has(e.asset_id) ? `/api/uploads/${files.get(e.asset_id)}` : null } : e);
  return NextResponse.json(
    published
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({ id: p.id, name: p.name, price: p.price ?? null, series: p.series ?? null, thumbnail: p.thumbnail ?? null, canvas: { ...p.canvas, elements: p.canvas.elements.map(withSrc) } })),
  );
}
