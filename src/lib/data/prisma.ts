import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * One Prisma client per server process. In development Next.js reloads modules on every
 * change, so the client is kept on globalThis to avoid opening a new pool each time.
 * The repositories in src/lib/data/ use this; routes do not import it directly.
 */
const DEFAULT_URL = 'postgresql://cardsimcha:cardsimcha@localhost:5433/cardsimcha';

// `client` remembers which generated class made it: after `prisma generate` (a schema change)
// the dev server loads a new class, and a client of the old one would not know the new fields.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaClass?: typeof PrismaClient };

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL });
  return new PrismaClient({ adapter });
}

const stale = globalForPrisma.prisma && globalForPrisma.prismaClass !== PrismaClient;
if (stale) void globalForPrisma.prisma!.$disconnect().catch(() => {});

export const prisma = (!stale && globalForPrisma.prisma) || createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClass = PrismaClient;
}
