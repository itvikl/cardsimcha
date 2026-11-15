import { applyCustomerEdits, CUSTOMER_FONTS, type FreeEdits } from './canvas';
import { findRows, getRows } from './db';
import { applyProducts, hasProducts, MAX_PRODUCTS } from './products';
import { projectContext } from './projectContext';
import { withSentLooks } from './looks';
import type { CanvasDoc, ImageAsset, Project, User } from './types';

/** The fonts a business chooses from: the short built-in list, and those an admin offers it. */
export async function customerFonts(): Promise<string[]> {
  const uploaded = await findRows('fonts', { customer: true });
  return [...CUSTOMER_FONTS, ...uploaded.map((f) => f.family)];
}

/** The design with the products the client chose on it. Their names, prices and pictures come from the owner's catalog, never from the client. */
async function withSentProducts(base: CanvasDoc, incoming: unknown, user: User): Promise<CanvasDoc> {
  const sent = (incoming as CanvasDoc | null)?.productIds;
  if (!hasProducts(base) || !Array.isArray(sent) || sent.some((i) => typeof i !== 'string')) return base;
  const ids = sent.slice(0, MAX_PRODUCTS);
  if (JSON.stringify(ids) === JSON.stringify(base.productIds)) return base;
  const found = new Map((await getRows('catalog', ids)).filter((i) => i.ownerId === user.id).map((i) => [i.id, i]));
  return applyProducts(base, ids.flatMap((i) => found.get(i) ?? []));
}

/** What a customer's edit builds on, and what more than filling in fields it may do. */
export async function customerRules(p: Project, incoming: unknown, user: User): Promise<{ stored: CanvasDoc; free: FreeEdits | null }> {
  const ctx = await projectContext(p);
  const [withLooks, free] = await Promise.all([withSentLooks(p, incoming, ctx, user), ctx.audience === 'business' ? customerFonts().then((fonts) => ({ fonts })) : null]);
  return { stored: await withSentProducts(withLooks, incoming, user), free };
}

/** The design with what its customer sent, as far as the rules allow. */
export async function customerEdit(p: Project, incoming: unknown, user: User, assets: ImageAsset[]) {
  const { stored, free } = await customerRules(p, incoming, user);
  return applyCustomerEdits(stored, incoming, assets, free);
}
