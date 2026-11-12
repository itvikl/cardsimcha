import { requireUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { listCategories, listImages } from '@/lib/data/library';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const [categories, images] = await Promise.all([listCategories(), listImages()]);
  return NextResponse.json({ categories, images });
}
