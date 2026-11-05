import type { Font } from '@/generated/prisma/client';
import type { FontFormat } from '../font-file';
import type { UploadedFont } from '../fonts';
import { prisma } from './prisma';

// Uploaded fonts. Platform fonts (workspace_id null) are uploaded by an admin and offered to
// every card; workspace fonts come with the business workspaces and use the same table.

/** does a CSS unicode-range list cover the Hebrew letters א–ת? */
function coversHebrew(unicodeRanges: string | null) {
  if (!unicodeRanges) return false;
  return unicodeRanges.split(',').some((r) => {
    const [a, b = a] = r.replace(/^U\+/i, '').split('-').map((h) => parseInt(h, 16));
    return a <= 0x5d0 && b >= 0x5ea;
  });
}

const toFont = (f: Font): UploadedFont => ({
  id: f.id,
  family: f.family,
  weight: f.weight,
  style: f.style === 'italic' ? 'italic' : 'normal',
  url: `/api/fonts/${f.id}`,
  hebrew: coversHebrew(f.unicodeRanges),
  createdAt: f.createdAt.toISOString(),
});

export const fontFileKey = (id: string, format: FontFormat) => `fonts/platform/${id}.${format}`;

export async function listFonts(): Promise<UploadedFont[]> {
  const rows = await prisma.font.findMany({ where: { workspaceId: null }, orderBy: [{ family: 'asc' }, { weight: 'asc' }, { style: 'asc' }] });
  return rows.map(toFont);
}

/** the stored file of a platform font */
export async function fontFile(id: string): Promise<{ key: string; format: FontFormat } | null> {
  const f = await prisma.font.findFirst({ where: { id, workspaceId: null }, select: { fileKey: true } });
  if (!f) return null;
  return { key: f.fileKey, format: f.fileKey.slice(f.fileKey.lastIndexOf('.') + 1) as FontFormat };
}

/**
 * null when the family already has this weight and style. The unique index does not catch it for
 * platform fonts (NULL workspace ids never compare equal), so it is checked here.
 */
export async function addFont(input: {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  fileKey: string;
  unicodeRanges: string;
}): Promise<UploadedFont | null> {
  return prisma.$transaction(async (tx) => {
    const same = await tx.font.findFirst({
      where: { workspaceId: null, family: { equals: input.family, mode: 'insensitive' }, weight: input.weight, style: input.style },
    });
    if (same) return null;
    // one spelling per family: "guttman frank" joins an existing "Guttman Frank"
    const spelled = await tx.font.findFirst({ where: { workspaceId: null, family: { equals: input.family, mode: 'insensitive' } } });
    return toFont(await tx.font.create({ data: { ...input, family: spelled?.family ?? input.family } }));
  });
}

/** the file key of the deleted font, null when there was none */
export async function deleteFont(id: string): Promise<string | null> {
  const f = await prisma.font.findFirst({ where: { id, workspaceId: null } });
  if (!f) return null;
  await prisma.font.delete({ where: { id } });
  return f.fileKey;
}

/** how many templates and customer designs use each family */
export async function fontUsage(families: string[]): Promise<Record<string, { templates: number; designs: number }>> {
  if (!families.length) return {};
  const rows = await prisma.$queryRaw<{ family: string; templates: number; designs: number }[]>`
    SELECT fam AS family,
      (SELECT count(*)::int FROM templates WHERE jsonb_path_exists(canvas, '$.**.font.family ? (@ == $f)', jsonb_build_object('f', fam))) AS templates,
      (SELECT count(*)::int FROM creatives WHERE jsonb_path_exists(canvas, '$.**.font.family ? (@ == $f)', jsonb_build_object('f', fam))) AS designs
    FROM unnest(${families}::text[]) AS fam`;
  return Object.fromEntries(rows.map((r) => [r.family, { templates: r.templates, designs: r.designs }]));
}
