import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * One Prisma client per server process. In development Next.js reloads modules on every
 * change, so the client is kept on globalThis to avoid opening a new pool each time.
 * The repositories in src/lib/data/ use this; routes do not import it directly.
 */
const DEFAULT_URL = 'postgresql://cardsimcha:cardsimcha@localhost:5433/cardsimcha';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
