import { readableOn } from './brand';
import type { CanvasDoc, CanvasElement, CatalogItem, ShapeElement } from './types';

/**
 * An ad of several products ("מבצעי החודש"): a template marks an area, and the chosen items of the business's catalog
 * are laid out in it, each with its picture, name and price. The same work runs in the browser and on the server, so a
 * choice saves exactly as it was seen; a name or price changed on the ad stays on that ad.
 */
export const MAX_PRODUCTS = 20;

export type ProductItem = Pick<CatalogItem, 'id' | 'name' | 'price' | 'photo'>;

export const productArea = (doc: CanvasDoc) => doc.elements.find((e): e is ShapeElement => e.type === 'rect' && e.role === 'productArea');
export const hasProducts = (doc: CanvasDoc) => !!productArea(doc);

const PT_PER_MM = 72 / 25.4;
/** a cell's width over its height, at which a picture, a name and a price sit well */
const CELL_SHAPE = 0.86;

/** the number of columns that gives the largest cells of the right shape */
function columnsFor(n: number, w: number, h: number, gap: number) {
  let best = 1;
  let score = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    const s = Math.min(cw, ch * CELL_SHAPE);
    if (s > score) {
      score = s;
      best = cols;
    }
  }
  return best;
}

/** The ad with these items in its area, in order; what the last choice put there goes. `src` carries a picture's URL for a preview. */
export function applyProducts<D extends CanvasDoc>(doc: D, items: (ProductItem & { src?: string })[], sample = false): D {
  const area = productArea(doc);
  if (!area) return doc;
  const list = items.slice(0, MAX_PRODUCTS);
  const kept = doc.elements.filter((e) => !e.product);
  const at = kept.indexOf(area) + 1;
  const primary = kept.find((e): e is ShapeElement => e.type === 'rect' && e.colorRole === 'primaryColor')?.fill ?? '#14336B';
  const onPrice = readableOn(primary);

  const gap = Math.min(area.w_mm, area.h_mm) * 0.025;
  const cols = columnsFor(Math.max(list.length, 1), area.w_mm, area.h_mm, gap);
  const rows = Math.ceil(list.length / cols);
  // cells keep their shape, so a few products on a large page stand together in its middle rather than stretching
  const freeW = (area.w_mm - gap * (cols - 1)) / cols;
  const freeH = (area.h_mm - gap * (rows - 1)) / rows;
  const cw = Math.min(freeW, freeH * CELL_SHAPE * 1.25);
  const ch = Math.min(freeH, cw / CELL_SHAPE);
  const top = area.y_mm + (area.h_mm - rows * ch - (rows - 1) * gap) / 2;
  const side = (area.w_mm - cols * cw - (cols - 1) * gap) / 2;

  const cells = list.flatMap((item, i): CanvasElement[] => {
    // the first product stands at the right, as Hebrew reads; a last row that isn't full is centred
    const inRow = i >= list.length - list.length % cols && list.length % cols ? list.length % cols : cols;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const indent = ((cols - inRow) * (cw + gap)) / 2;
    const x = area.x_mm + area.w_mm - side - indent - (col + 1) * cw - col * gap;
    const y = top + row * (ch + gap);
    const pad = cw * 0.06;
    const textH = ch * (item.photo ? 0.38 : 0.7);
    const key = `p_${item.id.slice(0, 40)}`;
    const nameSize = Math.min(cw * 0.115, textH * 0.28) * PT_PER_MM;
    const priceSize = Math.min(cw * 0.135, textH * 0.3) * PT_PER_MM;
    const priceH = (priceSize / PT_PER_MM) * 1.55;
    const out: CanvasElement[] = [
      { id: `${key}_plate`, type: 'rect', product: item.id, x_mm: x, y_mm: y, w_mm: cw, h_mm: ch, rotation: 0, z: 0, fill: '#FFFFFF', cornerRadius_mm: cw * 0.06 },
    ];
    if (item.photo) {
      const room = { w: cw - pad * 2, h: ch - textH - pad * 1.5 };
      const scale = Math.min(room.w / item.photo.width, room.h / item.photo.height);
      const w = item.photo.width * scale;
      const h = item.photo.height * scale;
      out.push({
        id: `${key}_photo`,
        type: 'image',
        product: item.id,
        x_mm: x + (cw - w) / 2,
        y_mm: y + pad + (room.h - h) / 2,
        w_mm: w,
        h_mm: h,
        rotation: 0,
        z: 0,
        asset_id: item.photo.assetId,
        ...(item.src ? { src: item.src } : {}),
      } as CanvasElement);
    }
    const textTop = y + ch - textH;
    out.push({
      id: `${key}_name`,
      type: 'text',
      product: item.id,
      x_mm: x + pad / 2,
      y_mm: textTop,
      w_mm: cw - pad,
      rotation: 0,
      z: 0,
      text: item.name,
      align: 'center',
      editable: true,
      label: `שם מוצר ${i + 1}`,
      font: { family: 'Heebo', weight: 700, size_pt: nameSize, color: '#222222' },
    });
    if (item.price) {
      const py = y + ch - priceH - pad * 0.6;
      out.push(
        { id: `${key}_badge`, type: 'rect', product: item.id, x_mm: x + pad, y_mm: py, w_mm: cw - pad * 2, h_mm: priceH, rotation: 0, z: 0, fill: primary, colorRole: 'primaryColor', cornerRadius_mm: priceH / 2 },
        {
          id: `${key}_price`,
          type: 'text',
          product: item.id,
          x_mm: x + pad,
          y_mm: py + priceH * 0.17,
          w_mm: cw - pad * 2,
          rotation: 0,
          z: 0,
          text: item.price,
          align: 'center',
          editable: true,
          label: `מחיר מוצר ${i + 1}`,
          colorRole: 'onPrimary',
          font: { family: 'Secular One', weight: 400, size_pt: priceSize, color: onPrice },
        },
      );
    }
    return out;
  });

  const { productIds: _old, ...rest } = doc;
  void _old;
  return {
    ...rest,
    ...(sample ? {} : { productIds: list.map((i) => i.id) }),
    elements: [...kept.slice(0, at), ...cells, ...kept.slice(at)].map((e, i) => ({ ...e, z: i })),
  } as D;
}
