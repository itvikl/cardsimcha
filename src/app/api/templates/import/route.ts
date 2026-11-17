import { NextResponse } from 'next/server';
import sharp, { type Metadata } from 'sharp';
import { readDesign } from '@/lib/agent/importDesign';
import { requireAdmin } from '@/lib/auth';
import { LOCKED, PAGE_PRESETS, validateDoc } from '@/lib/canvas';
import { AGENT_ENABLED } from '@/lib/config';
import { listFonts } from '@/lib/data/fonts';
import { newId } from '@/lib/data/ids';
import { addImage, assetFileKey, createCategory, listCategories } from '@/lib/data/library';
import { createTemplate, topicConflictFor } from '@/lib/data/projects';
import { cleanDesign } from '@/lib/importClean';
import { importedContent } from '@/lib/importLayout';
import { wipeOnObjects } from '@/lib/objectTexts';
import { files } from '@/lib/files';
import { BUILTIN_FONTS } from '@/lib/fonts';
import { parseAudience } from '@/lib/topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_BYTES = 15 * 1024 * 1024;
const CATEGORY = 'עיצובים מיובאים';
/** what the model sees and what is kept: enough to print a card, and less than an image request's limit */
const MODEL_SIDE = 1568;
const KEEP_SIDE = 3000;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** the page: the preset of this shape, or a page of this shape 200 mm on its long side */
function pageFor(ratio: number) {
  const preset = PAGE_PRESETS.find((p) => Math.abs(p.width_mm / p.height_mm / ratio - 1) < 0.02);
  if (preset) return { width_mm: preset.width_mm, height_mm: preset.height_mm };
  return ratio >= 1 ? { width_mm: 200, height_mm: 200 / ratio } : { width_mm: 200 * ratio, height_mm: 200 };
}

/** the mean colour of the picture inside each box (percent of it), as #RRGGBB */
async function meanColors(image: Buffer, boxes: { x: number; y: number; w: number; h: number }[]) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  return boxes.map((b) => {
    const x0 = Math.max(0, Math.floor((b.x / 100) * W));
    const y0 = Math.max(0, Math.floor((b.y / 100) * H));
    const x1 = Math.min(W, Math.ceil(((b.x + b.w) / 100) * W));
    const y1 = Math.min(H, Math.ceil(((b.y + b.h) / 100) * H));
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        for (let k = 0; k < 3; k++) sum[k] += data[(y * W + x) * 3 + k];
        n++;
      }
    }
    return n ? '#' + sum.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
  });
}

/** the shared category that keeps imported backgrounds, made the first time */
async function importCategoryId(): Promise<string> {
  const made = await createCategory(CATEGORY, 'רקעים של עיצובים שיובאו מתמונה');
  if (made) return made.id;
  const found = (await listCategories()).find((c) => c.name === CATEGORY);
  if (!found) throw new Error('import category missing');
  return found.id;
}

/**
 * Admin: a finished design as a picture ({ file, name, topic, audience }) in, a draft template out. The model reads
 * its texts, and the objects they stand on (a pill, a badge, a box). The texts are wiped from the picture and come
 * back as live text over it: the clean picture is the background layer, each text a customer field in the content
 * layer. The objects stay in the picture; they are found so the texts on them come off cleanly and stay inside them.
 * It is a first draft for the admin to fix in the editor: the fonts are the closest it found, and over a photograph a
 * wiped place shows.
 * Ported from feature/business-ads (Vitol) onto Postgres and card format v2.
 */
export async function POST(req: Request) {
  if (!AGENT_ENABLED) return NextResponse.json({ error: 'הקריאה האוטומטית לא זמינה כרגע' }, { status: 503 });
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  if (!TYPES.includes(file.type)) return NextResponse.json({ error: 'סוג קובץ לא נתמך (PNG, JPG, WebP)' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'הקובץ גדול מ-15MB' }, { status: 400 });
  const text = (k: string, max: number) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  };
  const name = text('name', 100) || 'עיצוב מיובא';
  const topic = text('topic', 60);
  const audience = parseAudience(text('audience', 20));
  // fail before the model's minute is spent (createTemplate checks again)
  if (audience) {
    const why = await topicConflictFor(topic, audience);
    if (why) return NextResponse.json({ error: why }, { status: 400 });
  }

  const original = Buffer.from(await file.arrayBuffer());
  let meta: Metadata;
  try {
    meta = await sharp(original).rotate().metadata();
  } catch {
    return NextResponse.json({ error: 'הקובץ אינו תמונה תקינה' }, { status: 400 });
  }
  if (!meta.width || !meta.height) return NextResponse.json({ error: 'הקובץ אינו תמונה תקינה' }, { status: 400 });

  const fonts = [...new Set([...BUILTIN_FONTS.map((f) => f.family), ...(await listFonts()).map((f) => f.family)])];
  const forModel = await sharp(original).rotate().resize({ width: MODEL_SIDE, height: MODEL_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  let texts, objects;
  try {
    ({ texts, objects } = await readDesign(forModel, 'image/jpeg', fonts));
  } catch (e) {
    console.error('reading a design failed', e);
    return NextResponse.json({ error: 'לא הצלחנו לקרוא את העיצוב. נסו שוב.' }, { status: 502 });
  }

  const kept = await sharp(original).rotate().resize({ width: KEEP_SIDE, height: KEEP_SIDE, fit: 'inside', withoutEnlargement: true }).toBuffer();
  // each box snaps to its ink (the ad-import tool's steps, lib/importClean)
  const { refined } = await cleanDesign(kept, texts);
  const fitted = texts.map((t, i) => ({ ...t, x: refined[i].x, y: refined[i].y, w: refined[i].w, h: refined[i].h }));
  // the texts on a flat object are wiped by their letters only, in its colour (lib/objectTexts)
  const onObjects = await wipeOnObjects(kept, objects, fitted);
  // the other texts: only their ink is repainted (lib/importClean)
  const { data, rough } = await cleanDesign(onObjects.picture, texts.filter((_, i) => !onObjects.texts.has(i)));
  const { width, height } = await sharp(data).metadata();
  if (!width || !height) return NextResponse.json({ error: 'לא הצלחנו לבנות תבנית מהעיצוב. נסו תמונה אחרת.' }, { status: 422 });
  const page = pageFor(width / height);

  // what each text stands on once it is wiped: its colour must read on that
  const under = await meanColors(data, refined);
  const content = importedContent({ page, texts, refined, under, frames: objects, fonts, newId });

  const assetId = newId();
  const fileName = `${assetId}.jpg`;
  const canvas = validateDoc({
    schema_version: 2,
    page,
    layers: { background: { fill: { type: 'solid', color: '#FFFFFF' }, image: { asset_id: assetId, fit: 'cover' }, locks: LOCKED }, content, overlay: [] },
  });
  if (!canvas) return NextResponse.json({ error: 'לא הצלחנו לבנות תבנית מהעיצוב. נסו תמונה אחרת.' }, { status: 422 });

  await files.put(assetFileKey(fileName), data, 'image/jpeg');
  const asset = await addImage({ id: assetId, categoryId: await importCategoryId(), name, file: fileName, width, height });
  if (!asset) {
    await files.remove([assetFileKey(fileName)]);
    return NextResponse.json({ error: 'שמירת התמונה נכשלה. נסו שוב.' }, { status: 500 });
  }
  const result = await createTemplate({ name, topic, canvas, ...(audience && { audience }) });
  if ('conflict' in result) return NextResponse.json({ error: result.conflict }, { status: 400 });
  return NextResponse.json({ id: result.id, texts: texts.length, rough }, { status: 201 });
}
