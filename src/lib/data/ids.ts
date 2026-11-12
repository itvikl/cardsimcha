import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';

export const newId = () => randomUUID();

/** The same UUID for the same name, so rows like a user's personal workspace can be upserted. */
export function stableId(name: string): string {
  const h = createHash('sha256').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
