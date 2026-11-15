import { professionOf } from './professions';
import type { BrandKit, CatalogItem } from './types';

/** What the system knows about a business: its profession's worries and offers, what it told about itself, and its catalog. */
export function businessBrief(topic: string | null, kit: BrandKit | null, items: CatalogItem[]): string {
  const p = professionOf(topic);
  const about = kit?.profile;
  return [
    `Category: ${topic ?? 'general'}.`,
    p && `The advertiser: ${p.who}.\nWhat their customers worry about: ${p.pains.join('; ')}.\nWhat they can offer: ${p.offers.join('; ')}.\nNever claim: ${p.avoid}`,
    kit?.businessName && `The business: ${kit.businessName}${kit.slogan ? `, slogan: ${kit.slogan}` : ''}.`,
    about?.services && `What it does: ${about.services}.`,
    about?.area && `Where it works: ${about.area}.`,
    about?.experience && `Its experience: ${about.experience}.`,
    about?.promise && `Why choose it, in its own words: ${about.promise}.`,
    about?.reviews && `Real reviews it received (quote only these): ${about.reviews}.`,
    items.length > 0 &&
      `Its catalog:\n${items
        .slice(0, 40)
        .map((i) => `- id ${i.id}: ${i.name}${i.details ? `, ${i.details}` : ''}${i.price ? `, price: ${i.price}` : ''}`)
        .join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n');
}
