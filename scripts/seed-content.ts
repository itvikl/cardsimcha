/**
 * Creates the site's starting content: ads by profession, logos, Shabbat designs, greetings and a simcha set, with the
 * library pictures they use. Re-running skips what exists, so an admin's changes stay; --force writes the designs again.
 *
 *   npm run seed:content                 published right away
 *   npm run seed:content -- --draft      as drafts, for the client to review first
 *   npm run seed:content -- --force=ad:  writes again only the designs whose key starts with that
 *   npm run seed:content -- --only=simcha --force=simcha:  only the simcha set, leaving the rest alone
 *
 * New templates have no preview picture: the editor makes one the first time an admin opens them.
 * The wording comes from src/lib/professions.ts and needs the client's approval before going live.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { AD_FORMATS } from '../src/lib/adFormats';
import { heightOf, linesOf } from '../src/lib/adText';
import { brandColor } from '../src/lib/brand';
import { validateDoc } from '../src/lib/canvas';
import { audienceOf, CATEGORIES, LOGO_TOPIC } from '../src/lib/categories';
import { getRow, saveUpload, setRow, updateDb } from '../src/lib/db';
import { PROFESSIONS, type AdCopy } from '../src/lib/professions';
import { SHABBAT_TOPIC } from '../src/lib/shabbatDoc';
import type { BrandColorRole, BrandTextRole, CanvasDoc, CanvasElement, Category, ImageAsset, Project, ShabbatTextRole, TextElement } from '../src/lib/types';

const FORCE = process.argv.includes('--force');
const FORCE_PREFIX = process.argv.find((a) => a.startsWith('--force='))?.slice('--force='.length);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const STATUS: Project['status'] = process.argv.includes('--draft') ? 'draft' : 'published';
const ASSETS = path.join(process.cwd(), 'scripts', 'seed-assets');

/** the same name always gives the same id, in the uuid shape upload file names need, so re-running finds what it made */
function stableId(name: string) {
  const h = createHash('sha256').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const now = new Date().toISOString();

/* ------------------------------------------------------------------ library */

async function ensureCategory(name: string, description: string): Promise<string> {
  const id = stableId('category:' + name);
  if (!(await getRow('categories', id))) {
    const row: Category = { id, name, description, createdAt: now };
    await setRow('categories', row);
  }
  return id;
}

async function ensureImage(categoryId: string, key: string, name: string, data: () => Promise<Buffer>, mime: 'image/jpeg' | 'image/png') {
  const id = stableId('image:' + key);
  const old = await getRow('images', id);
  if (old) return old;
  const buffer = await data();
  const meta = await sharp(buffer).metadata();
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  await saveUpload(id + ext, buffer, mime);
  const row: ImageAsset = { id, categoryId, name, file: id + ext, width: meta.width!, height: meta.height!, createdAt: now };
  await setRow('images', row);
  return row;
}

const fromFile = (file: string) => async () => readFileSync(path.join(ASSETS, file));

/** the colours a template shows until a business's kit replaces them */
const SAMPLE = { primaryColor: '#14336B', secondaryColor: '#E8A33D' };

/**
 * A neutral mark standing where a business's logo goes; a business's own copy replaces it. A template's picture fills
 * its box, so each shape of box gets a picture of its shape, with the mark in proportion inside it.
 */
const SAMPLE_LOGO_RATIOS = [2.2, 1.6, 1.15];
const sampleLogo = (ratio: number) => () => {
  const h = 300;
  const w = Math.round(h * ratio);
  const wide = ratio >= 1.5;
  const x = wide ? Math.round((w - 600) / 2) : Math.round((w - 300) / 2);
  const bars = wide
    ? `<rect x="${x + 340}" y="90" width="240" height="44" rx="22" fill="${SAMPLE.primaryColor}"/><rect x="${x + 340}" y="166" width="170" height="44" rx="22" fill="${SAMPLE.secondaryColor}"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${x}" width="300" height="300" rx="70" fill="${SAMPLE.primaryColor}"/><circle cx="${x + 150}" cy="150" r="80" fill="${SAMPLE.secondaryColor}"/>${bars}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

/* ------------------------------------------------------------------ building blocks */

const PT_TO_MM = 25.4 / 72;
let counter = 0;
const nextId = () => `e${++counter}`;

type TextOpts = {
  x: number;
  y: number;
  w: number;
  text: string;
  size: number;
  color?: string;
  colorRole?: BrandColorRole;
  family?: string;
  bold?: boolean;
  align?: TextElement['align'];
  label?: string;
  role?: BrandTextRole;
  shabbatRole?: ShabbatTextRole;
  credit?: boolean;
  detail?: boolean;
};

function text(o: TextOpts): CanvasElement {
  const e: TextElement = {
    id: nextId(),
    type: 'text',
    x_mm: o.x,
    y_mm: o.y,
    w_mm: o.w,
    rotation: 0,
    z: 0,
    text: o.text,
    align: o.align ?? 'center',
    font: { family: o.family ?? 'Heebo', weight: o.bold ? 700 : 400, size_pt: o.size, color: o.color ?? (o.colorRole ? brandColor(SAMPLE, o.colorRole) : '#111111') },
  };
  if (o.label) {
    e.editable = true;
    e.label = o.label;
  }
  if (o.role) e.role = o.role;
  if (o.colorRole) e.colorRole = o.colorRole;
  if (o.shabbatRole) e.shabbatRole = o.shabbatRole;
  if (o.credit) e.credit = true;
  if (o.detail) e.detail = true;
  return e;
}

function rect(x: number, y: number, w: number, h: number, fill: string, o: { colorRole?: BrandColorRole; radius?: number; opacity?: number; rotation?: number; logoPlate?: boolean } = {}): CanvasElement {
  return {
    id: nextId(),
    type: 'rect',
    x_mm: x,
    y_mm: y,
    // a design's boxes are at least 1 mm (see validateDoc)
    w_mm: Math.max(1, w),
    h_mm: Math.max(1, h),
    rotation: o.rotation ?? 0,
    z: 0,
    fill,
    ...(o.colorRole && { colorRole: o.colorRole }),
    ...(o.logoPlate && { role: 'logoPlate' as const }),
    ...(o.radius !== undefined && { cornerRadius_mm: o.radius }),
    ...(o.opacity !== undefined && { opacity: o.opacity }),
  };
}

/** a picture covering the box, centred; what falls outside the page is cut, and what falls below is hidden by what is drawn over it */
function cover(asset: ImageAsset, x: number, y: number, w: number, h: number, extra: { loopId?: string } = {}): CanvasElement {
  const scale = Math.max(w / asset.width, h / asset.height);
  const iw = asset.width * scale;
  const ih = asset.height * scale;
  return { id: nextId(), type: 'image', x_mm: x + (w - iw) / 2, y_mm: y + (h - ih) / 2, w_mm: iw, h_mm: ih, rotation: 0, z: 0, asset_id: asset.id, ...extra };
}

/** an ad's photograph: the same, marked so a picture from the business's catalog can take its place */
const adCover = (asset: ImageAsset, x: number, y: number, w: number, h: number): CanvasElement => ({
  ...cover(asset, x, y, w, h),
  role: 'photo',
  photoBox: { x_mm: x, y_mm: y, w_mm: w, h_mm: h },
} as CanvasElement);

type Logos = ImageAsset[];

/** the place of the business's logo, showing the sample whose shape is closest to the box */
const logoBox = (logos: Logos, x: number, y: number, w: number, h: number): CanvasElement => {
  const distance = (a: ImageAsset) => Math.abs(a.width / a.height - w / h);
  const asset = logos.reduce((best, a) => (distance(a) < distance(best) ? a : best));
  return { id: nextId(), type: 'image', x_mm: x, y_mm: y, w_mm: w, h_mm: h, rotation: 0, z: 0, asset_id: asset.id, role: 'logo' };
};

/** the largest headline size, from `base` down to two thirds of it, that takes no more than `room` mm; null when none does */
function fitHeadline(t: string, base: number, widthMm: number, room: number) {
  for (let size = base; size >= base * 0.66; size -= 1) if (heightOf(t, size, widthMm) <= room) return size;
  return null;
}

function doc(width_mm: number, height_mm: number, background: string, elements: CanvasElement[]): CanvasDoc {
  const d = validateDoc({ schema_version: 1, page: { width_mm, height_mm, background }, elements: elements.map((e, i) => ({ ...e, z: i })) });
  if (!d) throw new Error('invalid design');
  return d;
}

type Format = { w: number; h: number; u: number; fs: number; photo: number };
const STORY: Format = { w: 108, h: 192, u: 1, fs: 1, photo: 0.44 };
const SQUARE: Format = { w: 200, h: 200, u: 1.85, fs: 1.42, photo: 0.34 };
const A4: Format = { w: 210, h: 297, u: 1.94, fs: 1.85, photo: 0.33 };
const A5: Format = { w: 148, h: 210, u: 1.37, fs: 1.305, photo: 0.33 };
const A6: Format = { w: 105, h: 148, u: 0.97, fs: 0.925, photo: 0.33 };

/** the business's details at the foot of an ad */
function contactBar(f: Format, y: number, on: BrandColorRole): CanvasElement[] {
  const { w, u, fs } = f;
  return [
    text({ x: 7 * u, y, w: w - 14 * u, text: 'שם העסק', size: 13 * fs, bold: true, colorRole: on, role: 'businessName', label: 'שם העסק' }),
    text({ x: 7 * u, y: y + 7 * fs, w: w - 14 * u, text: '050-0000000', size: 17 * fs, bold: true, colorRole: on, role: 'phone', label: 'טלפון', family: 'Secular One' }),
  ];
}

function pill(f: Format, y: number, cta: string): CanvasElement[] {
  const { w, u, fs } = f;
  const pw = 62 * u;
  const ph = 12.5 * fs;
  return [
    rect((w - pw) / 2, y, pw, ph, '#E8A33D', { colorRole: 'secondaryColor', radius: ph / 2 }),
    text({ x: (w - pw) / 2, y: y + 2.9 * fs, w: pw, text: cta, size: 15 * fs, bold: true, colorRole: 'onSecondary', label: 'קריאה לפעולה' }),
  ];
}

function points(f: Format, x: number, y: number, width: number, items: string[], on: BrandColorRole): { els: CanvasElement[]; y: number } {
  const { fs } = f;
  const size = 13 * fs;
  const row = Math.max(8.2 * fs, size * PT_TO_MM * 1.25 + 2.4 * fs);
  const dot = 5.6 * fs;
  const els: CanvasElement[] = [];
  let cy = y;
  items.forEach((p, i) => {
    els.push(rect(x + width - dot, cy, dot, dot, '#E8A33D', { colorRole: 'secondaryColor', radius: dot / 2 }));
    els.push(text({ x: x + width - dot, y: cy + 0.9 * fs, w: dot, text: '✓', size: 9.5 * fs, bold: true, colorRole: 'onSecondary', family: 'Arial' }));
    els.push(text({ x, y: cy - 0.3 * fs, w: width - dot - 2.4 * fs, text: p, size, align: 'right', colorRole: on, label: `נקודה ${i + 1}` }));
    cy += row * Math.max(1, linesOf(p, size, width - dot - 2.4 * fs));
  });
  return { els, y: cy };
}

/* ------------------------------------------------------------------ ad layouts */

/** a photograph above, the message on the business's colour below */
function adPhoto(f: Format, ad: AdCopy, photo: ImageAsset, logo: Logos): CanvasDoc {
  const { w, h, u, fs } = f;
  const top = h * f.photo;
  const margin = 7 * u;
  const width = w - margin * 2;
  const subSize = 13.5 * fs;
  const chipW = 38 * u;
  const chipH = 26 * u;
  let y = top + 6 * fs;
  const foot = h - 21 * fs - 5 * u;
  const pillY = foot - 16 * fs;
  // what stays for the headline once the rest has its place: the list goes only if a readable headline fits beside it
  const room = pillY - y - 3 * fs - heightOf(ad.sub, subSize, width) - 5 * fs;
  const listH = points(f, 0, 0, width - 12 * u, ad.points, 'onPrimary').y + 3 * fs;
  const withList = fitHeadline(ad.headline, 25 * fs, width, room - listH);
  const headSize = withList ?? fitHeadline(ad.headline, 25 * fs, width, room) ?? 16 * fs;
  const els: CanvasElement[] = [
    adCover(photo, 0, 0, w, top + 4),
    rect(0, top, w, h - top, '#14336B', { colorRole: 'primaryColor' }),
    rect(0, top - 1.6 * fs, w, 3.2 * fs, '#E8A33D', { colorRole: 'secondaryColor' }),
    rect(w - margin - chipW, margin, chipW, chipH, '#FFFFFF', { radius: 3.5 * u, logoPlate: true }),
    logoBox(logo, w - margin - chipW + 2.5 * u, margin + 2 * u, chipW - 5 * u, chipH - 4 * u),
    text({ x: margin, y, w: width, text: ad.headline, size: headSize, family: 'Secular One', colorRole: 'onPrimary', label: 'כותרת' }),
  ];
  y += heightOf(ad.headline, headSize, width) + 3 * fs;
  els.push(text({ x: margin, y, w: width, text: ad.sub, size: subSize, colorRole: 'onPrimary', label: 'משפט משנה' }));
  y += heightOf(ad.sub, subSize, width) + 5 * fs;
  if (withList) els.push(...points(f, margin + 6 * u, y, width - 12 * u, ad.points, 'onPrimary').els);
  els.push(...pill(f, pillY, ad.cta));
  els.push(...contactBar(f, foot, 'onPrimary'));
  return doc(w, h, '#14336B', els);
}

/** big words on the business's colour */
function adType(f: Format, ad: AdCopy, logo: Logos): CanvasDoc {
  const { w, h, u, fs } = f;
  const margin = 8 * u;
  const width = w - margin * 2;
  const subSize = 14 * fs;
  const logoH = 24 * u;
  let y = margin + logoH + 8 * fs;
  const foot = h - 21 * fs - 6 * u;
  const pillY = foot - 16 * fs;
  const room = pillY - y - 3 * fs - 6 * fs - heightOf(ad.sub, subSize, width) - 6 * fs;
  const listH = points(f, 0, 0, width - 8 * u, ad.points, 'onPrimary').y + 3 * fs;
  const withList = fitHeadline(ad.headline, 33 * fs, width, room - listH);
  const headSize = withList ?? fitHeadline(ad.headline, 33 * fs, width, room) ?? 20 * fs;
  const els: CanvasElement[] = [
    rect(0, 0, w, h, '#14336B', { colorRole: 'primaryColor' }),
    rect(-w * 0.3, -w * 0.3, w * 0.85, w * 0.85, '#E8A33D', { colorRole: 'secondaryColor', radius: w * 0.425, opacity: 0.16 }),
    rect(w * 0.55, h - w * 0.5, w * 0.8, w * 0.8, '#FFFFFF', { radius: w * 0.4, opacity: 0.06 }),
    rect((w - 44 * u) / 2, margin - 2 * u, 44 * u, logoH + 4 * u, '#FFFFFF', { radius: 4 * u, logoPlate: true }),
    logoBox(logo, (w - 40 * u) / 2, margin, 40 * u, logoH),
    text({ x: margin, y, w: width, text: ad.headline, size: headSize, family: 'Secular One', colorRole: 'onPrimary', label: 'כותרת' }),
  ];
  y += heightOf(ad.headline, headSize, width) + 3 * fs;
  els.push(rect((w - 26 * u) / 2, y, 26 * u, 1.6 * fs, '#E8A33D', { colorRole: 'secondaryColor', radius: 0.8 * fs }));
  y += 6 * fs;
  els.push(text({ x: margin, y, w: width, text: ad.sub, size: subSize, colorRole: 'onPrimary', label: 'משפט משנה' }));
  y += heightOf(ad.sub, subSize, width) + 6 * fs;
  if (withList) els.push(...points(f, margin + 4 * u, y, width - 8 * u, ad.points, 'onPrimary').els);
  els.push(...pill(f, pillY, ad.cta));
  els.push(...contactBar(f, foot, 'onPrimary'));
  return doc(w, h, '#14336B', els);
}

/** a clean white page: the message in a band, a list, a photograph and the details */
function adList(f: Format, ad: AdCopy, photo: ImageAsset, logo: Logos): CanvasDoc {
  const { w, h, u, fs } = f;
  const margin = 7 * u;
  const width = w - margin * 2;
  const headSize = 25 * fs;
  const bandH = 16 * fs + heightOf(ad.headline, headSize, width - 40 * u) + 3 * fs;
  const barH = 27 * fs;
  const top: CanvasElement[] = [
    rect(0, 0, w, bandH, '#14336B', { colorRole: 'primaryColor' }),
    rect(margin, (bandH - 24 * u) / 2, 34 * u, 24 * u, '#FFFFFF', { radius: 3.5 * u, logoPlate: true }),
    logoBox(logo, margin + 2.5 * u, (bandH - 18 * u) / 2, 29 * u, 18 * u),
    text({ x: margin + 37 * u, y: 8 * fs, w: width - 37 * u, text: ad.headline, size: headSize, family: 'Secular One', align: 'right', colorRole: 'onPrimary', label: 'כותרת' }),
  ];
  let y = bandH + 6 * fs;
  top.push(text({ x: margin, y, w: width, text: ad.sub, size: 14 * fs, align: 'right', color: '#222222', label: 'משפט משנה' }));
  y += heightOf(ad.sub, 14 * fs, width) + 5 * fs;
  const list = points(f, margin, y, width, ad.points, 'primaryColor');
  top.push(...list.els);
  y = list.y + 3 * fs;
  const bottom = h - barH;
  // the photo goes first, under everything: the white above it and the bar below it hide whatever it overflows
  const photoRoom = bottom - y;
  const under = photoRoom > 24 * fs ? [adCover(photo, 0, y, w, photoRoom)] : [];
  const els = [...under, rect(0, 0, w, y, '#FFFFFF'), ...top, ...pill(f, bottom - 15.5 * fs, ad.cta), rect(0, bottom, w, barH, '#14336B', { colorRole: 'primaryColor' }), ...contactBar(f, bottom + 4 * fs, 'onPrimary')];
  return doc(w, h, '#FFFFFF', els);
}

/* ------------------------------------------------------------------ logos */

const logoDesigns: { key: string; name: string; build: () => CanvasDoc }[] = [
  {
    key: 'round',
    name: 'לוגו עגול',
    build: () =>
      doc(200, 200, '#FFFFFF', [
        rect(50, 22, 100, 100, '#14336B', { colorRole: 'primaryColor', radius: 50 }),
        text({ x: 50, y: 42, w: 100, text: 'ע', size: 150, family: 'Secular One', colorRole: 'onPrimary', role: 'initial' }),
        text({ x: 10, y: 130, w: 180, text: 'שם העסק', size: 56, family: 'Secular One', colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
        text({ x: 10, y: 160, w: 180, text: 'סלוגן קצר', size: 26, colorRole: 'primaryColor', role: 'slogan', label: 'סלוגן' }),
      ]),
  },
  {
    key: 'side',
    name: 'לוגו צדדי',
    build: () =>
      doc(200, 100, '#FFFFFF', [
        rect(150, 22, 44, 44, '#14336B', { colorRole: 'primaryColor', radius: 9 }),
        text({ x: 150, y: 28, w: 44, text: 'ע', size: 74, family: 'Secular One', colorRole: 'onPrimary', role: 'initial' }),
        text({ x: 4, y: 22, w: 140, text: 'שם העסק', size: 46, family: 'Secular One', align: 'right', colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
        text({ x: 4, y: 48, w: 140, text: 'סלוגן קצר', size: 20, align: 'right', colorRole: 'primaryColor', role: 'slogan', label: 'סלוגן' }),
      ]),
  },
  {
    key: 'word',
    name: 'לוגו מילה',
    build: () =>
      doc(200, 100, '#FFFFFF', [
        text({ x: 5, y: 18, w: 190, text: 'שם העסק', size: 62, family: 'Frank Ruhl Libre', bold: true, colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
        rect(60, 52, 80, 2.4, '#E8A33D', { colorRole: 'secondaryColor', radius: 1.2 }),
        text({ x: 5, y: 58, w: 190, text: 'סלוגן קצר', size: 22, colorRole: 'primaryColor', role: 'slogan', label: 'סלוגן' }),
      ]),
  },
  {
    key: 'badge',
    name: 'לוגו תג',
    build: () =>
      doc(200, 100, '#FFFFFF', [
        rect(6, 18, 188, 44, '#14336B', { colorRole: 'primaryColor', radius: 22 }),
        text({ x: 12, y: 26, w: 176, text: 'שם העסק', size: 56, family: 'Secular One', colorRole: 'onPrimary', role: 'businessName', label: 'שם העסק' }),
        text({ x: 6, y: 67, w: 188, text: 'סלוגן קצר', size: 22, colorRole: 'primaryColor', role: 'slogan', label: 'סלוגן' }),
      ]),
  },
  {
    key: 'diamond',
    name: 'לוגו יהלום',
    build: () =>
      doc(200, 200, '#FFFFFF', [
        // a square turned 45 degrees around its top-left corner, whose centre ends up at x=100, y=72
        rect(100, 22, 70.7, 70.7, '#14336B', { colorRole: 'primaryColor', radius: 8, rotation: 45 }),
        text({ x: 60, y: 44, w: 80, text: 'ע', size: 118, family: 'Secular One', colorRole: 'onPrimary', role: 'initial' }),
        text({ x: 10, y: 130, w: 180, text: 'שם העסק', size: 56, family: 'Secular One', colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
        text({ x: 10, y: 160, w: 180, text: 'סלוגן קצר', size: 26, colorRole: 'primaryColor', role: 'slogan', label: 'סלוגן' }),
      ]),
  },
  {
    key: 'frame',
    name: 'לוגו מסגרת',
    build: () =>
      doc(200, 200, '#FFFFFF', [
        rect(24, 44, 152, 92, '#14336B', { colorRole: 'primaryColor', radius: 6 }),
        rect(28, 48, 144, 84, '#FFFFFF', { radius: 3 }),
        text({ x: 30, y: 66, w: 140, text: 'שם העסק', size: 54, family: 'Secular One', colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
        rect(74, 96, 52, 2.2, '#E8A33D', { colorRole: 'secondaryColor', radius: 1.1 }),
        text({ x: 30, y: 102, w: 140, text: 'סלוגן קצר', size: 22, colorRole: 'primaryColor', role: 'slogan', label: 'סלוגן' }),
      ]),
  },
];

/* ------------------------------------------------------------------ Shabbat */

const LOOPS: { id: string; name: string; panel: string; on: string; accent: string }[] = [
  { id: 'candles', name: 'נרות', panel: '#120C06', on: '#FFF8EA', accent: '#F0C676' },
  { id: 'table', name: 'שולחן שבת', panel: '#1A0F08', on: '#FFF8EA', accent: '#F0C676' },
  { id: 'jerusalem', name: 'ירושלים', panel: '#0E1A33', on: '#FFFFFF', accent: '#F4C779' },
  { id: 'gold', name: 'אבק זהב', panel: '#070E24', on: '#FFFFFF', accent: '#E9C46A' },
  { id: 'stars', name: 'כוכבים', panel: '#060C1E', on: '#FFFFFF', accent: '#BFD2FF' },
  { id: 'silk', name: 'משי', panel: '#FFF9EE', on: '#2A1F12', accent: '#8A6A2F' },
];

const timesBlock = (x: number, y: number, w: number, on: string, accent: string, size: number): CanvasElement[] => {
  const half = w / 2;
  return [
    text({ x: x + half, y, w: half, text: 'הדלקת נרות', size: size * 0.62, color: accent, bold: true }),
    text({ x: x + half, y: y + size * 0.3, w: half, text: '16:05', size, family: 'Secular One', color: on, shabbatRole: 'candles' }),
    text({ x, y, w: half, text: 'צאת השבת', size: size * 0.62, color: accent, bold: true }),
    text({ x, y: y + size * 0.3, w: half, text: '17:25', size, family: 'Secular One', color: on, shabbatRole: 'havdalah' }),
  ];
};

const creditLine = (w: number, y: number, color: string, size = 6.5) => text({ x: 6, y, w: w - 12, text: 'נוצר בסטודיו עיצוב', size, color, credit: true });

/** a vertical status: the moving background, and over it the week's times and the business's details */
function shabbatStory(loop: (typeof LOOPS)[number], still: ImageAsset, logo: Logos): CanvasDoc {
  const w = 108;
  const h = 192;
  const panelY = 66;
  const panelH = 72;
  const footY = 146;
  return doc(w, h, loop.panel, [
    cover(still, 0, 0, w, h, { loopId: loop.id }),
    rect(6, panelY, w - 12, panelH, loop.panel, { radius: 5, opacity: 0.72 }),
    text({ x: 8, y: panelY + 5, w: w - 16, text: 'שבת שלום', size: 34, family: 'Frank Ruhl Libre', bold: true, color: loop.on }),
    text({ x: 8, y: panelY + 22, w: w - 16, text: 'פרשת השבוע', size: 15, color: loop.accent, bold: true, shabbatRole: 'parsha' }),
    text({ x: 8, y: panelY + 30, w: w - 16, text: 'ירושלים · כ״ז חשון', size: 10, color: loop.on, shabbatRole: 'city' }),
    ...timesBlock(10, panelY + 40, w - 20, loop.on, loop.accent, 25),
    rect(6, footY, w - 12, 36, '#FFFFFF', { radius: 5, opacity: 0.94 }),
    logoBox(logo, 10, footY + 5, 30, 26),
    text({ x: 42, y: footY + 5, w: 58, text: 'שם העסק', size: 14, bold: true, align: 'right', colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
    text({ x: 42, y: footY + 13, w: 58, text: 'סלוגן קצר', size: 9, align: 'right', color: '#333333', role: 'slogan', label: 'סלוגן' }),
    text({ x: 42, y: footY + 20, w: 58, text: '050-0000000', size: 15, family: 'Secular One', align: 'right', colorRole: 'primaryColor', role: 'phone', label: 'טלפון' }),
    creditLine(w, h - 7, loop.panel === '#FFF9EE' ? '#5A4A30' : '#FFFFFF'),
  ]);
}

/** the same message for a post or for print: no moving background */
function shabbatFlat(w: number, h: number, fs: number, logo: Logos): CanvasDoc {
  const margin = 12 * fs;
  const inner = w - margin * 2;
  const top = h * 0.12;
  return doc(w, h, '#FFFFFF', [
    rect(0, 0, w, h, '#14336B', { colorRole: 'primaryColor' }),
    rect(margin / 2, margin / 2, w - margin, h - margin, '#FFFFFF', { opacity: 0.08, radius: 6 * fs }),
    text({ x: margin, y: top, w: inner, text: 'שבת שלום', size: 58 * fs, family: 'Frank Ruhl Libre', bold: true, colorRole: 'onPrimary' }),
    text({ x: margin, y: top + 28 * fs, w: inner, text: 'פרשת השבוע', size: 26 * fs, bold: true, colorRole: 'secondaryColor', shabbatRole: 'parsha' }),
    text({ x: margin, y: top + 42 * fs, w: inner, text: 'ירושלים', size: 18 * fs, colorRole: 'onPrimary', shabbatRole: 'city' }),
    ...timesBlock(margin, top + 56 * fs, inner, '#FFFFFF', '#E8C77A', 42 * fs),
    rect(margin, h - 46 * fs - margin, inner, 42 * fs, '#FFFFFF', { radius: 5 * fs }),
    logoBox(logo, margin + 5 * fs, h - 42 * fs - margin, 40 * fs, 34 * fs),
    text({ x: margin + 48 * fs, y: h - 42 * fs - margin, w: inner - 53 * fs, text: 'שם העסק', size: 22 * fs, bold: true, align: 'right', colorRole: 'primaryColor', role: 'businessName', label: 'שם העסק' }),
    text({ x: margin + 48 * fs, y: h - 30 * fs - margin, w: inner - 53 * fs, text: 'סלוגן קצר', size: 13 * fs, align: 'right', color: '#333333', role: 'slogan', label: 'סלוגן' }),
    text({ x: margin + 48 * fs, y: h - 22 * fs - margin, w: inner - 53 * fs, text: '050-0000000', size: 24 * fs, family: 'Secular One', align: 'right', colorRole: 'primaryColor', role: 'phone', label: 'טלפון' }),
    creditLine(w, h - margin + 1, '#FFFFFF', 6.5 * fs),
  ]);
}

/* ------------------------------------------------------------------ the private door */

const GOLD = '#A9843F';
const INK = '#2A2118';

function greeting(title: string, line: string, palette: { bg: string; ink: string; gold: string }): CanvasDoc {
  const w = 148;
  const h = 210;
  return doc(w, h, palette.bg, [
    rect(7, 7, w - 14, h - 14, palette.gold, { radius: 2, opacity: 0.9 }),
    rect(8, 8, w - 16, h - 16, palette.bg, { radius: 1.5 }),
    rect((w - 30) / 2, 40, 30, 0.8, palette.gold),
    text({ x: 14, y: 50, w: w - 28, text: title, size: 44, family: 'Frank Ruhl Libre', bold: true, color: palette.ink, label: 'כותרת' }),
    text({ x: 18, y: 86, w: w - 36, text: line, size: 21, family: 'Frank Ruhl Libre', color: palette.ink, label: 'הברכה' }),
    rect((w - 30) / 2, 136, 30, 0.8, palette.gold),
    text({ x: 14, y: 146, w: w - 28, text: 'למי הברכה', size: 22, family: 'Frank Ruhl Libre', bold: true, color: palette.gold, label: 'למי הברכה' }),
    text({ x: 14, y: 164, w: w - 28, text: 'ממי הברכה', size: 15, family: 'Frank Ruhl Libre', color: palette.ink, label: 'ממי הברכה' }),
  ]);
}

const GREETINGS: { topic: string; key: string; name: string; title: string; line: string; palette: { bg: string; ink: string; gold: string } }[] = [
  { topic: 'ברכות', key: 'mazal', name: 'מזל טוב', title: 'מזל טוב!', line: 'מכל הלב, שתזכו לרוב שמחה ונחת.', palette: { bg: '#FBF6EC', ink: INK, gold: GOLD } },
  { topic: 'ברכות', key: 'thanks', name: 'תודה', title: 'תודה מכל הלב', line: 'על הטוב, על העזרה, ועל שאתם תמיד שם.', palette: { bg: '#F4F1EA', ink: '#23302A', gold: '#5E7F6B' } },
  { topic: 'ברכות', key: 'shana', name: 'שנה טובה', title: 'שנה טובה', line: 'שתהיה שנה של בריאות, ברכה ושמחה.', palette: { bg: '#FFF8EE', ink: '#4A1D1D', gold: '#B4432F' } },
  { topic: 'ברכות', key: 'refuah', name: 'רפואה שלמה', title: 'רפואה שלמה', line: 'מאחלים לכם החלמה מהירה, ובריאות טובה.', palette: { bg: '#F2F6FA', ink: '#1E3550', gold: '#4B7BA6' } },
  { topic: 'איחולים', key: 'success', name: 'הצלחה', title: 'בהצלחה!', line: 'שתמצאו ברכה בכל מעשה ידיכם.', palette: { bg: '#F5F7FB', ink: '#1C2B4A', gold: '#3E62A8' } },
  { topic: 'איחולים', key: 'birthday', name: 'יום הולדת', title: 'יום הולדת שמח', line: 'עד מאה ועשרים, בבריאות ובשמחה.', palette: { bg: '#FFF7F0', ink: '#4A2A1A', gold: '#C9733A' } },
  { topic: 'איחולים', key: 'home', name: 'בית חדש', title: 'בשעה טובה', line: 'שיהיה בית מלא ברכה, אור ושמחה.', palette: { bg: '#F7F4EC', ink: '#2F2A1D', gold: '#8D7B3C' } },
  { topic: 'איחולים', key: 'journey', name: 'דרך צלחה', title: 'דרך צלחה', line: 'שתלכו לשלום ותחזרו לשלום.', palette: { bg: '#F0F6F3', ink: '#1F3A30', gold: '#3F8066' } },
];

const SIMCHA_TOPIC = 'מיתוג שמחה';
const SIMCHA_SERIES = 'סט לשמחה';

/** one event, one look: every piece takes the event's two colours */
function simchaPiece(w: number, h: number, fs: number, title: string, line: string, withWhen: boolean): CanvasDoc {
  const m = 8 * fs;
  // the words stand in the middle of the page, whatever its shape
  const top = (h - (withWhen ? 100 : 68) * fs) / 2;
  return doc(w, h, '#FFFFFF', [
    rect(0, 0, w, h, '#14336B', { colorRole: 'primaryColor' }),
    rect(m, m, w - m * 2, h - m * 2, '#FFFFFF', { radius: 2 * fs }),
    rect(m + 2 * fs, m + 2 * fs, w - (m + 2 * fs) * 2, h - (m + 2 * fs) * 2, '#E8A33D', { colorRole: 'secondaryColor', radius: 1.5 * fs, opacity: 0.14 }),
    text({ x: m + 4 * fs, y: top, w: w - (m + 4 * fs) * 2, text: title, size: 24 * fs, family: 'Frank Ruhl Libre', bold: true, colorRole: 'secondaryColor', label: 'כותרת' }),
    text({ x: m + 4 * fs, y: top + 16 * fs, w: w - (m + 4 * fs) * 2, text: 'שמות בעלי השמחה', size: 32 * fs, family: 'Frank Ruhl Libre', bold: true, colorRole: 'primaryColor', label: 'שמות', detail: true }),
    rect((w - 30 * fs) / 2, top + 48 * fs, 30 * fs, 0.8 * fs, '#E8A33D', { colorRole: 'secondaryColor' }),
    text({ x: m + 6 * fs, y: top + 53 * fs, w: w - (m + 6 * fs) * 2, text: line, size: 15 * fs, family: 'Frank Ruhl Libre', colorRole: 'primaryColor', label: 'נוסח' }),
    ...(withWhen
      ? [
          text({ x: m + 4 * fs, y: top + 77 * fs, w: w - (m + 4 * fs) * 2, text: 'יום ותאריך', size: 16 * fs, bold: true, colorRole: 'primaryColor', label: 'תאריך', detail: true }),
          text({ x: m + 4 * fs, y: top + 88 * fs, w: w - (m + 4 * fs) * 2, text: 'מקום האירוע', size: 15 * fs, colorRole: 'primaryColor', label: 'מקום', detail: true }),
        ]
      : []),
  ]);
}

const SIMCHA_SET: { key: string; name: string; build: () => CanvasDoc }[] = [
  { key: 'invite', name: 'הזמנה', build: () => simchaPiece(148, 210, 1.2, 'הזמנה', 'שמחים להזמינכם להשתתף בשמחתנו', true) },
  { key: 'sign', name: 'שלט כניסה', build: () => simchaPiece(210, 297, 1.75, 'ברוכים הבאים', 'לשמחת', true) },
  { key: 'status', name: 'הזמנה לסטטוס', build: () => simchaPiece(108, 192, 0.88, 'נשמח לראותכם', 'בשמחתנו', true) },
  { key: 'thanks', name: 'כרטיס תודה', build: () => simchaPiece(148, 105, 0.95, 'תודה רבה', 'על שבאתם לשמוח איתנו', false) },
  // a roll-up is 85×200 cm: drawn at a quarter of that, the size a browser can still draw at 300dpi, and enlarged at the printer
  { key: 'rollup', name: 'רול-אפ (להגדלה ל-85×200 ס״מ)', build: () => simchaPiece(212.5, 500, 1.75, 'ברוכים הבאים', 'לשמחת', true) },
  { key: 'placemat', name: 'פלייסמט לשולחן', build: () => simchaPiece(420, 297, 1.75, 'ברוכים הבאים', 'בשמחה ובטוב לבב', true) },
  { key: 'birkon', name: 'ברכת המזון', build: () => simchaPiece(105, 148, 0.85, 'ברכת המזון', 'לזכר השמחה', true) },
  { key: 'sticker', name: 'מדבקה עגולה', build: () => simchaPiece(100, 100, 0.72, 'תודה', 'ששמחתם איתנו', false) },
];

/* ------------------------------------------------------------------ saving */

async function save(key: string, name: string, topic: string, canvas: CanvasDoc, o: { price?: number; series?: string; sizeGroup?: string } = {}) {
  const id = stableId('template:' + key);
  const old = await getRow('projects', id);
  if (old && !FORCE && !(FORCE_PREFIX && key.startsWith(FORCE_PREFIX))) return false;
  // nothing changed: the row and its preview stay as they are
  if (old && old.sizeGroup === o.sizeGroup && JSON.stringify(old.canvas) === JSON.stringify(canvas)) return false;
  // a change that shows nowhere (which fields are the customer's details) leaves its preview right
  const look = (c: CanvasDoc) => JSON.stringify(c, (k, v) => (k === 'detail' ? undefined : v));
  const row: Project = {
    id,
    kind: 'template',
    ownerId: '',
    status: old?.status ?? STATUS,
    name,
    topic,
    price: o.price,
    series: o.series,
    sizeGroup: o.sizeGroup,
    canvas,
    thumbnail: old && look(old.canvas) === look(canvas) ? old.thumbnail : undefined,
    createdAt: old?.createdAt ?? now,
    updatedAt: new Date().toISOString(),
  };
  await setRow('projects', row);
  return true;
}

/**
 * Puts the new categories on the home page's rings, once: an admin's saved order would otherwise leave them last.
 * The professions lead the business door; business cards and menus step back, and the admin can bring them back in /carousel.
 */
async function arrangeRings() {
  const first = ['ייעוץ משכנתאות', 'מיזוג אוויר', 'ייעוץ עסקי', LOGO_TOPIC, SHABBAT_TOPIC];
  const fresh = ['ברכות', 'איחולים', 'מיתוג שמחה', ...first];
  const slide = (name: string, order: number) => ({ id: 's_' + encodeURIComponent(name), name, image: null, hidden: false, order, audience: audienceOf(name) });
  await updateDb((db) => {
    if (!db.carousel.length || db.carousel.some((s) => s.name === first[0])) return;
    const sorted = [...db.carousel].sort((a, b) => a.order - b.order);
    const others = sorted.filter((s) => !fresh.includes(s.name));
    const privateDoor = [...others.filter((s) => s.audience !== 'business'), ...['ברכות', 'איחולים', 'מיתוג שמחה'].map((n) => slide(n, 0))];
    const leading = first.map((n) => sorted.find((s) => s.name === n) ?? slide(n, 0));
    const businessDoor = [...leading, ...others.filter((s) => s.audience === 'business')].map((s) => (CATEGORIES.find((c) => c.name === s.name)?.hidden ? { ...s, hidden: true } : s));
    db.carousel = [...privateDoor, ...businessDoor].map((s, order) => ({ ...s, order }));
  }, ['carousel']);
}

const LAYOUTS: { format: Format; label: string; kind: 'photo' | 'type' | 'list' }[] = [
  { format: STORY, label: 'סטטוס', kind: 'photo' },
  { format: SQUARE, label: 'פוסט', kind: 'type' },
  { format: STORY, label: 'סטטוס', kind: 'list' },
  { format: STORY, label: 'סטטוס', kind: 'type' },
  { format: SQUARE, label: 'פוסט', kind: 'photo' },
  { format: A4, label: 'A4', kind: 'list' },
];

const SIZES: Record<string, Format> = { status: STORY, post: SQUARE, a4: A4, a5: A5, a6: A6 };

async function seedSimchaSet() {
  let written = 0;
  for (const piece of SIMCHA_SET) {
    counter = 0;
    if (await save(`simcha:${piece.key}`, piece.name, SIMCHA_TOPIC, piece.build(), { price: 29, series: SIMCHA_SERIES })) written++;
  }
  return written;
}

async function main() {
  if (ONLY === 'simcha') {
    console.log(`${await seedSimchaSet()} pieces of the simcha set written (${STATUS}).`);
    return;
  }
  await arrangeRings();
  const brandCat = await ensureCategory('דוגמאות מיתוג', 'סימנים לדוגמה שמחזיקים את המקום של הלוגו של העסק');
  const photosCat = await ensureCategory('תמונות למודעות', 'תמונות למודעות לפי מקצוע');
  const shabbatCat = await ensureCategory('רקעי שבת', 'תמונות הפתיחה של הרקעים המונפשים');
  const logo = await Promise.all(SAMPLE_LOGO_RATIOS.map((r) => ensureImage(brandCat, `sample-logo-${r}`, 'לוגו לדוגמה', sampleLogo(r), 'image/png')));

  const PHOTOS: Record<string, [string, string]> = {
    'ייעוץ משכנתאות': ['mortgage-keys.jpg', 'mortgage-home.jpg'],
    'מיזוג אוויר': ['ac-room.jpg', 'ac-roof.jpg'],
    'ייעוץ עסקי': ['biz-desk.jpg', 'biz-shop.jpg'],
  };

  let written = 0;
  const count = (ok: boolean) => void (ok && written++);

  for (const p of PROFESSIONS) {
    const photos = await Promise.all(PHOTOS[p.topic].map((file) => ensureImage(photosCat, file, file, fromFile(file), 'image/jpeg')));
    const series = `סדרת ${p.topic}`;
    for (const [i, ad] of p.ads.entries()) {
      const l = LAYOUTS[i % LAYOUTS.length];
      const photo = photos[i % 2];
      const build = (format: Format) => {
        counter = 0;
        return l.kind === 'photo' ? adPhoto(format, ad, photo, logo) : l.kind === 'type' ? adType(format, ad, logo) : adList(format, ad, photo, logo);
      };
      const sizeGroup = `${p.topic}:${ad.key}`;
      count(await save(`ad:${p.topic}:${ad.key}`, `${ad.name} · ${l.label}`, p.topic, build(l.format), { price: 49, series, sizeGroup }));
      // the same ad in the other sizes: they stay out of the series, and show when a size is chosen
      for (const f of AD_FORMATS) {
        const format = SIZES[f.id];
        if (format === l.format) continue;
        count(await save(`ad:${p.topic}:${ad.key}:${f.id}`, `${ad.name} · ${f.label}`, p.topic, build(format), { price: 49, sizeGroup }));
      }
    }
  }

  for (const d of logoDesigns) {
    counter = 0;
    count(await save(`logo:${d.key}`, d.name, LOGO_TOPIC, d.build(), { price: 99 }));
  }

  for (const loop of LOOPS) {
    const still = await ensureImage(shabbatCat, `shabbat:${loop.id}`, loop.name, fromFile(`shabbat-${loop.id}.jpg`), 'image/jpeg');
    counter = 0;
    count(await save(`shabbat:${loop.id}`, `שבת שלום · ${loop.name}`, SHABBAT_TOPIC, shabbatStory(loop, still, logo), { price: 0 }));
  }
  counter = 0;
  count(await save('shabbat:post', 'שבת שלום · פוסט', SHABBAT_TOPIC, shabbatFlat(200, 200, 1, logo), { price: 0 }));
  counter = 0;
  count(await save('shabbat:a4', 'שבת שלום · A4 להדפסה', SHABBAT_TOPIC, shabbatFlat(210, 297, 1.5, logo), { price: 0 }));

  for (const g of GREETINGS) {
    counter = 0;
    count(await save(`greeting:${g.key}`, g.name, g.topic, greeting(g.title, g.line, g.palette), { price: 0 }));
  }

  written += await seedSimchaSet();

  console.log(`${written} templates written (${STATUS}${FORCE ? ', forced' : ''}). Open each in the editor as an admin to make its preview.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
