// One-off: copies data/db.json and data/uploads/* into Firestore / Cloud Storage.
// Run: npm run migrate:firebase   (needs FIREBASE_SERVICE_ACCOUNT_FILE in .env.local)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { firestore, bucket } from '../src/lib/firebase';
import type { Db } from '../src/lib/types';

const dataDir = path.join(process.cwd(), 'data');

async function main() {
  const db = JSON.parse(await fs.readFile(path.join(dataDir, 'db.json'), 'utf8')) as Partial<Db>;
  const fsdb = firestore();
  for (const key of ['categories', 'images', 'projects', 'users', 'sessions'] as const) {
    const rows = (db[key] ?? []) as unknown as Record<string, unknown>[];
    for (let i = 0; i < rows.length; i += 400) {
      const batch = fsdb.batch();
      for (const row of rows.slice(i, i + 400)) {
        const id = String(key === 'sessions' ? row.tokenHash : row.id);
        batch.set(fsdb.collection(key).doc(id), JSON.parse(JSON.stringify(row)));
      }
      await batch.commit();
    }
    console.log(`${key}: ${rows.length}`);
  }
  const files = await fs.readdir(path.join(dataDir, 'uploads')).catch(() => [] as string[]);
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  for (const f of files) {
    await bucket().file(`uploads/${f}`).save(await fs.readFile(path.join(dataDir, 'uploads', f)), {
      contentType: types[path.extname(f)], resumable: false,
    });
  }
  console.log(`uploads: ${files.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
