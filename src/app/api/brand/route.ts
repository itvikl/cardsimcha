import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { emptyBrand, parseBrand } from '@/lib/brand';
import { getRow, setRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** The caller's brand kit, or null before they made one. A kit's id is its owner's, so nobody can reach another's. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return NextResponse.json(await getRow('brands', user.id));
}

/** Saves the kit's details and colours; the logo has its own route. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const fields = parseBrand(await req.json().catch(() => null));
  if (typeof fields === 'string') return NextResponse.json({ error: fields }, { status: 400 });
  const kit = { ...((await getRow('brands', user.id)) ?? emptyBrand(user.id)), ...fields, updatedAt: new Date().toISOString() };
  await setRow('brands', kit);
  return NextResponse.json(kit);
}
