/**
 * Fonts a card can use: the built-in ones (loaded from Google Fonts in layout.tsx) and the ones an
 * admin uploaded (table `fonts`, served by /api/fonts/<id>). A text's font.family is the family
 * name, so an uploaded font works everywhere a built-in one does (design doc §4.2).
 * Safe to import from client components.
 */

/** Built-in families and the weights layout.tsx loads for them. */
export const BUILTIN_FONTS: { family: string; weights: number[] }[] = [
  { family: 'Heebo', weights: [400, 500, 700, 800] },
  { family: 'Frank Ruhl Libre', weights: [400, 700, 900] },
  { family: 'Assistant', weights: [400, 700] },
  { family: 'Secular One', weights: [400] },
  { family: 'Arial', weights: [400, 700] },
];

/** An uploaded font file: one weight and style of one family. */
export type UploadedFont = {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** /api/fonts/<id> */
  url: string;
  /** the file has the Hebrew letters א–ת */
  hebrew: boolean;
  createdAt: string;
};

export type FontFamily = { family: string; weights: number[]; builtin: boolean; hebrew: boolean };

/** Letters, digits, spaces, "-" and "_": the name goes into CSS font strings, so no quotes or ";". */
export const FAMILY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,59}$/u;

export const isBuiltinFamily = (family: string) =>
  BUILTIN_FONTS.some((f) => f.family.toLowerCase() === family.trim().toLowerCase());

/** Built-in families first, then uploaded ones by name, each with its sorted weights. */
export function fontFamilies(uploaded: Pick<UploadedFont, 'family' | 'weight' | 'style' | 'hebrew'>[]): FontFamily[] {
  const out: FontFamily[] = BUILTIN_FONTS.map((f) => ({ ...f, builtin: true, hebrew: f.family !== 'Arial' }));
  const byName = new Map<string, FontFamily>();
  for (const f of uploaded) {
    // texts have no italic setting yet, so an italic file adds no weight to choose
    if (isBuiltinFamily(f.family) || f.style === 'italic') continue;
    const fam = byName.get(f.family) ?? { family: f.family, weights: [], builtin: false, hebrew: false };
    if (!fam.weights.includes(f.weight)) fam.weights.push(f.weight);
    fam.hebrew ||= f.hebrew;
    byName.set(f.family, fam);
  }
  const extra = [...byName.values()].sort((a, b) => a.family.localeCompare(b.family, 'he'));
  for (const f of extra) f.weights.sort((a, b) => a - b);
  return [...out, ...extra];
}

/** The available weight closest to the wanted one (a family without the exact weight). */
export function nearestWeight(weights: number[], wanted: number) {
  return weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), weights[0] ?? 400);
}

export const WEIGHT_NAMES: Record<number, string> = {
  100: 'דק מאוד',
  200: 'דק',
  300: 'קל',
  400: 'רגיל',
  500: 'בינוני',
  600: 'חצי מודגש',
  700: 'מודגש',
  800: 'מודגש מאוד',
  900: 'שחור',
};
