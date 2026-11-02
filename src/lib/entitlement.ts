import { BILLING_ENABLED, SUBSCRIPTION_PRICE } from './config';
import { findRows, getRow } from './db';
import type { Project, User } from './types';

/** A subscription counts until its paid period ends, even after it was cancelled. */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  if (!BILLING_ENABLED) return false;
  const sub = await getRow('subscriptions', userId);
  return !!sub && sub.currentPeriodEnd > new Date().toISOString();
}

export type Entitlement = { allowed: true } | { allowed: false; price: number; seriesPrice: number | null; subscriptionPrice: number };

/** What it costs to take this design away; while billing is off, everything is free to download. */
export async function entitlement(user: User, p: Project): Promise<Entitlement> {
  if (!BILLING_ENABLED || user.role === 'admin') return { allowed: true };
  if (p.kind === 'template') return { allowed: false, price: 0, seriesPrice: null, subscriptionPrice: SUBSCRIPTION_PRICE };
  const template = p.templateId ? await getRow('projects', p.templateId) : null;
  const price = template?.price ?? 0;
  if (price === 0) return { allowed: true };
  if (await hasActiveSubscription(user.id)) return { allowed: true };
  const paid = await findRows('purchases', { userId: user.id, status: 'paid' });
  if (paid.some((b) => b.projectId === p.id || (p.seriesRun && b.seriesRun === p.seriesRun))) return { allowed: true };
  return { allowed: false, price, seriesPrice: p.seriesRun ? await seriesPrice(user.id, p.seriesRun) : null, subscriptionPrice: SUBSCRIPTION_PRICE };
}

/** A series run is paid for once: the sum of the prices of its designs' templates. */
export async function seriesPrice(userId: string, seriesRun: string): Promise<number> {
  const designs = await findRows('projects', { ownerId: userId, seriesRun });
  const ids = designs.flatMap((d) => (d.templateId ? [d.templateId] : []));
  const templates = await Promise.all(ids.map((id) => getRow('projects', id)));
  return templates.reduce((sum, t) => sum + (t?.price ?? 0), 0);
}
