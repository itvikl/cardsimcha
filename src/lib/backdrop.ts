import { coverBox } from './adText';
import { isCardText } from './wording';
import type { CanvasDoc, CanvasElement, ImageAsset } from './types';

/**
 * A backdrop is what a card draws under its texts: the page colour and its shapes and pictures. A customer inside a private
 * card can lay another one under the same texts: another card's of its topic and page size, a picture of the backgrounds
 * category, or a flat colour. Stickers stay on top.
 */
export type Backdrop = { id: string; name: string; background: string; elements: CanvasElement[] };

/** the category whose pictures any private card can take as its background */
export const BACKDROP_CATEGORY = 'רקעים';

/** a picture of another shape than the page is cropped to fill it; one that would lose more than this is not offered */
const MAX_CROP = 1.6;

/** a backdrop's shapes and pictures carry this at the start of their id */
const MARK = 'b_';

/** what lies under the texts: shapes and pictures that aren't stickers, nor a business's logo, photo or product */
export const isBase = (e: CanvasElement) => e.type !== 'text' && !e.role && !e.product;

/** another card's backdrop. Its pictures can't be swapped one by one here: the whole backdrop is the choice. */
export const backdropOf = (id: string, name: string, canvas: CanvasDoc): Backdrop => ({
  id,
  name,
  background: canvas.page.background,
  elements: canvas.elements.filter(isBase).map((e) => {
    if (e.type !== 'image') return { ...e, id: MARK + e.id.replace(/^b_/, '') };
    const { swappable: _s, swapCategoryId: _c, label: _l, ...rest } = e;
    void [_s, _c, _l];
    return { ...rest, id: MARK + e.id.replace(/^b_/, '') };
  }),
});

export const fitsPage = (page: CanvasDoc['page'], a: Pick<ImageAsset, 'width' | 'height'>) => {
  const r = a.width / a.height / (page.width_mm / page.height_mm);
  return Math.max(r, 1 / r) <= MAX_CROP;
};

/** a picture that covers the page, cropped evenly on both sides */
export const pictureBackdrop = (page: CanvasDoc['page'], a: Pick<ImageAsset, 'id' | 'name' | 'width' | 'height'>): Backdrop => ({
  id: 'img:' + a.id,
  name: a.name,
  background: page.background,
  elements: [
    { id: MARK + 'picture', type: 'image', rotation: 0, z: 0, asset_id: a.id, ...coverBox({ x_mm: 0, y_mm: 0, w_mm: page.width_mm, h_mm: page.height_mm }, a.width, a.height) },
  ],
});

export const colorBackdrop = (hex: string): Backdrop => ({ id: 'color:' + hex.toUpperCase(), name: hex, background: hex.toUpperCase(), elements: [] });

/** the colour of a flat-colour backdrop id, when it is one */
export const backdropColor = (id: string) => /^color:#[0-9A-F]{6}$/.test(id) ? id.slice(6) : null;

/**
 * The card on this backdrop. Its texts keep the colour they were designed in as where matching a colour starts from
 * (see fitColor.ts), so moving back to the first backdrop brings their colours back too.
 */
export function applyBackdrop<D extends CanvasDoc>(doc: D, b: Backdrop): D {
  const rest = doc.elements.filter((e) => !isBase(e)).map((e) => (isCardText(e) && !e.designColor ? { ...e, designColor: e.font.color } : e));
  return {
    ...doc,
    backdropId: b.id,
    page: { ...doc.page, background: b.background },
    elements: [...b.elements, ...rest].map((e, i) => ({ ...e, z: i })),
  };
}
