/**
 * The starting sticker library: simple flat pictures on a transparent background, by profession, with tags the customer's
 * search and the "make me an ad" button find them by. They hold the place until the designer's arrive: the admin adds
 * those in "קטגוריות ותמונות", in a category marked as stickers. Re-running writes the same rows again.
 *
 *   npm run seed:stickers               create or update
 *   npm run seed:stickers -- --remove   delete everything this script created
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { deleteRow, getRow, removeUploads, saveUpload, setRow } from '../src/lib/db';
import { GENERAL_TAG } from '../src/lib/sticker';
import type { Category, ImageAsset } from '../src/lib/types';

const REMOVE = process.argv.includes('--remove');
const now = new Date().toISOString();
const SIZE = 512;

/** the same name always gives the same id, in the uuid shape upload file names need, so re-running finds what it made */
function stableId(name: string) {
  const h = createHash('sha256').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const NAVY = '#14336B';
const BLUE = '#3E7CC4';
const SKY = '#BFD9F2';
const GOLD = '#E8A33D';
const CREAM = '#FBF1DD';
const RED = '#D2483B';
const GREEN = '#2F8F63';
const MINT = '#BFE3CF';
const PINK = '#E58BA6';
const GREY = '#8A94A6';
const WHITE = '#FFFFFF';

const line = (d: string, color = NAVY, w = 6) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const shape = (d: string, color: string) => `<path d="${d}" fill="${color}"/>`;
const dot = (x: number, y: number, r: number, color: string) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const box = (x: number, y: number, w: number, h: number, color: string, r = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;

/** a five-pointed star or a burst, around (50,50) */
function points(n: number, outer: number, inner: number, cx = 50, cy = 50) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI * i) / n - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

const heartPath = 'M50 86C20 64 8 48 8 32 8 18 19 10 30 10c8 0 16 4 20 12 4-8 12-12 20-12 11 0 22 8 22 22 0 16-12 32-42 54Z';
const percent = (color: string) => line('M32 70 68 30', color, 8) + `<circle cx="34" cy="36" r="9" fill="none" stroke="${color}" stroke-width="7"/><circle cx="66" cy="64" r="9" fill="none" stroke="${color}" stroke-width="7"/>`;

/** every picture, on a 100×100 grid */
const ICONS: Record<string, string> = {
  burst: shape(points(14, 46, 36), RED) + percent(WHITE),
  star: shape(points(5, 44, 19), GOLD),
  heart: shape(heartPath, RED),
  check: dot(50, 50, 42, GREEN) + line('M30 52 45 66 72 36', WHITE, 9),
  phone: shape('M26 12 40 10l8 22-11 8c4 10 12 18 22 22l8-11 22 8-2 14c-1 7-7 12-14 11C43 80 20 57 15 26c-1-7 4-13 11-14Z', NAVY),
  pin: shape('M50 8c-18 0-32 14-32 32 0 24 32 54 32 54s32-30 32-54C82 22 68 8 50 8Z', RED) + dot(50, 40, 13, WHITE),
  clock: dot(50, 50, 42, NAVY) + dot(50, 50, 34, CREAM) + line('M50 28V52L66 62', NAVY, 7),
  gift: box(14, 42, 72, 46, RED) + box(8, 28, 84, 18, '#B7382C') + box(44, 28, 12, 60, GOLD, 0) + line('M50 28C36 8 18 14 26 26c3 4 14 2 24 2ZM50 28C64 8 82 14 74 26c-3 4-14 2-24 2Z', GOLD, 5),
  house: shape('M50 10 6 48h12v42h64V48h12Z', NAVY) + box(40, 58, 20, 32, GOLD, 2) + box(26, 52, 12, 12, SKY, 1) + box(62, 52, 12, 12, SKY, 1),
  key: `<circle cx="32" cy="36" r="20" fill="none" stroke="${GOLD}" stroke-width="11"/>` + line('M46 50 84 88M70 74 80 64M60 64 68 56', GOLD, 10),
  percentSign: dot(50, 50, 44, NAVY) + percent(GOLD),
  path: shape('M50 8 22 32v22h56V32Z', NAVY) + box(44, 40, 12, 14, GOLD, 1) + shape('M42 54h16l14 38H28Z', GOLD) + line('M50 62V68M50 76V84', WHITE, 4),
  coins: `<ellipse cx="50" cy="76" rx="34" ry="12" fill="${GOLD}"/><ellipse cx="50" cy="60" rx="34" ry="12" fill="#F2BC62"/><ellipse cx="50" cy="44" rx="34" ry="12" fill="${GOLD}"/><ellipse cx="50" cy="28" rx="34" ry="12" fill="#F7D08A"/>`,
  document: shape('M22 8h40l18 18v66H22Z', WHITE) + line('M22 8h40l18 18v66H22ZM62 8v18h18', NAVY, 5) + line('M34 44H68M34 58H68M34 72H54', GREY, 5),
  signature: shape('M22 8h40l18 18v66H22Z', WHITE) + line('M22 8h40l18 18v66H22Z', NAVY, 5) + line('M34 38H68M34 50H68', GREY, 5) + line('M32 76c8-14 12-14 14-4s6 8 10 0 8-6 12 2', BLUE, 5),
  ac: box(6, 22, 88, 34, WHITE, 8) + `<rect x="6" y="22" width="88" height="34" rx="8" fill="none" stroke="${NAVY}" stroke-width="5"/>` + line('M16 46H84', NAVY, 4) + line('M28 66c-4 6 4 10 0 16M50 66c-4 6 4 10 0 16M72 66c-4 6 4 10 0 16', BLUE, 5),
  snow: line('M50 8V92M14 29 86 71M14 71 86 29', BLUE, 7) + line('M38 14 50 26 62 14M38 86 50 74 62 86M12 44 28 38 22 22M78 78 72 62 88 56M12 56 28 62 22 78M78 22 72 38 88 44', BLUE, 5),
  thermometer: `<rect x="38" y="8" width="24" height="60" rx="12" fill="${WHITE}" stroke="${NAVY}" stroke-width="5"/>` + dot(50, 74, 18, RED) + box(45, 34, 10, 34, RED, 3),
  fan: dot(50, 50, 44, SKY) + shape('M50 50C34 40 34 16 50 14c12 2 12 24 0 36ZM50 50c16-10 38 2 36 16-4 12-24 8-36-16ZM50 50c0 18-20 32-34 24-8-10 8-26 34-24Z', BLUE) + dot(50, 50, 7, NAVY),
  wrench: shape('M66 8c-13 0-22 12-19 24L12 67c-6 6-6 15 0 21s15 6 21 0l35-35c12 3 24-6 24-19 0-3 0-5-1-8L76 41 60 37 56 21 74 9c-3-1-5-1-8-1Z', GREY),
  sun: shape(points(12, 46, 34), GOLD) + dot(50, 50, 24, '#F7D08A'),
  chart: line('M12 12V88H90', NAVY, 6) + box(24, 58, 14, 24, BLUE, 2) + box(46, 42, 14, 40, BLUE, 2) + box(68, 24, 14, 58, GOLD, 2),
  target: dot(50, 50, 44, RED) + dot(50, 50, 31, WHITE) + dot(50, 50, 18, RED) + dot(50, 50, 7, WHITE),
  puzzle: shape('M14 34h20c-6-14 4-24 14-24s20 10 14 24h24v22c-14-6-24 4-24 14s10 20 24 14v8H14V70c14 6 24-4 24-14s-10-20-24-14Z', BLUE),
  bulb: shape('M50 6C30 6 18 22 18 38c0 12 8 20 14 28 2 3 4 8 4 10h28c0-2 2-7 4-10 6-8 14-16 14-28C82 22 70 6 50 6Z', GOLD) + box(36, 78, 28, 7, GREY, 3) + box(40, 87, 20, 7, GREY, 3),
  briefcase: box(8, 30, 84, 58, NAVY, 7) + line('M36 30V20c0-4 2-6 6-6h16c4 0 6 2 6 6v10', NAVY, 6) + box(8, 54, 84, 5, GOLD, 0) + box(43, 49, 14, 14, GOLD, 2),
  chat: shape('M14 12h72c4 0 6 2 6 6v44c0 4-2 6-6 6H46L24 88V68H14c-4 0-6-2-6-6V18c0-4 2-6 6-6Z', BLUE) + dot(32, 40, 6, WHITE) + dot(50, 40, 6, WHITE) + dot(68, 40, 6, WHITE),
  cross: dot(50, 50, 44, WHITE) + `<circle cx="50" cy="50" r="42" fill="none" stroke="${RED}" stroke-width="5"/>` + box(40, 20, 20, 60, RED, 3) + box(20, 40, 60, 20, RED, 3),
  stethoscope: line('M26 10V38c0 14 10 22 22 22s22-8 22-22V10', NAVY, 7) + line('M48 60V70c0 10 8 16 18 16s14-6 14-16V62', NAVY, 7) + dot(80, 54, 10, RED) + dot(26, 10, 5, GREY) + dot(70, 10, 5, GREY),
  pulse: shape(heartPath, RED) + line('M14 46H36L44 30 54 62 62 46H86', WHITE, 6),
  pill: `<g transform="rotate(45 50 50)">${box(8, 32, 84, 36, WHITE, 18)}<path d="M50 32H26a18 18 0 0 0 0 36H50Z" fill="${RED}"/><rect x="8" y="32" width="84" height="36" rx="18" fill="none" stroke="${NAVY}" stroke-width="4"/></g>`,
  calendar: box(10, 18, 80, 72, WHITE, 8) + `<rect x="10" y="18" width="80" height="72" rx="8" fill="none" stroke="${NAVY}" stroke-width="5"/>` + box(10, 18, 80, 20, BLUE, 6) + box(26, 8, 8, 18, NAVY, 3) + box(66, 8, 8, 18, NAVY, 3) + line('M32 62 45 74 68 50', GREEN, 7),
  scales: line('M50 12V84M14 24H86M30 88H70', NAVY, 6) + line('M14 24 4 56M14 24 24 56M86 24 76 56M86 24 96 56', NAVY, 3) + shape('M2 56H26C26 66 2 66 2 56ZM74 56H98C98 66 74 66 74 56Z', GOLD),
  gavel: `<g transform="rotate(-40 50 50)">${box(22, 18, 44, 24, NAVY, 3)}${box(38, 42, 12, 46, GOLD, 3)}</g>` + box(52, 78, 42, 10, NAVY, 3),
  shield: shape('M50 6 12 20v28c0 22 16 38 38 46 22-8 38-24 38-46V20Z', NAVY) + line('M32 50 46 64 70 36', WHITE, 8),
  pen: `<g transform="rotate(45 50 50)">${box(40, 2, 20, 66, BLUE, 3)}${box(40, 12, 20, 6, WHITE, 0)}<path d="M40 68H60L50 94Z" fill="${CREAM}"/><path d="M46 84H54L50 94Z" fill="${NAVY}"/></g>`,
  book: shape('M50 22C38 12 22 12 8 16v68c14-4 30-4 42 6 12-10 28-10 42-6V16C78 12 62 12 50 22Z', NAVY) + line('M50 22V90', GOLD, 4) + line('M18 32c8-2 16-2 24 2M18 46c8-2 16-2 24 2M58 34c8-4 16-4 24-2M58 48c8-4 16-4 24-2', SKY, 3),
  building: box(24, 8, 52, 84, NAVY, 3) + [20, 36, 52].flatMap((y) => [34, 56].map((x) => box(x, y, 11, 10, SKY, 1))).join('') + box(42, 70, 16, 22, GOLD, 1),
  forSale: box(46, 8, 8, 84, GREY, 2) + box(12, 18, 76, 44, GOLD, 4) + line('M28 34H72M28 46H58', NAVY, 6),
  umbrella: shape('M50 12C24 12 6 30 4 54c8-8 16-8 23 0 7-8 16-8 23 0 7-8 16-8 23 0 7-8 15-8 23 0-2-24-20-42-46-42Z', BLUE) + line('M50 54V82c0 10-16 10-16 0', NAVY, 6) + line('M50 12V6', NAVY, 5),
  car: shape('M16 52 26 26c2-4 4-6 8-6h32c4 0 6 2 8 6l10 26c6 0 10 4 10 10v14H6V62c0-6 4-10 10-10Z', BLUE) + shape('M28 50 34 30h14v20ZM54 50V30h12l6 20Z', SKY) + dot(26, 78, 11, NAVY) + dot(74, 78, 11, NAVY) + dot(26, 78, 4, WHITE) + dot(74, 78, 4, WHITE),
  flower: [0, 72, 144, 216, 288].map((a) => `<ellipse cx="50" cy="26" rx="15" ry="22" fill="${PINK}" transform="rotate(${a} 50 50)"/>`).join('') + dot(50, 50, 13, GOLD),
  mirror: `<ellipse cx="50" cy="36" rx="30" ry="30" fill="${SKY}" stroke="${GOLD}" stroke-width="7"/>` + box(44, 66, 12, 28, GOLD, 4) + line('M36 28c3-5 7-8 13-9', WHITE, 5),
  polish: box(36, 8, 28, 38, NAVY, 4) + shape('M30 46H70l6 12v26c0 5-3 8-8 8H32c-5 0-8-3-8-8V58Z', RED) + line('M36 62V82', WHITE, 4),
  scissors: `<circle cx="26" cy="74" r="14" fill="none" stroke="${RED}" stroke-width="7"/><circle cx="74" cy="74" r="14" fill="none" stroke="${RED}" stroke-width="7"/>` + line('M34 62 72 8M66 62 28 8', GREY, 7) + dot(50, 40, 4, NAVY),
  sparkle: shape(points(4, 44, 9), GOLD) + shape(points(4, 15, 3, 80, 22), PINK) + shape(points(4, 11, 3, 20, 78), MINT),
};

type Sticker = { icon: keyof typeof ICONS; name: string; tags: string };

/** each profession's own, then what suits any design; the tags are the words people search with */
const LIBRARY: { topic: string; stickers: Sticker[] }[] = [
  {
    topic: GENERAL_TAG,
    stickers: [
      { icon: 'burst', name: 'מבצע', tags: 'מבצע הנחה אחוזים' },
      { icon: 'star', name: 'כוכב', tags: 'כוכב מומלץ איכות' },
      { icon: 'heart', name: 'לב', tags: 'לב אהבה תודה' },
      { icon: 'check', name: 'וי', tags: 'וי אישור בטוח' },
      { icon: 'phone', name: 'טלפון', tags: 'טלפון התקשרו שיחה' },
      { icon: 'pin', name: 'מיקום', tags: 'מיקום כתובת מפה' },
      { icon: 'clock', name: 'שעון', tags: 'שעון זמן שעות דחוף' },
      { icon: 'gift', name: 'מתנה', tags: 'מתנה הפתעה חג' },
    ],
  },
  {
    topic: 'ייעוץ משכנתאות',
    stickers: [
      { icon: 'house', name: 'בית', tags: 'בית דירה נכס' },
      { icon: 'key', name: 'מפתח', tags: 'מפתח דירה חדשה רכישה' },
      { icon: 'percentSign', name: 'ריבית', tags: 'ריבית אחוזים מסלול' },
      { icon: 'path', name: 'הדרך לבית', tags: 'דרך שביל ליווי בית' },
      { icon: 'coins', name: 'מטבעות', tags: 'כסף חיסכון החזר' },
      { icon: 'signature', name: 'חתימה', tags: 'חתימה חוזה אישור' },
    ],
  },
  {
    topic: 'מיזוג אוויר',
    stickers: [
      { icon: 'ac', name: 'מזגן', tags: 'מזגן התקנה מיזוג' },
      { icon: 'snow', name: 'קור', tags: 'קור קיץ שלג' },
      { icon: 'thermometer', name: 'מדחום', tags: 'מדחום חום טמפרטורה' },
      { icon: 'fan', name: 'מאוורר', tags: 'מאוורר אוויר ניקוי' },
      { icon: 'wrench', name: 'מפתח שוודי', tags: 'תיקון שירות טכנאי' },
      { icon: 'sun', name: 'שמש', tags: 'שמש קיץ חום' },
    ],
  },
  {
    topic: 'ייעוץ עסקי',
    stickers: [
      { icon: 'chart', name: 'גרף', tags: 'גרף צמיחה רווח' },
      { icon: 'target', name: 'מטרה', tags: 'מטרה יעד דיוק' },
      { icon: 'puzzle', name: 'פאזל', tags: 'פאזל פתרון סדר' },
      { icon: 'bulb', name: 'נורה', tags: 'נורה רעיון' },
      { icon: 'briefcase', name: 'תיק', tags: 'תיק עסק משרד' },
      { icon: 'chat', name: 'שיחה', tags: 'שיחה פגישה ייעוץ' },
    ],
  },
  {
    topic: 'רפואה פרטית',
    stickers: [
      { icon: 'cross', name: 'צלב רפואי', tags: 'רפואה מרפאה' },
      { icon: 'stethoscope', name: 'סטטוסקופ', tags: 'רופא בדיקה' },
      { icon: 'pulse', name: 'דופק', tags: 'דופק לב בריאות' },
      { icon: 'pill', name: 'כדור', tags: 'תרופה טיפול' },
      { icon: 'calendar', name: 'תור', tags: 'תור יומן פגישה' },
      { icon: 'house', name: 'ביקור בית', tags: 'בית ביקור בית' },
    ],
  },
  {
    topic: 'עורכי דין',
    stickers: [
      { icon: 'scales', name: 'מאזניים', tags: 'מאזניים צדק משפט' },
      { icon: 'gavel', name: 'פטיש', tags: 'פטיש בית משפט' },
      { icon: 'shield', name: 'מגן', tags: 'מגן הגנה זכויות' },
      { icon: 'document', name: 'מסמך', tags: 'מסמך חוזה' },
      { icon: 'pen', name: 'עט', tags: 'עט חתימה' },
      { icon: 'book', name: 'ספר', tags: 'ספר חוק' },
    ],
  },
  {
    topic: 'נדל"ן ותיווך',
    stickers: [
      { icon: 'building', name: 'בניין', tags: 'בניין דירה' },
      { icon: 'house', name: 'בית', tags: 'בית נכס' },
      { icon: 'key', name: 'מפתח', tags: 'מפתח מסירה' },
      { icon: 'forSale', name: 'שלט', tags: 'שלט למכירה להשכרה' },
      { icon: 'pin', name: 'מיקום', tags: 'מיקום אזור שכונה' },
      { icon: 'coins', name: 'מטבעות', tags: 'מחיר השקעה כסף' },
    ],
  },
  {
    topic: 'ביטוח',
    stickers: [
      { icon: 'shield', name: 'מגן', tags: 'מגן הגנה ביטוח' },
      { icon: 'umbrella', name: 'מטרייה', tags: 'מטרייה הגנה' },
      { icon: 'car', name: 'רכב', tags: 'רכב ביטוח רכב' },
      { icon: 'pulse', name: 'בריאות', tags: 'בריאות לב חיים' },
      { icon: 'house', name: 'דירה', tags: 'דירה מבנה רכוש' },
      { icon: 'document', name: 'פוליסה', tags: 'פוליסה תביעה' },
    ],
  },
  {
    topic: 'קוסמטיקה ויופי',
    stickers: [
      { icon: 'flower', name: 'פרח', tags: 'פרח טיפוח' },
      { icon: 'mirror', name: 'מראה', tags: 'מראה יופי' },
      { icon: 'polish', name: 'לק', tags: 'לק ציפורניים מניקור' },
      { icon: 'scissors', name: 'מספריים', tags: 'מספריים תספורת' },
      { icon: 'sparkle', name: 'ניצוץ', tags: 'ניצוץ זוהר טיפול פנים' },
      { icon: 'gift', name: 'מתנה', tags: 'מתנה שובר' },
    ],
  },
];

const CATEGORY_ID = stableId('stickers:category');
const stickerId = (topic: string, icon: string) => stableId(`sticker:${topic}:${icon}`);

async function remove() {
  for (const { topic, stickers } of LIBRARY) {
    for (const s of stickers) {
      const id = stickerId(topic, s.icon);
      await deleteRow('images', id);
      await removeUploads([`${id}.png`]);
    }
  }
  await deleteRow('categories', CATEGORY_ID);
  console.log('the starting stickers were removed');
}

async function main() {
  if (REMOVE) return remove();
  if (!(await getRow('categories', CATEGORY_ID))) {
    const c: Category = { id: CATEGORY_ID, name: 'מדבקות', description: 'מדבקות התחלתיות, עד שיגיעו מדבקות מהמעצב', createdAt: now, stickers: true };
    await setRow('categories', c);
  }
  let written = 0;
  for (const { topic, stickers } of LIBRARY) {
    for (const s of stickers) {
      const id = stickerId(topic, s.icon);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}">${ICONS[s.icon]}</svg>`;
      await saveUpload(`${id}.png`, await sharp(Buffer.from(svg)).png().toBuffer(), 'image/png');
      const image: ImageAsset = { id, categoryId: CATEGORY_ID, name: s.name, file: `${id}.png`, width: SIZE, height: SIZE, createdAt: now, sticker: true, tags: [topic, ...s.tags.split(' ')] };
      await setRow('images', image);
      written++;
    }
  }
  console.log(`${written} stickers written`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
