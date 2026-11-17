import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { emptyBrand, parseBrand } from '@/lib/brand';
import { qrFor } from '@/lib/brandQr';
import { getRow, setRow } from '@/lib/db';
import type { BrandKit } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The caller's brand kit, or null before they made one. A kit's id is its owner's, so nobody can reach another's. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return NextResponse.json(await getRow('brands', user.id));
}

/** Saves the kit's details and colours, and makes its QR code; the logo has its own route. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const fields = parseBrand(await req.json().catch(() => null));
  if (typeof fields === 'string') return NextResponse.json({ error: fields }, { status: 400 });
  const { qrTarget, ...details } = fields;
  const { qr: oldQr, ...rest }: BrandKit = { ...((await getRow('brands', user.id)) ?? emptyBrand(user.id)), ...details, updatedAt: new Date().toISOString() };
  // a save that doesn't speak of the QR (details tried on a gallery page) leaves it as it is
  const qr = await qrFor({ ...rest, qr: oldQr }, qrTarget === undefined ? oldQr?.target ?? null : qrTarget);
  const kit: BrandKit = qr ? { ...rest, qr } : rest;
  await setRow('brands', kit);
  return NextResponse.json(kit);
}
