// One-off, safe to run again: prepares existing projects for per-record queries.
// - fills in kind / status / ownerId where old records lack them (Firestore queries skip missing fields)
// - moves inline `data:` thumbnails into Cloud Storage files and stores their URL instead
// Run: npm run migrate:thumbnails   (needs FIREBASE_SERVICE_ACCOUNT_FILE in .env.local)
import { firestore } from '../src/lib/firebase';
import { thumbnailFile } from '../src/lib/db';

async function main() {
  const fs = firestore();
  const snap = await fs.collection('projects').get();
  let fields = 0;
  let thumbs = 0;
  for (const doc of snap.docs) {
    const p = doc.data();
    const patch: Record<string, unknown> = {};
    if (p.kind === undefined) patch.kind = 'template';
    if (p.status === undefined) patch.status = 'draft';
    if (p.ownerId === undefined) patch.ownerId = '';
    if (Object.keys(patch).length) fields++;
    if (typeof p.thumbnail === 'string' && p.thumbnail.startsWith('data:image/')) {
      const file = thumbnailFile(doc.id, p.thumbnail);
      await file.save();
      patch.thumbnail = file.url;
      thumbs++;
    }
    if (Object.keys(patch).length) await doc.ref.update(patch);
  }
  console.log(`projects: ${snap.size}, fields filled in: ${fields}, thumbnails moved to files: ${thumbs}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
