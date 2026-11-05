import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { listSlides, replaceSlides } from '@/lib/data/topics';
import { templateThumbnail } from '@/lib/data/projects';
import type { CarouselSlide } from '@/lib/types';
import { audienceOf, type Audience, type CarouselSetting } from '@/lib/categories';

export const dynamic = 'force-dynamic';

const MAX_SLIDES = 200;
const IMAGE_RE = /^(\/categories\/[\w-]+\.svg|\/api\/uploads\/[\w.-]+|template:[\w-]+)$/;

async function resolve(image: string | null): Promise<string | null> {
  if (!image?.startsWith('template:')) return image;
  return templateThumbnail(image.slice('template:'.length));
}

async function list(slides: CarouselSlide[]): Promise<CarouselSetting[]> {
  return Promise.all(
    slides.map(async (s) => ({
      name: s.name,
      image: s.image,
      src: await resolve(s.image),
      hidden: s.hidden,
      audience: s.audience ?? audienceOf(s.name),
    })),
  );
}

/** The admin's carousel choices. Public on purpose: the home page needs them before sign-in. */
export async function GET() {
  return NextResponse.json(await list(await listSlides()));
}

/** Replaces the whole carousel setup: body `{ slides: [{ name, image, hidden, audience }] }` in display order. */
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const input: unknown[] = Array.isArray(body?.slides) ? body.slides.slice(0, MAX_SLIDES) : [];

  const slides: { name: string; image: string | null; hidden: boolean; audience?: Audience }[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const r = raw as { name?: unknown; image?: unknown; hidden?: unknown; audience?: unknown };
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 80) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const image = typeof r.image === 'string' && IMAGE_RE.test(r.image) ? r.image : null;
    const audience = r.audience === 'business' || r.audience === 'private' ? r.audience : undefined;
    slides.push({ name, image, hidden: r.hidden === true, audience });
  }
  return NextResponse.json(await list(await replaceSlides(slides)));
}
