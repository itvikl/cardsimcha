import type { TextStyle as Row } from '@/generated/prisma/client';
import { validateTextLook, type TextLook } from '../canvas';
import { prisma } from './prisma';

// Saved text styles. Platform styles (workspace_id null) are shared by every admin; workspace
// styles come with the business workspaces and use the same table.

export type TextStyle = { id: string; name: string; look: TextLook; createdAt: string };

export const MAX_STYLES = 200;

/** a stored look that no longer validates (the format moved on) is left out rather than offered */
const toStyle = (r: Row): TextStyle | null => {
  const look = validateTextLook(r.look);
  return look ? { id: r.id, name: r.name, look, createdAt: r.createdAt.toISOString() } : null;
};

export async function listTextStyles(): Promise<TextStyle[]> {
  const rows = await prisma.textStyle.findMany({ where: { workspaceId: null }, orderBy: { createdAt: 'desc' }, take: MAX_STYLES });
  return rows.map(toStyle).filter((s): s is TextStyle => s !== null);
}

/** null when the platform already holds MAX_STYLES styles */
export async function addTextStyle(input: { name: string; look: TextLook; createdById: string }): Promise<TextStyle | null> {
  return prisma.$transaction(async (tx) => {
    if ((await tx.textStyle.count({ where: { workspaceId: null } })) >= MAX_STYLES) return null;
    const row = await tx.textStyle.create({ data: { name: input.name, look: input.look, createdById: input.createdById } });
    return toStyle(row);
  });
}

/** false when there was no such platform style */
export async function deleteTextStyle(id: string): Promise<boolean> {
  const { count } = await prisma.textStyle.deleteMany({ where: { id, workspaceId: null } });
  return count > 0;
}
