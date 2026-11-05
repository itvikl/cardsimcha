import { getUser } from '@/lib/auth';
import { readThumbnail } from '@/lib/data/projects';

type Ctx = { params: Promise<{ id: string }> };

/**
 * A card's thumbnail. Published templates are public; a design or draft only for whoever
 * may open it. The URL carries `?v=<saved at>`, so a new save gets a new URL.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return new Response('Not found', { status: 404 });
  const thumb = await readThumbnail(await getUser(), id);
  if (!thumb) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(thumb.data), {
    headers: {
      'Content-Type': thumb.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
