// A draft template from an InDesign "Export HTML" (.zip, .rar or its folder), as the admin's
// "מ-InDesign" button makes one (src/lib/indesignSave.ts), for many at once or a dry look first.
//
//   npm run import:indesign -- "<export .zip/.rar/folder>" [--name "..."] [--out <dir>]   (dry run)
//   npm run import:indesign -- "<export .zip/.rar/folder>" --write [--name "..."]
//
// Dry run writes canvas.json, background.jpg and report.txt to --out (default data/indesign-import)
// and touches no store. --write adds the export's missing fonts, the background and a draft
// template to the store DATA_DRIVER and FIRESTORE_PREFIX pick.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { InDesignExport, exportFiles, exportPages } from '../src/lib/indesignImport';
import { importInDesign, unpack } from '../src/lib/indesignSave';

const argv = process.argv.slice(2);
const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const source = argv.find((a, i) => !a.startsWith('--') && !['--name', '--out'].includes(argv[i - 1]));
if (!source) {
  console.error('usage: import-indesign <export .zip/.rar/folder> [--name ...] [--out dir] [--write]');
  process.exit(1);
}
const name = opt('--name') ?? path.basename(source).replace(/\.(zip|rar)$/i, '');
const out = opt('--out') ?? path.join(process.cwd(), 'data', 'indesign-import');

function walk(dir: string, base = dir): [string, Buffer][] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    return statSync(full).isDirectory() ? walk(full, base) : [[path.relative(base, full), readFileSync(full)] as [string, Buffer]];
  });
}

async function main() {
  const entries = statSync(source!).isDirectory() ? walk(source!) : await unpack(readFileSync(source!), path.basename(source!));
  if (argv.includes('--write')) {
    const r = await importInDesign(entries, { name });
    if ('conflict' in r) throw new Error(r.conflict);
    console.log(r.fontsAdded.length ? `fonts added: ${r.fontsAdded.join(', ')}` : 'no fonts added');
    console.log(r.report.map((l) => '  ' + l).join('\n'));
    for (const id of r.ids) console.log(`draft template: /editor/${id}`);
    return;
  }
  const files = exportFiles(entries);
  const refs = exportPages(files);
  for (const [i, ref] of refs.entries()) {
    const exp = new InDesignExport(files, ref);
    const dir = refs.length > 1 ? path.join(out, `page-${i + 1}`) : out;
    let n = 0;
    const { canvas, report, glyphs } = exp.build({ assetId: 'background', newId: () => `t${++n}`, available: () => true });
    const bg = await exp.background();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'canvas.json'), JSON.stringify(canvas, null, 2));
    writeFileSync(path.join(dir, 'background.jpg'), bg.data);
    writeFileSync(path.join(dir, 'report.txt'), report.join('\n') + '\n');
    console.log(`page ${i + 1} (${ref.html.split('/').pop()} #${ref.box + 1}): ${canvas.page.width_mm}x${canvas.page.height_mm} mm, background ${bg.width}x${bg.height}px, ${report.length} texts, ${glyphs} glyphs drawn in`);
    console.log(`  fonts: ${exp.fontsUsed().map((f) => `${f.family} ${f.weight}`).join(', ') || 'none'}`);
  }
  console.log(`written to ${out}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
