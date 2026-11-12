import { NextResponse } from 'next/server';
import { copyThumbnail, findRows, getRow, newId, readDb, setRow, updateDb } from '@/lib/db';
import { itemTexts } from '@/lib/adText';
import { parseAdTexts } from '@/lib/adTextsParse';
import { emptyDoc, validateDoc } from '@/lib/canvas';
import { requireUser } from '@/lib/auth';
import { brandCategory, parseColors } from '@/lib/brand';
import { copyTemplate } from '@/lib/copyTemplate';
import { hasActiveSubscription } from '@/lib/entitlement';
import { comingShabbat } from '@/lib/shabbat';
import { cityById, hasShabbatRoles, SHABBAT_CITIES } from '@/lib/shabbatDoc';
import { summarize } from '@/lib/summary';
import { claimTopic, parseAudience, topicConflict } from '@/lib/topics';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** a design only reaches the basket once the customer edited it; older designs count if they were ever saved */
const started = (p: Project) =>
  p.kind !== 'design' || (p.editedAt === undefined ? p.updatedAt > p.createdAt : p.editedAt !== null);

/** Admin: every template and wording plus their own designs. Customer: their own designs. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const [own, templates, wordings] = await Promise.all([
    findRows('projects', { ownerId: user.id }),
    user.role === 'admin' ? findRows('projects', { kind: 'template' }) : [],
    user.role === 'admin' ? findRows('projects', { kind: 'wording' }) : [],
  ]);
  const byId = new Map([...own, ...templates, ...wordings].map((p) => [p.id, p]));
  const list = [...byId.values()]
    .filter(started)
    .map(summarize)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json(list);
}

/**
 * - { templateId, useBrand?, colors?, shabbatCity? }: create the caller's own design as a copy of a template
 *   (customers: published templates only; admins may copy any template to test it).
 *   `useBrand` writes the caller's brand kit into the copy; the kit is read here, never taken from the client.
 *   `shabbatCity` writes that city's coming Shabbat into a design with Shabbat fields; the times are worked out here too.
 *   `itemId` puts an item of the caller's own catalog on the ad. `adTexts` (field label -> text) are the ad's words; without them the item's are used.
 *   `stickerId` puts a sticker of the library, or of the caller's own, on it.
 * - { fromDesign }: a new design from one of the caller's own, which they keep as a template.
 * - { name, width_mm, height_mm, topic?, audience?, wording? }: create a new blank template (admin only);
 *   with `audience`, the topic must belong to that door (a new topic is claimed for it).
 *   `wording` makes it a wording instead, which needs a topic: the cards that can take it are found by that.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => null);
  const now = new Date().toISOString();

  // a new ad from a design the business keeps as its template
  if (typeof body?.fromDesign === 'string') {
    const from = await getRow('projects', body.fromDesign);
    if (!from || from.kind !== 'design' || from.ownerId !== user.id) return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
    const id = newId();
    const copy: Project = { ...structuredClone(from), id, keep: undefined, thumbnail: await copyThumbnail(from.thumbnail, id), createdAt: now, updatedAt: now, editedAt: now };
    await setRow('projects', copy);
    return NextResponse.json({ id }, { status: 201 });
  }

  if (typeof body?.templateId === 'string') {
    const t = await getRow('projects', body.templateId);
    if (!t || t.kind !== 'template' || (t.status !== 'published' && user.role !== 'admin')) {
      return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });
    }
    const [brand, noCredit, found, sticker] = await Promise.all([
      body.useBrand === true ? getRow('brands', user.id) : null,
      hasActiveSubscription(user.id),
      typeof body.itemId === 'string' ? getRow('catalog', body.itemId) : null,
      typeof body.stickerId === 'string' ? getRow('images', body.stickerId) : null,
    ]);
    const item = found?.ownerId === user.id ? found : null;
    const adTexts = parseAdTexts(body.adTexts);
    const copy = await copyTemplate(t, user.id, {
      brand,
      noCredit,
      adTexts: adTexts ?? (item ? itemTexts(item) : undefined),
      photo: item?.photo,
      sticker: sticker && (sticker.sticker || (sticker.ownSticker && sticker.categoryId === brandCategory(user.id))) ? { assetId: sticker.id, width: sticker.width, height: sticker.height } : undefined,
      noPoints: !!item && !adTexts,
      colors: parseColors(body.colors),
      // opened without choosing a city (a direct link, an admin's test): the first city, whose name shows on the design
      times: hasShabbatRoles(t.canvas) ? comingShabbat(cityById(body.shabbatCity)?.id ?? SHABBAT_CITIES[0].id) : null,
    });
    await setRow('projects', copy);
    return NextResponse.json({ id: copy.id }, { status: 201 });
  }

  if (user.role !== 'admin') return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 });
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'תבנית חדשה';
  const topic = typeof body?.topic === 'string' ? body.topic.trim().slice(0, 60) : '';
  if (body?.wording === true && !topic) return NextResponse.json({ error: 'לנוסח צריך לבחור נושא.' }, { status: 400 });
  const canvas = validateDoc(emptyDoc(Number(body?.width_mm) || 210, Number(body?.height_mm) || 297));
  if (!canvas) return NextResponse.json({ error: 'מידות לא תקינות' }, { status: 400 });
  const bg = typeof body?.backgroundAssetId === 'string' ? await getRow('images', body.backgroundAssetId) : null;
  if (bg) {
    // fill the page like CSS "cover": scale to the larger side, centred, anything beyond the page is cropped
    const { width_mm: pw, height_mm: ph } = canvas.page;
    const scale = Math.max(pw / bg.width, ph / bg.height);
    const w = bg.width * scale;
    const h = bg.height * scale;
    canvas.elements.push({
      id: newId(),
      type: 'image',
      x_mm: (pw - w) / 2,
      y_mm: (ph - h) / 2,
      w_mm: w,
      h_mm: h,
      rotation: 0,
      z: 0,
      asset_id: bg.id,
      label: 'רקע',
    });
  }
  const audience = parseAudience(body?.audience);
  // fail before the upload work below is wasted (checked again, atomically, when saving)
  if (audience) {
    const why = topicConflict(await readDb(['projects', 'carousel']), topic, audience);
    if (why) return NextResponse.json({ error: why }, { status: 400 });
  }
  const project: Project = {
    id: newId(),
    kind: body?.wording === true ? 'wording' : 'template',
    ownerId: user.id,
    status: 'draft',
    name,
    topic: topic || undefined,
    canvas,
    createdAt: now,
    updatedAt: now,
  };
  const conflict = await updateDb((db) => {
    const why = audience ? topicConflict(db, topic, audience) : null;
    if (why) return why;
    if (audience) claimTopic(db, topic, audience);
    db.projects.push(project);
    return null;
  }, ['projects', 'carousel']);
  if (conflict) return NextResponse.json({ error: conflict }, { status: 400 });
  return NextResponse.json({ id: project.id }, { status: 201 });
}
