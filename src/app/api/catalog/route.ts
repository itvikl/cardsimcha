import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { findRows, newId, setRow } from '@/lib/db';
import { parseCatalogFields } from '@/lib/catalog';
import { saveUserImage } from '@/lib/imageUpload';
import type { CatalogItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 100;

/** The caller's own catalog. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const items = await findRows('catalog', { ownerId: user.id });
  return NextResponse.json(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

/** A new item: a form with name, details, price, and optionally file, width and height. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const form = await req.formData().catch(() => null);
  const fields = parseCatalogFields(form);
  if (typeof fields === 'string') return NextResponse.json({ error: fields }, { status: 400 });
  if ((await findRows('catalog', { ownerId: user.id })).length >= MAX_ITEMS) {
    return NextResponse.json({ error: `אפשר לשמור עד ${MAX_ITEMS} פריטים בקטלוג` }, { status: 400 });
  }
  const photo = form?.get('file') instanceof File ? await saveUserImage(form, user.id, fields.name) : undefined;
  if (typeof photo === 'string') return NextResponse.json({ error: photo }, { status: 400 });
  const now = new Date().toISOString();
  const item: CatalogItem = { id: newId(), ownerId: user.id, ...fields, ...(photo ? { photo } : {}), createdAt: now, updatedAt: now };
  await setRow('catalog', item);
  return NextResponse.json(item, { status: 201 });
}
