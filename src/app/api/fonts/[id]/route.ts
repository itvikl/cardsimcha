import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { deleteFont, fontFile } from '@/lib/data/fonts';
import { files } from '@/lib/files';
import { FONT_MIME } from '@/lib/font-file';

type Ctx = { params: Promise<{ id: string }> };

/** The font file. Public, like the built-in Google fonts; a new upload always gets a new id. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const f = await fontFile(id);
  const data = f && (await files.get(f.key));
  if (!f || !data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': FONT_MIME[f.format],
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Cards that use the family keep the name and fall back to a default font until it is uploaded again. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const key = await deleteFont(id);
  if (!key) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  await files.remove([key]);
  return NextResponse.json({ ok: true });
}
