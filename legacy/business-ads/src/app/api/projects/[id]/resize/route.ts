import { NextResponse } from 'next/server';
import { canWrite } from '@/lib/access';
import { formatById, formatOfPage } from '@/lib/adFormats';
import { hasPoints } from '@/lib/adText';
import { parseAdTexts } from '@/lib/adTextsParse';
import { requireUser } from '@/lib/auth';
import { copyTemplate } from '@/lib/copyTemplate';
import { findRows, getRow, getRows, setRow } from '@/lib/db';
import { hasActiveSubscription } from '@/lib/entitlement';
import { applyProducts } from '@/lib/products';
import type { CanvasElement } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

/**
 * The same ad in another size, as a new design: { format, texts }. The words come from the editor as they stand now,
 * because the last edit may not be saved yet; the picture comes from the saved design.
 */
export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const project = await getRow('projects', id);
  if (!project || !canWrite(user, project) || project.kind !== 'design' || !project.templateId) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const format = formatById(body?.format);
  const source = await getRow('projects', project.templateId);
  if (!format || !source?.sizeGroup) return NextResponse.json({ error: 'המידה הזו לא זמינה' }, { status: 400 });

  const sizes = await findRows('projects', { kind: 'template', status: 'published', sizeGroup: source.sizeGroup });
  const target = sizes.find((t) => formatOfPage(t.canvas.page.width_mm, t.canvas.page.height_mm)?.id === format.id);
  if (!target) return NextResponse.json({ error: 'המידה הזו לא זמינה' }, { status: 400 });

  const picture = project.canvas.elements.flatMap((e) => (e.type === 'image' && e.role === 'photo' ? [e.asset_id] : []))[0];
  const asset = picture ? await getRow('images', picture) : null;
  const [brand, noCredit] = await Promise.all([getRow('brands', user.id), hasActiveSubscription(user.id)]);
  const copy = await copyTemplate(target, user.id, {
    brand,
    noCredit,
    adTexts: parseAdTexts(body?.texts),
    photo: asset ? { assetId: asset.id, width: asset.width, height: asset.height } : undefined,
    // an ad about one product has no list, in any size
    noPoints: !hasPoints(project.canvas),
  });
  copy.name = project.name.replace(/ · .*$/, '') + ` · ${format.label}`;
  // what the business added itself goes along, keeping its place on the page in proportion
  const from = project.canvas.page;
  const to = copy.canvas.page;
  const scale = Math.min(to.width_mm / from.width_mm, to.height_mm / from.height_mm);
  const added = project.canvas.elements.flatMap((e): CanvasElement[] => {
    const place = { x_mm: (e.x_mm / from.width_mm) * to.width_mm, y_mm: (e.y_mm / from.height_mm) * to.height_mm, w_mm: e.w_mm * scale };
    if (e.type === 'image' && e.role === 'sticker') return [{ ...e, ...place, h_mm: e.h_mm * scale }];
    if (e.type === 'text' && e.own) return [{ ...e, ...place, font: { ...e.font, size_pt: e.font.size_pt * scale } }];
    return [];
  });
  copy.canvas = { ...copy.canvas, elements: [...copy.canvas.elements, ...added].map((e, i) => ({ ...e, z: i })) };
  if (project.canvas.productIds?.length) {
    const found = new Map((await getRows('catalog', project.canvas.productIds)).filter((i) => i.ownerId === user.id).map((i) => [i.id, i]));
    copy.canvas = applyProducts(copy.canvas, project.canvas.productIds.flatMap((i) => found.get(i) ?? []));
  }
  await setRow('projects', copy);
  return NextResponse.json({ id: copy.id }, { status: 201 });
}
