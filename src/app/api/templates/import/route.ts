import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { topicConflictFor } from '@/lib/data/projects';
import { ExportError } from '@/lib/indesignImport';
import { importInDesign, unpack } from '@/lib/indesignSave';
import { parseAudience } from '@/lib/topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Admin: an InDesign "Export HTML" folder as a .zip or .rar ({ file, name, topic, audience, places, labelId }) in,
 * a draft template per page out. Every text frame becomes a customer field in its place, font, size and colour; the page's
 * picture with the frames' graphics becomes the background. The export's fonts the site lacks are added.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'הקובץ גדול מ-60MB' }, { status: 400 });
  const text = (k: string, max: number) => {
    const v = form?.get(k);
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  };
  const name = text('name', 100) || file.name.replace(/\.[^.]+$/, '') || 'עיצוב מיובא';
  const topic = text('topic', 60);
  const audience = parseAudience(text('audience', 20));
  let places: string[] = [];
  try {
    const raw: unknown = JSON.parse(text('places', 4000) || '[]');
    if (Array.isArray(raw)) places = raw.filter((t): t is string => typeof t === 'string').slice(0, 50);
  } catch {
    // no places: filed later on the tree page
  }
  const labelId = text('labelId', 60) || null;
  if (audience && !places.length) {
    const why = await topicConflictFor(topic, audience);
    if (why) return NextResponse.json({ error: why }, { status: 400 });
  }

  try {
    const entries = await unpack(Buffer.from(await file.arrayBuffer()), file.name);
    const result = await importInDesign(entries, { name, topic, audience, places, labelId });
    if ('conflict' in result) return NextResponse.json({ error: result.conflict }, { status: 400 });
    return NextResponse.json({ ...result, id: result.ids[0] }, { status: 201 });
  } catch (e) {
    if (e instanceof ExportError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error('InDesign import failed', e);
    return NextResponse.json({ error: 'הייבוא נכשל. נסו שוב.' }, { status: 500 });
  }
}
