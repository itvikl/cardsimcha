import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { assetPlaces, setAssetPlaces } from '@/lib/data/tree';

export const dynamic = 'force-dynamic';

const strings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, max) : null;

/** where every library image is filed in the tree: `{ [assetId]: topicIds }` (admin) */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  return NextResponse.json(await assetPlaces());
}

/**
 * Files library images (backgrounds): `{ assetIds, topicIds }`, or `{ assetId, topicIds }` for
 * one. Each image's places are replaced by `topicIds`.
 */
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const assetIds = strings(body?.assetIds, 500) ?? (typeof body?.assetId === 'string' ? [body.assetId] : null);
  const topicIds = strings(body?.topicIds, 50);
  if (!assetIds?.length || !topicIds) return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  const r = await setAssetPlaces(assetIds, topicIds);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
