import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { settlePurchase } from '@/lib/billing';
import { BILLING_ENABLED, BILLING_PROVIDER } from '@/lib/config';
import { getRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

const available = () => BILLING_ENABLED && BILLING_PROVIDER === 'sandbox';

/** What the sandbox's payment page shows. */
export async function GET(req: Request) {
  if (!available()) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const purchase = await getRow('purchases', new URL(req.url).searchParams.get('purchase') ?? '');
  if (!purchase || purchase.userId !== user.id) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json(purchase);
}

/** The sandbox's answer in place of a provider's webhook: { purchase, outcome }. No money moves. */
export async function POST(req: Request) {
  if (!available()) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const outcome = body?.outcome;
  if (outcome !== 'paid' && outcome !== 'failed' && outcome !== 'canceled') return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  const purchase = typeof body?.purchase === 'string' ? await getRow('purchases', body.purchase) : null;
  if (!purchase || purchase.userId !== user.id) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  return NextResponse.json(await settlePurchase(purchase.id, outcome));
}
