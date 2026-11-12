import { BILLING_PROVIDER } from './config';
import { getRow, setRow, updateRow } from './db';
import type { Purchase } from './types';

/**
 * Payment goes through one provider, chosen with BILLING_PROVIDER. Only the sandbox exists so far: it charges
 * nothing and is refused in production (see config.ts). To connect a real Israeli provider, add its object here:
 * `checkoutUrl` opens its hosted payment page, and its webhook route verifies the provider's signature and then calls
 * `settlePurchase`. Card details never reach this site.
 */
export type BillingProvider = {
  checkoutUrl: (purchase: Purchase, siteUrl: string) => Promise<string>;
  /** stops future charges; called before the subscription is marked cancelled */
  cancelSubscription: (providerRef: string) => Promise<void>;
};

const sandbox: BillingProvider = {
  checkoutUrl: async (purchase, siteUrl) => `${siteUrl}/billing/sandbox?purchase=${purchase.id}`,
  cancelSubscription: async () => {},
};

const PROVIDERS: Record<string, BillingProvider> = { sandbox };

export const billingProvider = (): BillingProvider => {
  const p = PROVIDERS[BILLING_PROVIDER];
  if (!p) throw new Error(`unknown billing provider: ${BILLING_PROVIDER}`);
  return p;
};

const addMonth = (from: Date) => {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
};

/**
 * Records a payment's outcome. Only a pending purchase changes, in a transaction, so a provider repeating its
 * webhook can't grant a subscription period twice; returns the purchase as it now stands.
 */
export async function settlePurchase(id: string, outcome: 'paid' | 'failed' | 'canceled', providerRef?: string): Promise<Purchase | null> {
  const { purchase, settled } = await updateRow('purchases', id, (row) => {
    if (!row || row.status !== 'pending') return { result: { purchase: row, settled: false }, write: false };
    row.status = outcome;
    row.settledAt = new Date().toISOString();
    if (providerRef) row.providerRef = providerRef;
    return { result: { purchase: row, settled: true }, write: true };
  });
  if (settled && purchase && outcome === 'paid' && purchase.kind === 'subscription') {
    const old = await getRow('subscriptions', purchase.userId);
    // paying again before the period ended adds a month after it, so no paid time is lost
    const base = old && old.currentPeriodEnd > new Date().toISOString() ? new Date(old.currentPeriodEnd) : new Date();
    await setRow('subscriptions', {
      id: purchase.userId,
      status: 'active',
      currentPeriodEnd: addMonth(base),
      provider: purchase.provider,
      providerRef: purchase.providerRef ?? purchase.id,
      updatedAt: new Date().toISOString(),
    });
  }
  return purchase;
}
