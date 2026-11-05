import { NextResponse } from 'next/server';
import { getUser, requireAdmin } from '@/lib/auth';
import { addFont, fontFileKey, fontUsage, listFonts } from '@/lib/data/fonts';
import { newId } from '@/lib/data/ids';
import { files } from '@/lib/files';
import { FONT_MIME, parseFont } from '@/lib/font-file';
import { FAMILY_NAME, isBuiltinFamily } from '@/lib/fonts';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;

/** Uploaded fonts, for the editor. Admins may add ?usage=1 to see which cards use each family. */
export async function GET(req: Request) {
  const fonts = await listFonts();
  const user = await getUser();
  if (user?.role === 'admin' && new URL(req.url).searchParams.get('usage') === '1') {
    const usage = await fontUsage([...new Set(fonts.map((f) => f.family))]);
    return NextResponse.json({ fonts, usage });
  }
  return NextResponse.json({ fonts });
}

/**
 * Upload one font file (form field "file"). Family, weight and style are read from the file;
 * the optional fields "family" and "weight" override them.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'הקובץ גדול מ-10MB' }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseFont(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const familyField = form?.get('family');
  const family = (typeof familyField === 'string' && familyField.trim() ? familyField : parsed.family).trim().replace(/\s+/g, ' ');
  if (!FAMILY_NAME.test(family)) {
    return NextResponse.json(
      { error: `שם המשפחה "${family}" לא תקין: אותיות, ספרות, רווח, מקף וקו תחתון בלבד, עד 60 תווים. אפשר לתת שם אחר בשדה "שם המשפחה".` },
      { status: 400 },
    );
  }
  if (isBuiltinFamily(family)) {
    return NextResponse.json({ error: `"${family}" הוא פונט מובנה. תנו לפונט שם משפחה אחר.` }, { status: 400 });
  }
  const weightField = Number(form?.get('weight'));
  const weight = weightField >= 100 && weightField <= 900 && weightField % 100 === 0 ? weightField : parsed.weight;

  const id = newId();
  const key = fontFileKey(id, parsed.format);
  await files.put(key, data, FONT_MIME[parsed.format]);
  const font = await addFont({ id, family, weight, style: parsed.style, fileKey: key, unicodeRanges: parsed.unicodeRanges });
  if (!font) {
    await files.remove([key]);
    const style = parsed.style === 'italic' ? ' נטוי' : '';
    return NextResponse.json({ error: `ל-"${family}" כבר יש קובץ במשקל ${weight}${style}. מחקו אותו קודם כדי להחליף.` }, { status: 409 });
  }
  return NextResponse.json(font, { status: 201 });
}
