/**
 * Converts every stored card still in format v1 to v2, once (design doc §5).
 *   npm run cards:v2              # convert
 *   npm run cards:v2 -- --dry     # only report
 * Cards are also converted on read, so the app works before this ran. `updated_at` is kept.
 */
import type { Prisma } from '../src/generated/prisma/client';
import { toV2 } from '../src/lib/canvas-v1';
import { prisma } from '../src/lib/data/prisma';

const dry = process.argv.includes('--dry');
const report = { converted: 0, alreadyV2: 0, failed: [] as string[] };

async function convert(table: 'template' | 'creative') {
  const rows = await (prisma[table] as typeof prisma.template).findMany({ select: { id: true, name: true, canvas: true, updatedAt: true } });
  for (const r of rows) {
    if ((r.canvas as { schema_version?: number } | null)?.schema_version === 2) {
      report.alreadyV2++;
      continue;
    }
    const v2 = toV2(r.canvas);
    if (!v2) {
      report.failed.push(`${table} ${r.id} ${r.name}`);
      continue;
    }
    if (!dry) {
      await (prisma[table] as typeof prisma.template).update({
        where: { id: r.id },
        data: { canvas: v2 as unknown as Prisma.InputJsonValue, updatedAt: r.updatedAt },
      });
    }
    report.converted++;
  }
}

await convert('template');
await convert('creative');
console.log(dry ? 'dry run:' : 'done:', { ...report, failed: report.failed.length });
for (const f of report.failed) console.log('  could not convert', f);
await prisma.$disconnect();
