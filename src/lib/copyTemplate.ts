import { dropPoints, placePhoto, writeAd, type AdTexts } from './adText';
import { applyBrand, applyColors, hasBrandRoles, type BrandColors } from './brand';
import { copyThumbnail, newId } from './db';
import { applyShabbat, hasShabbatRoles, type ShabbatTimes } from './shabbatDoc';
import type { BrandKit, Project } from './types';

export type CopyOptions = {
  /** the business's kit; a kit without a name is not one yet (only a logo was uploaded): it would empty the design's texts */
  brand?: BrandKit | null;
  /** an event's own colours, for a simcha's set */
  colors?: BrandColors | null;
  /** the week's times, for a design with Shabbat fields */
  times?: ShabbatTimes | null;
  /** a subscriber's copy doesn't carry the site's credit line */
  noCredit?: boolean;
  /** these copies were taken together from a series */
  seriesRun?: string;
  /** the ad's words by field label, in place of the template's; a longer text takes a smaller size */
  adTexts?: AdTexts;
  /** a picture from the business's own catalog in place of the template's photograph */
  photo?: { assetId: string; width: number; height: number };
  /** the ad is about one product: the template's general list of points goes */
  noPoints?: boolean;
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
  if (o.noPoints) canvas = dropPoints(canvas);
  if (o.adTexts) canvas = writeAd(canvas, o.adTexts);
  if (o.photo) canvas = placePhoto(canvas, o.photo);

  // the template's preview shows its sample details: a personal copy gets its own when it is first drawn
  const personal = !!(brand || times || o.colors || o.adTexts || o.photo);
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
  return copy;
}
