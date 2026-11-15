import type { AdTexts } from './adText';

/** an ad's words from a request: only short strings, at most as many as a design has fields */
export function parseAdTexts(v: unknown): AdTexts | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const entries = Object.entries(v).flatMap(([k, x]) => (typeof x === 'string' && k.length <= 60 ? [[k, x.slice(0, 300)]] : []));
  return entries.length ? Object.fromEntries(entries.slice(0, 40)) : undefined;
}
