import { applyBrand, applyColors, hasBrandRoles, type BrandColors } from './brand';
import { copyThumbnail, newId } from './db';
import { applyShabbat, hasShabbatRoles, type ShabbatTimes } from './shabbatDoc';
import type { BrandKit, Project } from './types';

export type CopyOptions = {
  /** the business's kit; a kit without a name is not one yet (only a logo was uploaded): it would empty the design's texts */
  brand?: BrandKit | null;
  /** an event's own colours, for a simcha's set */
  colors?: BrandColors | null;
  /** element id -> text, for the design's editable text fields only */
  fill?: Record<string, unknown>;
  /** the week's times, for a design with Shabbat fields */
  times?: ShabbatTimes | null;
  /** a subscriber's copy doesn't carry the site's credit line */
  noCredit?: boolean;
  /** these copies were taken together from a series */
  seriesRun?: string;
};

/** A customer's own copy of a template, with what the server knows written in. The caller saves it. */
export async function copyTemplate(t: Project, ownerId: string, o: CopyOptions = {}): Promise<Project> {
  const now = new Date().toISOString();
  const id = newId();
  const brand = o.brand?.businessName && hasBrandRoles(t.canvas) ? o.brand : null;
  const times = o.times && hasShabbatRoles(t.canvas) ? o.times : null;
  let canvas = structuredClone(t.canvas);
  if (brand) canvas = applyBrand(canvas, brand);
  if (o.colors && hasBrandRoles(t.canvas)) canvas = applyColors(canvas, o.colors);
  if (times) canvas = applyShabbat(canvas, times);
  if (o.noCredit) canvas = { ...canvas, elements: canvas.elements.filter((e) => !(e.type === 'text' && e.credit)) };

  // the template's preview shows its sample details: a personal copy gets its own when it is first drawn
  const personal = !!(brand || times || o.colors);
  const copy: Project = {
    id,
    kind: 'design',
    ownerId,
    templateId: t.id,
    status: 'draft',
    name: t.name,
    canvas,
    thumbnail: personal ? undefined : await copyThumbnail(t.thumbnail, id),
    createdAt: now,
    updatedAt: now,
    // a copy that carries the customer's details belongs in their basket right away
    editedAt: personal || o.seriesRun ? now : null,
    seriesRun: o.seriesRun,
    shabbatFor: times?.friday,
  };
  for (const e of copy.canvas.elements) {
    const text = o.fill?.[e.id];
    if (e.type === 'text' && e.editable && typeof text === 'string') {
      e.text = text.slice(0, 300);
      copy.editedAt = now;
    }
  }
  return copy;
}
