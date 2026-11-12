import { NextResponse } from 'next/server';
import { canWrite } from '@/lib/access';
import { formatById, formatOfPage } from '@/lib/adFormats';
import { hasPoints } from '@/lib/adText';
import { parseAdTexts } from '@/lib/adTextsParse';
import { requireUser } from '@/lib/auth';
import { copyTemplate } from '@/lib/copyTemplate';
import { findRows, getRow, setRow } from '@/lib/db';
import { hasActiveSubscription } from '@/lib/entitlement';

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
  await setRow('projects', copy);
  return NextResponse.json({ id: copy.id }, { status: 201 });
}
