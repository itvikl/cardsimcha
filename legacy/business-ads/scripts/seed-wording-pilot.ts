/**
 * The pilot of the card + wording logic: 3 backgrounds and 3 wordings of "שלום זכר" in two sizes, and a ready card from
 * each pair. The pictures and the words are placeholders until the designer's arrive, so everything is a draft: customers
 * don't see it, and an admin tries it with "נסה כלקוח". Re-running writes the same rows again, keeping their status.
 *
 *   npm run seed:wording-pilot               create or update
 *   npm run seed:wording-pilot -- --remove   delete everything this script created
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateDoc } from '../src/lib/canvas';
import { deleteRow, getRow, removeThumbnail, removeUploads, saveUpload, setRow } from '../src/lib/db';
import { fitDocColors } from '../src/lib/fitColor';
import { applyWording, wordingTexts } from '../src/lib/wording';
import type { CanvasDoc, Category, ImageAsset, Project, TextElement } from '../src/lib/types';

const TOPIC = 'שלום זכר';
const REMOVE = process.argv.includes('--remove');
const now = new Date().toISOString();

/** the same name always gives the same id, in the uuid shape upload file names need, so re-running finds what it made */
function stableId(name: string) {
  const h = createHash('sha256').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const SIZES = [
  { key: 'a5', label: 'A5', w: 148, h: 210, px: [874, 1240], fs: 1 },
  { key: 'status', label: 'סטטוס', w: 108, h: 192, px: [810, 1440], fs: 0.8 },
] as const;
type Size = (typeof SIZES)[number];

/** placeholders in three moods, so that matching the text to a background has something to do: light, dark and in between */
const BACKGROUNDS: { key: string; name: string; svg: (w: number, h: number) => string }[] = [
  {
    key: 'cream',
    name: 'שמנת וזהב (זמני)',
    svg: (w, h) => `<rect width="${w}" height="${h}" fill="#FBF4E4"/><rect x="${w * 0.04}" y="${w * 0.04}" width="${w * 0.92}" height="${h - w * 0.08}" fill="none" stroke="#B8923F" stroke-width="${w * 0.008}"/>`,
  },
  {
    key: 'night',
    name: 'לילה כחול (זמני)',
    svg: (w, h) =>
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E1E40"/><stop offset="1" stop-color="#1D3A6E"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>` +
      Array.from({ length: 40 }, (_, i) => `<circle cx="${((i * 137) % 100) * 0.01 * w}" cy="${((i * 61) % 100) * 0.01 * h * 0.22}" r="${w * 0.004}" fill="#E8D9A8"/>`).join(''),
  },
  {
    key: 'sage',
    name: 'ירוק מרווה (זמני)',
    svg: (w, h) =>
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8FAE98"/><stop offset="1" stop-color="#5F8570"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`,
  },
];

const FIELDS = { parents: 'שמות ההורים', when: 'מועד', where: 'כתובת' };

type Line = { text: string; label: string; size: number; bold?: boolean; family: string; gap: number; detail?: boolean };

const WORDINGS: { key: string; name: string; color: string; lines: Line[] }[] = [
  {
    key: 'traditional',
    name: 'מסורתי',
    color: '#1F2A44',
    lines: [
      { text: 'בס״ד', label: 'פתיח', size: 12, family: 'Frank Ruhl Libre', gap: 14 },
      { text: 'שלום זכר', label: 'כותרת', size: 40, bold: true, family: 'Frank Ruhl Libre', gap: 24 },
      { text: 'בשבח והודיה להשי״ת על הולדת בננו, נתכבד להזמינכם להשתתף בשמחתנו', label: 'נוסח', size: 15, family: 'Frank Ruhl Libre', gap: 30 },
      { text: 'משפחת ישראלי', label: FIELDS.parents, size: 22, bold: true, family: 'Frank Ruhl Libre', gap: 16, detail: true },
      { text: 'ליל שבת קודש, בשעה 21:00', label: FIELDS.when, size: 15, family: 'Frank Ruhl Libre', gap: 10, detail: true },
      { text: 'רחוב הדוגמה 1, העיר', label: FIELDS.where, size: 15, family: 'Frank Ruhl Libre', gap: 0, detail: true },
    ],
  },
  {
    key: 'warm',
    name: 'חם ומשפחתי',
    color: '#7A3B1E',
    lines: [
      { text: 'בשעה טובה!', label: 'כותרת', size: 34, bold: true, family: 'Secular One', gap: 22 },
      { text: 'נולד לנו בן, והלב מלא שמחה. בואו לשמוח איתנו בשלום זכר', label: 'נוסח', size: 16, family: 'Assistant', gap: 30 },
      { text: 'משפחת ישראלי', label: FIELDS.parents, size: 20, bold: true, family: 'Secular One', gap: 14, detail: true },
      { text: 'ליל שבת קודש, בשעה 21:00', label: FIELDS.when, size: 15, family: 'Assistant', gap: 10, detail: true },
      { text: 'רחוב הדוגמה 1, העיר', label: FIELDS.where, size: 15, family: 'Assistant', gap: 0, detail: true },
    ],
  },
  {
    key: 'short',
    name: 'קצר וחגיגי',
    color: '#FFFFFF',
    lines: [
      { text: 'ברוך הבא', label: 'כותרת', size: 44, bold: true, family: 'Heebo', gap: 26 },
      { text: 'מזמינים אתכם לשלום זכר', label: 'נוסח', size: 17, family: 'Heebo', gap: 30 },
      { text: 'משפחת ישראלי', label: FIELDS.parents, size: 18, bold: true, family: 'Heebo', gap: 12, detail: true },
      { text: 'ליל שבת קודש, בשעה 21:00', label: FIELDS.when, size: 14, family: 'Heebo', gap: 8, detail: true },
      { text: 'רחוב הדוגמה 1, העיר', label: FIELDS.where, size: 14, family: 'Heebo', gap: 0, detail: true },
    ],
  },
];

/** the lines one under the other, in the middle of the page */
function wordingCanvas(size: Size, w: (typeof WORDINGS)[number]): CanvasDoc {
  const PT = 25.4 / 72;
  const margin = 14 * size.fs;
  const width = size.w - margin * 2;
  const heightOf = (l: Line) => {
    const pt = l.size * size.fs;
    const perLine = Math.max(1, Math.floor(width / (pt * PT * 0.56)));
    return Math.ceil(l.text.length / perLine) * pt * PT * 1.25;
  };
  const total = w.lines.reduce((sum, l) => sum + heightOf(l) + l.gap * size.fs * 0.35, 0);
  let y = (size.h - total) / 2;
  const elements = w.lines.map((l, i): TextElement => {
    const e: TextElement = {
      id: `${w.key}-${i}`,
      type: 'text',
      x_mm: margin,
      y_mm: y,
      w_mm: width,
      rotation: 0,
      z: i,
      text: l.text,
      align: 'center',
      editable: true,
      label: l.label,
      ...(l.detail ? { detail: true } : {}),
      font: { family: l.family, weight: l.bold ? 700 : 400, size_pt: l.size * size.fs, color: w.color },
    };
    y += heightOf(l) + l.gap * size.fs * 0.35;
    return e;
  });
  const doc = validateDoc({ schema_version: 1, page: { width_mm: size.w, height_mm: size.h, background: '#FFFFFF' }, elements });
  if (!doc) throw new Error(`invalid wording ${w.key}`);
  return doc;
}

const backgroundOf = (image: ImageAsset, size: Size) => ({
  id: 'background',
  type: 'image' as const,
  x_mm: 0,
  y_mm: 0,
  w_mm: size.w,
  h_mm: size.h,
  rotation: 0,
  z: 0,
  asset_id: image.id,
  swappable: true,
  swapCategoryId: image.categoryId,
  label: 'רקע',
});

/** Writes the row again, keeping its status. Its preview no longer matches, so it goes: the editor makes a new one when an admin opens it. */
async function save(id: string, kind: Project['kind'], name: string, canvas: CanvasDoc) {
  const old = await getRow('projects', id);
  await removeThumbnail(id, old?.thumbnail);
  const project: Project = {
    id,
    kind,
    ownerId: '',
    status: old?.status ?? 'draft',
    name,
    topic: TOPIC,
    canvas,
    createdAt: old?.createdAt ?? now,
    updatedAt: new Date().toISOString(),
  };
  await setRow('projects', project);
}

async function removeProject(id: string) {
  const old = await getRow('projects', id);
  await removeThumbnail(id, old?.thumbnail);
  await deleteRow('projects', id);
}

async function remove() {
  for (const size of SIZES) {
    for (const [i, w] of WORDINGS.entries()) {
      await removeProject(stableId(`pilot:wording:${w.key}:${size.key}`));
      await removeProject(stableId(`pilot:card:${i}:${size.key}`));
    }
    for (const b of BACKGROUNDS) {
      const id = stableId(`pilot:image:${b.key}:${size.key}`);
      await deleteRow('images', id);
      await removeUploads([`${id}.jpg`]);
    }
  }
  await deleteRow('categories', stableId('pilot:category'));
  console.log('the pilot was removed');
}

async function main() {
  if (REMOVE) return remove();

  const categoryId = stableId('pilot:category');
  if (!(await getRow('categories', categoryId))) {
    const c: Category = { id: categoryId, name: `${TOPIC} (פיילוט)`, description: 'רקעים זמניים לפיילוט של הכרטיסים והנוסחים', createdAt: now };
    await setRow('categories', c);
  }

  let written = 0;
  for (const size of SIZES) {
    const [pw, ph] = size.px;
    const images: { asset: ImageAsset; raw: { data: Buffer; width: number; height: number } }[] = [];
    for (const b of BACKGROUNDS) {
      const id = stableId(`pilot:image:${b.key}:${size.key}`);
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}">${b.svg(pw, ph)}</svg>`);
      const jpeg = await sharp(svg).jpeg({ quality: 90 }).toBuffer();
      await saveUpload(`${id}.jpg`, jpeg, 'image/jpeg');
      const asset: ImageAsset = { id, categoryId, name: `${b.name} · ${size.label}`, file: `${id}.jpg`, width: pw, height: ph, createdAt: now };
      await setRow('images', asset);
      const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      images.push({ asset, raw: { data, width: info.width, height: info.height } });
    }

    for (const [i, w] of WORDINGS.entries()) {
      const wordingId = stableId(`pilot:wording:${w.key}:${size.key}`);
      const canvas = wordingCanvas(size, w);
      await save(wordingId, 'wording', w.name, { ...canvas, elements: [backgroundOf(images[i].asset, size), ...canvas.elements] });
      written++;

      // the ready card: this background with this wording, its colours matched as the editor would
      const cardId = stableId(`pilot:card:${i}:${size.key}`);
      const bare: CanvasDoc = { ...canvas, elements: [backgroundOf(images[i].asset, size)] };
      const card = validateDoc(fitDocColors(applyWording(bare, { id: wordingId, elements: wordingTexts(canvas) }), images[i].raw));
      if (!card) throw new Error(`invalid card ${i}`);
      await save(cardId, 'template', `${TOPIC} · ${w.name} · ${size.label}`, card);
      written++;
    }
  }
  console.log(`${written} drafts written (6 wordings, 6 cards), behind "${TOPIC}"`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
