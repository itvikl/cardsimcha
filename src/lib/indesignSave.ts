import { unzipSync } from 'fflate';
import { createExtractorFromData } from 'node-unrar-js';
import { addFont, fontFileKey, listFonts } from './data/fonts';
import { newId } from './data/ids';
import { addImage, assetFileKey, createCategory, listCategories } from './data/library';
import { createTemplate } from './data/projects';
import { files } from './files';
import { FONT_MIME, parseFont } from './font-file';
import { BUILTIN_FONTS } from './fonts';
import { ExportError, InDesignExport, exportFiles, exportPages } from './indesignImport';
import type { Audience } from './categories';
import { validateDoc } from './canvas';

const CATEGORY = 'עיצובים מיובאים';

/** the files of a .zip or .rar, by path */
export async function unpack(data: Buffer, fileName: string): Promise<[string, Buffer][]> {
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  const isRar = data.subarray(0, 4).toString('latin1') === 'Rar!';
  if (isZip) {
    try {
      return Object.entries(unzipSync(new Uint8Array(data))).map(([p, d]) => [p, Buffer.from(d)]);
    } catch {
      throw new ExportError('קובץ ה-ZIP פגום');
    }
  }
  if (isRar) {
    try {
      const ex = await createExtractorFromData({ data: Uint8Array.from(data).buffer });
      const out: [string, Buffer][] = [];
      for (const f of ex.extract().files) if (!f.fileHeader.flags.directory && f.extraction) out.push([f.fileHeader.name, Buffer.from(f.extraction)]);
      return out;
    } catch {
      throw new ExportError('קובץ ה-RAR פגום או מוגן בסיסמה');
    }
  }
  throw new ExportError(`${fileName}: יש להעלות ZIP או RAR של ייצוא HTML מ-InDesign`);
}

/** the shared category that keeps imported backgrounds, made the first time */
async function importCategoryId(): Promise<string> {
  const made = await createCategory(CATEGORY, 'רקעים של עיצובים שיובאו מ-InDesign');
  if (made) return made.id;
  const found = (await listCategories()).find((c) => c.name === CATEGORY);
  if (!found) throw new Error('import category missing');
  return found.id;
}

/**
 * An InDesign HTML export (its files) in, a draft template per page out. The export's fonts the texts use and the
 * site lacks are added as platform fonts first, so the templates show in the designer's letters.
 */
export async function importInDesign(
  entries: [string, Buffer][],
  input: { name: string; topic?: string; audience?: Audience; places?: string[]; labelId?: string | null },
): Promise<{ ids: string[]; texts: number; fontsAdded: string[]; report: string[] } | { conflict: string }> {
  const exported = exportFiles(entries);
  // every page first, so a page that doesn't read stops the import before anything is saved
  const pages = exportPages(exported)
    .map((ref) => new InDesignExport(exported, ref))
    .filter((p) => p.texts.length);
  if (!pages.length) throw new ExportError('לא נמצאו טקסטים בייצוא');

  const have = new Set((await listFonts()).map((f) => `${f.family}|${f.weight}`));
  const builtin = (family: string, weight: number) => BUILTIN_FONTS.some((f) => f.family === family && f.weights.includes(weight));
  const fontsAdded: string[] = [];
  const used = new Map(pages.flatMap((p) => p.fontsUsed()).map((f) => [`${f.family}|${f.weight}`, f]));
  for (const [key, f] of used) {
    if (have.has(key) || builtin(f.family, f.weight)) continue;
    let parsed;
    try {
      parsed = parseFont(f.data);
    } catch {
      continue; // its texts fall back to a built-in font
    }
    const id = newId();
    const fileKey = fontFileKey(id, parsed.format);
    await files.put(fileKey, f.data, FONT_MIME[parsed.format]);
    if (await addFont({ id, family: f.family, weight: f.weight, style: 'normal', fileKey, unicodeRanges: parsed.unicodeRanges })) {
      have.add(key);
      fontsAdded.push(`${f.family} ${f.weight}`);
    } else await files.remove([fileKey]);
  }

  const categoryId = await importCategoryId();
  const ids: string[] = [];
  const report: string[] = [];
  let texts = 0;
  for (const [i, page] of pages.entries()) {
    const name = pages.length > 1 ? `${input.name} · ${i + 1}` : input.name;
    const bg = await page.background();
    const assetId = newId();
    const built = page.build({ assetId, newId, available: (family, weight) => have.has(`${family}|${weight}`) || builtin(family, weight) });
    const canvas = validateDoc(built.canvas);
    if (!canvas) throw new ExportError(`לא הצלחנו לבנות תבנית מעמוד ${i + 1}`);
    const fileName = `${assetId}.jpg`;
    await files.put(assetFileKey(fileName), bg.data, 'image/jpeg');
    const asset = await addImage({ id: assetId, categoryId, name, file: fileName, width: bg.width, height: bg.height, metadata: { importedFrom: 'indesign-html' } });
    if (!asset) {
      await files.remove([assetFileKey(fileName)]);
      throw new Error('saving the background failed');
    }
    const result = await createTemplate({
      name,
      topic: input.topic ?? '',
      canvas,
      ...(input.audience && { audience: input.audience }),
      places: input.places ?? [],
      labelId: input.labelId ?? null,
    });
    if ('conflict' in result) return result;
    ids.push(result.id);
    texts += canvas.layers.content.length;
    report.push(...(pages.length > 1 ? [`— ${name}`] : []), ...built.report);
  }
  return { ids, texts, fontsAdded, report };
}
