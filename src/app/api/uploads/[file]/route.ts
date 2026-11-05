import path from 'node:path';
import { fileKeyOfImage } from '@/lib/data/library';
import { files } from '@/lib/files';

type Ctx = { params: Promise<{ file: string }> };

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function GET(_req: Request, { params }: Ctx) {
  const { file } = await params;
  // only plain "<uuid>.<ext>" names are ever stored; reject anything else (path traversal)
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(file)) return new Response('Not found', { status: 404 });
  const key = await fileKeyOfImage(file);
  const data = key && (await files.get(key));
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': MIME[path.extname(file)],
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
