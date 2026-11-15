import { NextResponse } from 'next/server';
import sharp, { type Metadata } from 'sharp';
import { readDesign } from '@/lib/agent/importDesign';
import { requireAdmin } from '@/lib/auth';
import { FIELD_LOCKS, LOCKED, PAGE_PRESETS, validateDoc } from '@/lib/canvas';
import { AGENT_ENABLED } from '@/lib/config';
import { listFonts } from '@/lib/data/fonts';
import { newId } from '@/lib/data/ids';
import { addImage, assetFileKey, createCategory, listCategories } from '@/lib/data/library';
import { createTemplate, topicConflictFor } from '@/lib/data/projects';
import { eraseTexts } from '@/lib/eraseTexts';
import { files } from '@/lib/files';
import { BUILTIN_FONTS } from '@/lib/fonts';
import { parseAudience } from '@/lib/topics';
import type { TextElement } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const MAX_BYTES = 15 * 1024 * 1024;
const PT_TO_MM = 25.4 / 72;
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
 * its texts, they are wiped from the picture, and they come back as live text over it: the clean picture is the
 * background layer, each text a customer field in the content layer. It is a first draft for the admin to fix in the
 * editor: the fonts are the closest it found, and over a photograph a wiped place shows.
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
  let texts;
  try {
    texts = await readDesign(forModel, 'image/jpeg', fonts);
  } catch (e) {
    console.error('reading a design failed', e);
    return NextResponse.json({ error: 'לא הצלחנו לקרוא את העיצוב. נסו שוב.' }, { status: 502 });
  }

  const kept = await sharp(original).rotate().resize({ width: KEEP_SIDE, height: KEEP_SIDE, fit: 'inside', withoutEnlargement: true }).toBuffer();
  const { data, rough } = await eraseTexts(kept, texts);
  const { width, height } = await sharp(data).metadata();
  if (!width || !height) return NextResponse.json({ error: 'לא הצלחנו לבנות תבנית מהעיצוב. נסו תמונה אחרת.' }, { status: 422 });
  const page = pageFor(width / height);

  const seen = new Set<string>();
  const content = texts.map((t, i): TextElement => {
    let label = t.label.trim() || 'טקסט';
    if (seen.has(label)) label = `${label} ${i + 1}`;
    seen.add(label);
    return {
      id: newId(),
      type: 'text',
      x_mm: (t.x / 100) * page.width_mm,
      y_mm: (t.y / 100) * page.height_mm,
      w_mm: Math.max(5, (t.w / 100) * page.width_mm),
      rotation: 0,
      text: t.text,
      align: t.align,
      locks: FIELD_LOCKS,
      field: { label: label.slice(0, 60) },
      // the line height is what was measured; a text's size is that over the 1.25 it is drawn at
      font: {
        family: fonts.includes(t.font) ? t.font : 'Heebo',
        weight: t.bold ? 700 : 400,
        size_pt: Math.min(400, Math.max(4, ((t.lineHeight / 100) * page.height_mm) / 1.25 / PT_TO_MM)),
        color: t.color.toUpperCase(),
      },
      design_color: t.color.toUpperCase(),
    };
  });

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
