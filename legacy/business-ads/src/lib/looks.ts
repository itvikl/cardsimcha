import { applyBackdrop, backdropColor, backdropOf, BACKDROP_CATEGORY, colorBackdrop, fitsPage, pictureBackdrop, type Backdrop } from './backdrop';
import type { Audience } from './categories';
import { findRows, getRow } from './db';
import { applyWording, fitsCard, sameKind, textsOf, type Wording } from './wording';
import type { CanvasDoc, ImageAsset, Project, User } from './types';

/**
 * A private card's looks: the wordings and backdrops a customer can move between inside it. Both come from stored rows, so
 * the editor only ever names one; what it lays on the card is worked out here again on every save.
 */

type Ctx = { topic: string | null; audience: Audience };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'he');

/** the pictures any private card can take as its background */
async function backdropPictures(): Promise<ImageAsset[]> {
  const cats = await findRows('categories', { name: BACKDROP_CATEGORY });
  const lists = await Promise.all(cats.map((c) => findRows('images', { categoryId: c.id })));
  return lists.flat().sort(byName);
}

const lookable = (p: Project, ctx: Ctx) => p.kind === 'design' && ctx.audience === 'private' && !!ctx.topic;

/** What the editor offers inside this card. The card it was made from comes first, so going back is always there. */
export async function cardLooks(p: Project, ctx: Ctx, user: User): Promise<{ wordings: Wording[]; backdrops: Backdrop[] }> {
  if (!lookable(p, ctx)) return { wordings: [], backdrops: [] };
  const isAdmin = user.role === 'admin';
  const [wordingRows, cards, pictures] = await Promise.all([
    findRows('projects', { kind: 'wording', topic: ctx.topic! }),
    findRows('projects', { kind: 'template', topic: ctx.topic! }),
    backdropPictures(),
  ]);
  const own = (t: Project) => (t.id === p.templateId ? 0 : 1);
  const siblings = cards.filter((t) => sameKind(t, p.canvas, ctx.topic, isAdmin)).sort((a, b) => own(a) - own(b) || byName(a, b));

  const wordings = [...wordingRows.sort(byName), ...siblings]
    .filter((w) => fitsCard(w, p.canvas, ctx.topic, isAdmin))
    .map((w) => ({ id: w.id, name: w.name, elements: textsOf(w) }));

  // cards of one set often share one backdrop: it is offered once
  const seen = new Set<string>();
  const backdrops = [
    ...siblings.map((t) => backdropOf(t.id, t.name, t.canvas)),
    ...pictures.filter((a) => fitsPage(p.canvas.page, a)).map((a) => pictureBackdrop(p.canvas.page, a)),
  ].filter((b) => {
    const look = JSON.stringify([b.background, b.elements.map((e) => ({ ...e, id: '', z: 0 }))]);
    if (seen.has(look)) return false;
    seen.add(look);
    return true;
  });
  return { wordings, backdrops };
}

async function findBackdrop(id: string, p: Project, ctx: Ctx, isAdmin: boolean): Promise<Backdrop | null> {
  const color = backdropColor(id);
  if (color) return colorBackdrop(color);
  if (id.startsWith('img:')) {
    const asset = await getRow('images', id.slice(4));
    const cat = asset && (await getRow('categories', asset.categoryId));
    return asset && cat?.name === BACKDROP_CATEGORY && fitsPage(p.canvas.page, asset) ? pictureBackdrop(p.canvas.page, asset) : null;
  }
  const t = await getRow('projects', id);
  return t?.kind === 'template' && sameKind(t, p.canvas, ctx.topic, isAdmin) ? backdropOf(t.id, t.name, t.canvas) : null;
}

/**
 * The saved card, moved to the wording and backdrop the client sent when it may take them. Their texts and shapes come from
 * stored rows, never from the client; applyCustomerEdits then lays the customer's own changes over them. A card that never
 * moved has neither id, and stands for the card it was made from, so an undo back to it is a move back to that card.
 */
export async function withSentLooks(p: Project, incoming: unknown, ctx: Ctx, user: User): Promise<CanvasDoc> {
  const sent = incoming as CanvasDoc | null;
  const isAdmin = user.role === 'admin';
  // a business card keeps the first rule: only one built on a wording moves between wordings
  if (!lookable(p, ctx) && !p.canvas.wordingId) return p.canvas;
  const wantWording = typeof sent?.wordingId === 'string' ? sent.wordingId : p.templateId;
  let doc = p.canvas;
  if (wantWording && wantWording !== (doc.wordingId ?? p.templateId)) {
    const w = await getRow('projects', wantWording);
    if (fitsCard(w, doc, ctx.topic, isAdmin)) doc = applyWording(doc, { id: w.id, elements: textsOf(w) });
  }
  if (!lookable(p, ctx)) return doc;
  const wantBackdrop = typeof sent?.backdropId === 'string' ? sent.backdropId : p.templateId;
  if (wantBackdrop && wantBackdrop !== (doc.backdropId ?? p.templateId)) {
    const b = await findBackdrop(wantBackdrop, p, ctx, isAdmin);
    if (b) doc = applyBackdrop(doc, b);
  }
  return doc;
}
