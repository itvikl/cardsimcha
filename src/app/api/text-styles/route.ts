import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { validateTextLook } from '@/lib/canvas';
import { addTextStyle, listTextStyles, MAX_STYLES } from '@/lib/data/textStyles';

export const dynamic = 'force-dynamic';

/** The saved text styles every admin shares, newest first. */
export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  return NextResponse.json({ styles: await listTextStyles() });
}

/** Saves a style: { name, look }, where look is the text's font, alignment, arc, fit and effects. */
export async function POST(req: Request) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 40) : '';
  if (!name) return NextResponse.json({ error: 'חסר שם לסגנון' }, { status: 400 });
  const look = validateTextLook(body?.look);
  if (!look) return NextResponse.json({ error: 'הסגנון לא תקין' }, { status: 400 });
  const style = await addTextStyle({ name, look, createdById: user.id });
  if (!style) return NextResponse.json({ error: `אפשר לשמור עד ${MAX_STYLES} סגנונות. מחקו סגנון כדי להוסיף.` }, { status: 409 });
  return NextResponse.json(style, { status: 201 });
}
