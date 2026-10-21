import { requireAdmin } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { readDb, updateDb } from '@/lib/db';
import type { CarouselSlide, Db } from '@/lib/types';
import { audienceOf, type CarouselSetting } from '@/lib/categories';

export const dynamic = 'force-dynamic';

const MAX_SLIDES = 200;
const IMAGE_RE = /^(\/categories\/[\w-]+\.svg|\/api\/uploads\/[\w.-]+|template:[\w-]+)$/;

function resolve(db: Db, image: string | null): string | null {
  if (!image?.startsWith('template:')) return image;
  const id = image.slice('template:'.length);
  return db.projects.find((p) => p.id === id && p.kind === 'template')?.thumbnail ?? null;
}

function list(db: Db): CarouselSetting[] {
  return [...db.carousel]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ name: s.name, image: s.image, src: resolve(db, s.image), hidden: s.hidden, audience: s.audience ?? audienceOf(s.name) }));
}

/** The admin's carousel choices. Public on purpose: the home page needs them before sign-in. */
export async function GET() {
  return NextResponse.json(list(await readDb()));
}

/** Replaces the whole carousel setup: body `{ slides: [{ name, image, hidden, audience }] }` in display order. */
export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => null);
  const input: unknown[] = Array.isArray(body?.slides) ? body.slides.slice(0, MAX_SLIDES) : [];

  const slides: CarouselSlide[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const r = raw as { name?: unknown; image?: unknown; hidden?: unknown; audience?: unknown };
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 80) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const image = typeof r.image === 'string' && IMAGE_RE.test(r.image) ? r.image : null;
    // the name is the key; encoded and prefixed so it is always a valid Firestore doc id
    const audience = r.audience === 'business' || r.audience === 'private' ? r.audience : undefined;
    slides.push({ id: 's_' + encodeURIComponent(name), name, image, hidden: r.hidden === true, order: slides.length, audience });
  }

  const result = await updateDb((db) => {
    // the page only lists topics with something to show; keep the rest (e.g. a business topic
    // whose templates are all drafts) so they don't lose their door
    for (const old of [...db.carousel].sort((a, b) => a.order - b.order)) {
      if (!seen.has(old.name)) slides.push({ ...old, order: slides.length });
    }
    db.carousel = slides;
    return list(db);
  });
  return NextResponse.json(result);
}
