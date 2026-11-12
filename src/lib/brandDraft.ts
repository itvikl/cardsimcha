import { emptyBrand, type BrandFields } from './brand';
import type { BrandKit } from './types';

const KEY = 'brand-draft';

/** The details a visitor tried the ads with, before signing up. They live in this browser, and become the kit once signed in. */
export type BrandDraft = Pick<BrandFields, 'businessName' | 'phone' | 'primaryColor' | 'secondaryColor'>;

export function readBrandDraft(): BrandDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as BrandDraft | null;
    return d?.businessName ? d : null;
  } catch {
    return null;
  }
}

export function saveBrandDraft(d: BrandDraft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}

export function clearBrandDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** a kit to draw the ads with */
export const draftKit = (d: BrandDraft): BrandKit => ({ ...emptyBrand(''), ...d });
