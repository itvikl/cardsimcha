/** Prices are in shekels. They are only shown for now: nothing asks the customer to pay. */
export const MAX_PRICE = 100_000;

/** A price sent to the server: a number sets it (rounded to agorot), null clears it, anything else is 'invalid'. */
export function parsePrice(v: unknown): number | null | 'invalid' {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_PRICE) return 'invalid';
  return Math.round(v * 100) / 100;
}

export const formatPrice = (price: number) =>
  price === 0
    ? 'חינם'
    : new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: Number.isInteger(price) ? 0 : 2 }).format(price);
