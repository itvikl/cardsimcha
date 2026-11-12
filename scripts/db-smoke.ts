// Quick check that the app can reach Postgres: npm run db:smoke
import { prisma } from '../src/lib/data/prisma';

const ws = await prisma.workspace.create({ data: { kind: 'personal', name: 'smoke test' } });
const user = await prisma.user.create({
  data: { name: 'smoke', memberships: { create: { workspaceId: ws.id, role: 'owner' } } },
});
const found = await prisma.workspace.findUnique({ where: { id: ws.id }, include: { memberships: true } });
const ext = await prisma.$queryRaw<{ extversion: string }[]>`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
if (!ext.length) throw new Error("pgvector extension missing");
const { extversion } = ext[0];
console.log(`ok: workspace with ${found?.memberships.length} member, pgvector ${extversion}`);
await prisma.user.delete({ where: { id: user.id } });
await prisma.workspace.delete({ where: { id: ws.id } });
await prisma.$disconnect();
