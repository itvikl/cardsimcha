import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { billingProvider } from '@/lib/billing';
import { BILLING_ENABLED, SUBSCRIPTION_PRICE } from '@/lib/config';
import { getRow, updateRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** The caller's plan, for the billing page. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const subscription = BILLING_ENABLED ? await getRow('subscriptions', user.id) : null;
  return NextResponse.json({ enabled: BILLING_ENABLED, subscriptionPrice: SUBSCRIPTION_PRICE, subscription });
}

/** Cancels renewal; what was already paid for stays open until the period ends. */
export async function DELETE() {
  if (!BILLING_ENABLED) return NextResponse.json({ error: 'התשלום עוד לא פעיל' }, { status: 503 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const sub = await getRow('subscriptions', user.id);
  if (!sub) return NextResponse.json({ error: 'אין מנוי פעיל' }, { status: 404 });
  await billingProvider().cancelSubscription(sub.providerRef);
  const updated = await updateRow('subscriptions', user.id, (row) => {
    if (!row) return { result: null, write: false };
    row.status = 'canceled';
    row.updatedAt = new Date().toISOString();
    return { result: row, write: true };
  });
  return NextResponse.json(updated);
}
