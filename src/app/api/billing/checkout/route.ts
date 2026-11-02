import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { billingProvider } from '@/lib/billing';
import { BILLING_ENABLED, BILLING_PROVIDER, SUBSCRIPTION_PRICE } from '@/lib/config';
import { getRow, newId, setRow } from '@/lib/db';
import { entitlement, seriesPrice } from '@/lib/entitlement';
import type { Purchase } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Starts a payment: { kind: 'ad', projectId } | { kind: 'series', projectId } | { kind: 'subscription' }.
 * The amount is always worked out here, from the template's price; nothing about it comes from the client.
 */
export async function POST(req: Request) {
  if (!BILLING_ENABLED) return NextResponse.json({ error: 'התשלום עוד לא פעיל' }, { status: 503 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const kind = body?.kind;

  const purchase: Purchase = {
    id: newId(),
    userId: user.id,
    kind,
    amount: SUBSCRIPTION_PRICE,
    status: 'pending',
    provider: BILLING_PROVIDER,
    createdAt: new Date().toISOString(),
  };
  if (kind === 'ad' || kind === 'series') {
    const project = typeof body?.projectId === 'string' ? await getRow('projects', body.projectId) : null;
    if (!project || project.kind !== 'design' || project.ownerId !== user.id) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
    const e = await entitlement(user, project);
    if (e.allowed) return NextResponse.json({ error: 'העיצוב הזה כבר פתוח להורדה' }, { status: 409 });
    if (kind === 'series') {
      if (!project.seriesRun) return NextResponse.json({ error: 'העיצוב לא שייך לסדרה' }, { status: 400 });
      purchase.seriesRun = project.seriesRun;
      purchase.amount = await seriesPrice(user.id, project.seriesRun);
    } else {
      purchase.projectId = project.id;
      purchase.amount = e.price;
    }
  } else if (kind !== 'subscription') {
    return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  }
  await setRow('purchases', purchase);
  const url = await billingProvider().checkoutUrl(purchase, new URL(req.url).origin);
  return NextResponse.json({ url }, { status: 201 });
}
