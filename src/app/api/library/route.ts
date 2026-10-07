import { requireUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { readDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const db = await readDb();
  return NextResponse.json({ categories: db.categories, images: db.images });
}
