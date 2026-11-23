import { brandCategory } from './brand';
import { deleteRow, findRows, getRow, setRow } from './db';

/**
 * A visitor who signs in to an existing account brings along what they made as a guest: their designs, catalog and
 * pictures, and their brand kit if the account has none. (One who signs up keeps the same user, so nothing moves.)
 */
export async function adoptGuest(guestId: string, userId: string) {
  const [projects, catalog, pictures, guestKit, ownKit] = await Promise.all([
    findRows('projects', { ownerId: guestId }),
    findRows('catalog', { ownerId: guestId }),
    findRows('images', { categoryId: brandCategory(guestId) }),
    getRow('brands', guestId),
    getRow('brands', userId),
  ]);
  await Promise.all([
    ...projects.map((p) => setRow('projects', { ...p, ownerId: userId })),
    ...catalog.map((c) => setRow('catalog', { ...c, ownerId: userId })),
    // a logo or catalog photo only shows to its owner, by its category
    ...pictures.map((i) => setRow('images', { ...i, categoryId: brandCategory(userId) })),
  ]);
  if (guestKit) {
    if (!ownKit?.businessName) await setRow('brands', { ...guestKit, id: userId });
    await deleteRow('brands', guestId);
  }
  await deleteRow('users', guestId);
}
