import { requireUser } from '@/lib/auth';
import { visibleImages } from '@/lib/brand';
import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const db = await readDb(['categories', 'images']);
  return NextResponse.json({ categories: db.categories, images: visibleImages(db.images, auth.id) });
}
