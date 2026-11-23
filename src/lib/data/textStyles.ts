import { validateTextLook, type TextLook } from '../canvas';
import { newId } from './ids';
import { C, db, now } from './store';

// Saved text styles. Platform styles (workspaceId null) are shared by every admin; workspace
// styles come with the business workspaces and use the same collection.

export type TextStyle = { id: string; name: string; look: TextLook; createdAt: string };

type TextStyleDoc = {
  id: string;
  workspaceId: string | null;
  name: string;
  /** JSON text of the look (Firestore takes no nested arrays) */
  look: string;
  createdById: string | null;
  createdAt: string;
};

export const MAX_STYLES = 200;

/** a stored look that no longer validates (the format moved on) is left out rather than offered */
const toStyle = (r: TextStyleDoc): TextStyle | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(r.look);
  } catch {
    return null;
  }
  const look = validateTextLook(raw);
  return look ? { id: r.id, name: r.name, look, createdAt: r.createdAt } : null;
};

const platformStyles = (r: Pick<typeof db, 'find'> = db) => r.find<TextStyleDoc>(C.textStyles, ['workspaceId', '==', null]);

export async function listTextStyles(): Promise<TextStyle[]> {
  const rows = (await platformStyles()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_STYLES);
  return rows.map(toStyle).filter((s): s is TextStyle => s !== null);
}

/** null when the platform already holds MAX_STYLES styles */
export async function addTextStyle(input: { name: string; look: TextLook; createdById: string }): Promise<TextStyle | null> {
  return db.tx(async (t) => {
    if ((await platformStyles(t)).length >= MAX_STYLES) return null;
    const row: TextStyleDoc = { id: newId(), workspaceId: null, name: input.name, look: JSON.stringify(input.look), createdById: input.createdById, createdAt: now() };
    t.set(C.textStyles, row.id, row);
    return toStyle(row);
  });
}

/** false when there was no such platform style */
export async function deleteTextStyle(id: string): Promise<boolean> {
  const row = await db.get<TextStyleDoc>(C.textStyles, id);
  if (!row || row.workspaceId !== null) return false;
  await db.delete(C.textStyles, id);
  return true;
}
