import type { FontFormat } from '../font-file';
import type { UploadedFont } from '../fonts';
import { C, db, now } from './store';

// Uploaded fonts. Platform fonts (workspaceId null) are uploaded by an admin and offered to
// every card; workspace fonts come with the business workspaces and use the same collection.

export type FontDoc = {
  id: string;
  workspaceId: string | null;
  family: string;
  /** lower case, to find a family whatever its spelling */
  familyKey: string;
  weight: number;
  style: 'normal' | 'italic';
  fileKey: string;
  unicodeRanges: string | null;
  createdAt: string;
  updatedAt: string;
};

/** does a CSS unicode-range list cover the Hebrew letters א–ת? */
function coversHebrew(unicodeRanges: string | null) {
  if (!unicodeRanges) return false;
  return unicodeRanges.split(',').some((r) => {
    const [a, b = a] = r.replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
    return a <= 0x5d0 && b >= 0x5ea;
  });
}

const toFont = (f: FontDoc): UploadedFont => ({
  id: f.id,
  family: f.family,
  weight: f.weight,
  style: f.style === 'italic' ? 'italic' : 'normal',
  url: `/api/fonts/${f.id}`,
  hebrew: coversHebrew(f.unicodeRanges),
  createdAt: f.createdAt,
});

export const fontFileKey = (id: string, format: FontFormat) => `fonts/platform/${id}.${format}`;

const platformFont = async (id: string) => {
  const f = await db.get<FontDoc>(C.fonts, id);
  return f && f.workspaceId === null ? f : null;
};

export async function listFonts(): Promise<UploadedFont[]> {
  const rows = await db.find<FontDoc>(C.fonts, ['workspaceId', '==', null]);
  rows.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style));
  return rows.map(toFont);
}

/** the stored file of a platform font */
export async function fontFile(id: string): Promise<{ key: string; format: FontFormat } | null> {
  const f = await platformFont(id);
  if (!f) return null;
  return { key: f.fileKey, format: f.fileKey.slice(f.fileKey.lastIndexOf('.') + 1) as FontFormat };
}

/** null when the family already has this weight and style */
export async function addFont(input: {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  fileKey: string;
  unicodeRanges: string;
}): Promise<UploadedFont | null> {
  const familyKey = input.family.toLowerCase();
  return db.tx(async (t) => {
    const family = await t.find<FontDoc>(C.fonts, ['workspaceId', '==', null], ['familyKey', '==', familyKey]);
    if (family.some((f) => f.weight === input.weight && f.style === input.style)) return null;
    // one spelling per family: "guttman frank" joins an existing "Guttman Frank"
    const at = now();
    const f: FontDoc = { ...input, workspaceId: null, family: family[0]?.family ?? input.family, familyKey, createdAt: at, updatedAt: at };
    t.set(C.fonts, f.id, f);
    return toFont(f);
  });
}

/** the file key of the deleted font, null when there was none */
export async function deleteFont(id: string): Promise<string | null> {
  const f = await platformFont(id);
  if (!f) return null;
  await db.delete(C.fonts, id);
  return f.fileKey;
}

/** the font families a card uses: every `font.family` anywhere in it */
function familiesIn(canvas: string): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'font' && x && typeof x === 'object' && typeof (x as { family?: unknown }).family === 'string') out.add((x as { family: string }).family);
        walk(x);
      }
    }
  };
  try {
    walk(JSON.parse(canvas));
  } catch {
    // a card that does not parse uses no font
  }
  return out;
}

/**
 * How many templates and customer designs use each family. It reads every card, so it is for
 * the admin's font page only.
 */
export async function fontUsage(families: string[]): Promise<Record<string, { templates: number; designs: number }>> {
  if (!families.length) return {};
  const [templates, designs] = await Promise.all([
    db.pick<{ canvas: string }>(C.templates, ['canvas']),
    db.pick<{ canvas: string }>(C.creatives, ['canvas']),
  ]);
  const used = (rows: { canvas: string }[]) => rows.map((r) => familiesIn(r.canvas));
  const t = used(templates);
  const d = used(designs);
  return Object.fromEntries(
    families.map((f) => [f, { templates: t.filter((s) => s.has(f)).length, designs: d.filter((s) => s.has(f)).length }]),
  );
}
