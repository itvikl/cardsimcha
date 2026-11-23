import type { CatalogItem } from './types';

export type CatalogFields = Pick<CatalogItem, 'name' | 'details' | 'price'>;

/** An item's words from a form, or the reason they can't be saved. */
export function parseCatalogFields(form: FormData | null): CatalogFields | string {
  const text = (k: string, max: number) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  };
  const name = text('name', 80);
  if (!name) return 'שם הפריט חובה';
  return { name, details: text('details', 200), price: text('price', 60) };
}
