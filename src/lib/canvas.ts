import { coverBox } from './adText';
import { ARC_LIMIT } from './arcText';
import { isBrandColorRole, isBrandTextRole } from './brand';
import { isShabbatRole } from './shabbatDoc';
import { isLoopId } from './shabbatLoops';
import type { CanvasDoc, CanvasElement } from './types';

export const PAGE_PRESETS = [
  { id: 'a4', label: 'A4 לאורך', width_mm: 210, height_mm: 297 },
  { id: 'a4l', label: 'A4 לרוחב', width_mm: 297, height_mm: 210 },
  { id: 'a5', label: 'A5 לאורך', width_mm: 148, height_mm: 210 },
  { id: 'square', label: 'ריבוע (לשיתוף)', width_mm: 200, height_mm: 200 },
  { id: 'story', label: 'סטורי 9:16', width_mm: 108, height_mm: 192 },
] as const;

export const FONTS = ['Heebo', 'Frank Ruhl Libre', 'Assistant', 'Secular One', 'Arial'] as const;
/** what a business chooses from for a text of its own: a short list, plus what an admin offers it in /fonts */
export const CUSTOMER_FONTS: string[] = ['Heebo', 'Frank Ruhl Libre', 'Assistant', 'Secular One'];

export const emptyDoc = (width_mm = 210, height_mm = 297): CanvasDoc => ({
  schema_version: 1,
  page: { width_mm, height_mm, background: '#FAF8F3' },
  elements: [],
});

const MAX_ELEMENTS = 300;
const isNum = (v: unknown, min = -5000, max = 5000): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Returns a sanitized doc, or null when the input is not a valid canvas document. */
export function validateDoc(input: unknown): CanvasDoc | null {
  const d = input as CanvasDoc | null;
  if (!d || d.schema_version !== 1 || !d.page || !Array.isArray(d.elements)) return null;
  const { width_mm, height_mm, background, background2, backgroundAngle } = d.page;
  if (!isNum(width_mm, 20, 2000) || !isNum(height_mm, 20, 2000) || !isColor(background)) return null;
  if (background2 !== undefined && !isColor(background2)) return null;
  if (backgroundAngle !== undefined && !isNum(backgroundAngle, -360, 360)) return null;
  if (d.elements.length > MAX_ELEMENTS) return null;

  const ids = new Set<string>();
  const elements: CanvasElement[] = [];
  for (const e of d.elements) {
    if (!e || typeof e.id !== 'string' || e.id.length > 64 || ids.has(e.id)) return null;
    ids.add(e.id);
    if (!isNum(e.x_mm) || !isNum(e.y_mm) || !isNum(e.rotation, -360, 360) || !isNum(e.z, -1e6, 1e6)) return null;
    if (e.group !== undefined && (typeof e.group !== 'string' || e.group.length > 64)) return null;
    if (e.locked !== undefined && typeof e.locked !== 'boolean') return null;
    if (e.hidden !== undefined && typeof e.hidden !== 'boolean') return null;
    if (e.type === 'text') {
      if (typeof e.text !== 'string' || e.text.length > 2000) return null;
      if (!isNum(e.w_mm, 1, 2000)) return null;
      if (!['right', 'center', 'left'].includes(e.align)) return null;
      if (e.editable !== undefined && typeof e.editable !== 'boolean') return null;
      if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 60)) return null;
      if (e.role !== undefined && !isBrandTextRole(e.role)) return null;
      if (e.colorRole !== undefined && !isBrandColorRole(e.colorRole)) return null;
      if (e.shabbatRole !== undefined && !isShabbatRole(e.shabbatRole)) return null;
      if (e.credit !== undefined && typeof e.credit !== 'boolean') return null;
      if (e.detail !== undefined && typeof e.detail !== 'boolean') return null;
      if (e.designColor !== undefined && !isColor(e.designColor)) return null;
      if (e.arc !== undefined && !isNum(e.arc, -ARC_LIMIT, ARC_LIMIT)) return null;
      if (e.letterSpacing !== undefined && !isNum(e.letterSpacing, -20, 100)) return null;
      if (e.lineHeight !== undefined && !isNum(e.lineHeight, 0.6, 4)) return null;
      if (e.fit !== undefined && e.fit !== 'shrink') return null;
      if (e.shadow !== undefined && typeof e.shadow !== 'boolean') return null;
      if (e.stroke !== undefined && !(isColor(e.stroke?.color) && isNum(e.stroke.width_mm, 0.05, 10))) return null;
      if (e.foil !== undefined && e.foil !== 'gold' && e.foil !== 'silver') return null;
      const f = e.font;
      if (!f || typeof f.family !== 'string' || f.family.length > 60) return null;
      if (!(f.weight === 400 || f.weight === 700) || !isNum(f.size_pt, 4, 400) || !isColor(f.color)) return null;
      elements.push({ ...e });
    } else if (e.type === 'image') {
      if (!isNum(e.w_mm, 1, 2000) || !isNum(e.h_mm, 1, 2000) || typeof e.asset_id !== 'string') return null;
      if (e.swappable !== undefined && typeof e.swappable !== 'boolean') return null;
      if (e.colorOverride !== undefined && !isColor(e.colorOverride)) return null;
      if (e.swapCategoryId !== undefined && (typeof e.swapCategoryId !== 'string' || e.swapCategoryId.length > 64)) return null;
      if (e.label !== undefined && (typeof e.label !== 'string' || e.label.length > 60)) return null;
      if (e.role !== undefined && e.role !== 'logo' && e.role !== 'photo' && e.role !== 'sticker') return null;
      if (e.photoBox !== undefined && !(isNum(e.photoBox?.x_mm) && isNum(e.photoBox.y_mm) && isNum(e.photoBox.w_mm, 1, 2000) && isNum(e.photoBox.h_mm, 1, 2000))) return null;
      if (e.loopId !== undefined && !isLoopId(e.loopId)) return null;
      if (e.mask !== undefined && e.mask !== 'circle' && e.mask !== 'rounded' && e.mask !== 'arch') return null;
      if (e.crop !== undefined && !(isNum(e.crop?.zoom, 1, 8) && isNum(e.crop.x, -1, 1) && isNum(e.crop.y, -1, 1))) return null;
      elements.push({ ...e });
    } else if (e.type === 'rect') {
      if (!isNum(e.w_mm, 1, 2000) || !isNum(e.h_mm, 1, 2000) || !isColor(e.fill)) return null;
      if (e.colorRole !== undefined && !isBrandColorRole(e.colorRole)) return null;
      if (e.role !== undefined && e.role !== 'logoPlate' && e.role !== 'productArea') return null;
      if (e.cornerRadius_mm !== undefined && !isNum(e.cornerRadius_mm, 0, 1000)) return null;
      if (e.opacity !== undefined && !isNum(e.opacity, 0, 1)) return null;
      if (e.fill2 !== undefined && !isColor(e.fill2)) return null;
      if (e.angle !== undefined && !isNum(e.angle, -360, 360)) return null;
      elements.push({ ...e });
    } else {
      return null;
    }
  }
  if (d.wordingId !== undefined && (typeof d.wordingId !== 'string' || d.wordingId.length > 64)) return null;
  if (d.backdropId !== undefined && (typeof d.backdropId !== 'string' || d.backdropId.length > 80)) return null;
  const productIds = Array.isArray(d.productIds) && d.productIds.every((i) => typeof i === 'string' && i.length <= 64) ? { productIds: d.productIds.slice(0, 40) } : {};
  const page = { width_mm, height_mm, background, ...(background2 ? { background2, backgroundAngle: backgroundAngle ?? 0 } : {}) };
  return { schema_version: 1, page, elements, ...(d.wordingId ? { wordingId: d.wordingId } : {}), ...(d.backdropId ? { backdropId: d.backdropId } : {}), ...productIds };
}

export const MAX_STICKERS = 12;
export const MAX_OWN_TEXTS = 10;

/** the library images a customer may see; the routes pass only those, so another business's pictures never count here */
type CustomerAsset = { id: string; categoryId: string; sticker?: boolean; ownSticker?: boolean; width?: number; height?: number };

/** The stickers a client sent, as far as they are real: pictures of the sticker library or the business's own, and inside the page's reach. */
function sentStickers(page: CanvasDoc['page'], sent: CanvasElement[], assets: CustomerAsset[], taken: Set<string>): CanvasElement[] {
  const seen = new Set(taken);
  const out: CanvasElement[] = [];
  for (const e of sent) {
    if (out.length === MAX_STICKERS) break;
    if (!e || e.type !== 'image' || e.role !== 'sticker' || typeof e.id !== 'string' || e.id.length > 64 || seen.has(e.id)) continue;
    if (!assets.some((a) => a.id === e.asset_id && (a.sticker || a.ownSticker))) continue;
    if (!isNum(e.x_mm) || !isNum(e.y_mm) || !isNum(e.w_mm, 1, 2000) || !isNum(e.h_mm, 1, 2000) || !isNum(e.rotation, -360, 360)) continue;
    seen.add(e.id);
    const w = clampTo(e.w_mm, 3, page.width_mm * 2);
    const h = clampTo(e.h_mm, 3, page.height_mm * 2);
    out.push({
      id: e.id,
      type: 'image',
      x_mm: clampTo(e.x_mm, -w / 2, page.width_mm - w / 2),
      y_mm: clampTo(e.y_mm, -h / 2, page.height_mm - h / 2),
      w_mm: w,
      h_mm: h,
      rotation: e.rotation,
      z: 0,
      asset_id: e.asset_id,
      role: 'sticker',
    });
  }
  return out;
}

/** The texts a business wrote itself, as far as they are real: its own words, in the fonts it is offered, inside the page's reach. */
function sentOwnTexts(page: CanvasDoc['page'], sent: CanvasElement[], fonts: string[], taken: Set<string>): CanvasElement[] {
  const seen = new Set(taken);
  const out: CanvasElement[] = [];
  for (const e of sent) {
    if (out.length === MAX_OWN_TEXTS) break;
    if (!e || e.type !== 'text' || !e.own || typeof e.id !== 'string' || e.id.length > 64 || seen.has(e.id) || typeof e.text !== 'string') continue;
    if (!isNum(e.x_mm) || !isNum(e.y_mm) || !isNum(e.w_mm, 1, 2000) || !isNum(e.font?.size_pt, 4, 400) || !isColor(e.font?.color)) continue;
    seen.add(e.id);
    const w = clampTo(e.w_mm, 5, page.width_mm);
    out.push({
      id: e.id,
      type: 'text',
      own: true,
      editable: true,
      label: typeof e.label === 'string' ? e.label.slice(0, 60) : 'טקסט שלי',
      x_mm: clampTo(e.x_mm, 0, page.width_mm - 5),
      y_mm: clampTo(e.y_mm, 0, page.height_mm - 5),
      w_mm: w,
      rotation: 0,
      z: 0,
      text: e.text.slice(0, 500),
      align: e.align === 'right' || e.align === 'left' ? e.align : 'center',
      font: { family: fonts.includes(e.font.family) ? e.font.family : fonts[0], weight: e.font.weight === 700 ? 700 : 400, size_pt: e.font.size_pt, color: e.font.color },
    });
  }
  return out;
}

/** a business's ad, which it can do more with than a card it fills in: its own texts, in these fonts, and any picture it can see in the photo's place */
export type FreeEdits = { fonts: string[] };

/**
 * What a customer may change in their copy: the text of elements the admin marked editable, and their own stickers;
 * with `free`, also their own texts and the ad's photograph. Everything else is taken from the stored doc, never from the client.
 */
export function applyCustomerEdits(
  stored: CanvasDoc,
  incoming: unknown,
  assets: CustomerAsset[] = [],
  free: FreeEdits | null = null,
): CanvasDoc | null {
  const inc = incoming as CanvasDoc | null;
  if (!inc || !Array.isArray(inc.elements)) return null;
  const texts = new Map<string, string>();
  const pos = new Map<string, { x: number; y: number }>();
  const colors = new Map<string, string>();
  const swaps = new Map<string, { asset: string; color?: string }>();
  for (const e of inc.elements) {
    if (e && e.type === 'image' && typeof e.id === 'string' && typeof e.asset_id === 'string') {
      swaps.set(e.id, { asset: e.asset_id, color: isColor(e.colorOverride) ? e.colorOverride : undefined });
    }
    if (e && e.type === 'text' && typeof e.id === 'string' && typeof e.text === 'string') {
      texts.set(e.id, e.text);
      if (isColor(e.font?.color)) colors.set(e.id, e.font.color);
      if (typeof e.x_mm === 'number' && typeof e.y_mm === 'number') pos.set(e.id, { x: e.x_mm, y: e.y_mm });
    }
  }
  const kept = stored.elements.filter((e) => !(e.type === 'image' && e.role === 'sticker') && !(e.type === 'text' && e.own));
  const taken = new Set(kept.map((e) => e.id));
  const ownTexts = free ? sentOwnTexts(stored.page, inc.elements, free.fonts, taken) : [];
  ownTexts.forEach((e) => taken.add(e.id));
  // stickers and own texts stand in the order the client has them, so "to the front" means the same on both sides
  const order = new Map(inc.elements.map((e, i) => [e?.id, i]));
  const added = [...ownTexts, ...sentStickers(stored.page, inc.elements, assets, taken)]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((e, i) => ({ ...e, z: kept.length + i }));
  return {
    ...stored,
    elements: [...kept.map((e) => {
      if (free && e.type === 'image' && e.role === 'photo' && e.photoBox) {
        const sent = swaps.get(e.id);
        if (!sent) return e;
        const { colorOverride: _old, ...rest } = e;
        void _old;
        const asset = assets.find((a) => a.id === sent.asset);
        const moved = asset?.width && asset.height && sent.asset !== e.asset_id ? { asset_id: asset.id, ...coverBox(e.photoBox, asset.width, asset.height) } : {};
        return { ...rest, ...moved, ...(sent.color ? { colorOverride: sent.color } : {}) };
      }
      if (e.type === 'image' && e.swappable) {
        // only an image from the category the admin chose (or any category when none was chosen)
        const sent = swaps.get(e.id);
        if (!sent) return e;
        const ok = assets.some((a) => a.id === sent.asset && (!e.swapCategoryId || a.categoryId === e.swapCategoryId));
        // a flat colour replaces the image; picking an image again (no colour sent) clears it
        const { colorOverride: _old, ...rest } = e;
        void _old;
        return { ...rest, asset_id: ok ? sent.asset : e.asset_id, ...(sent.color ? { colorOverride: sent.color } : {}) };
      }
      if (e.type !== 'text' || !e.editable) return e;
      const sent = pos.get(e.id);
      const text = texts.get(e.id);
      const color = colors.get(e.id);
      // position stays inside the page; anything that is not a finite number is ignored
      const x = sent && Number.isFinite(sent.x) ? clampTo(sent.x, 0, stored.page.width_mm - 5) : e.x_mm;
      const y = sent && Number.isFinite(sent.y) ? clampTo(sent.y, 0, stored.page.height_mm - 5) : e.y_mm;
      return {
        ...e,
        x_mm: x,
        y_mm: y,
        text: text === undefined ? e.text : text.slice(0, 500),
        font: color ? { ...e.font, color } : e.font, // only the colour of the font; size/family stay as designed
      };
    }), ...added],
  };
}

const clampTo = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/** The library images a client-sent canvas points at: all `applyCustomerEdits` needs to look up. */
export function sentAssetIds(incoming: unknown): string[] {
  const els = (incoming as CanvasDoc | null)?.elements;
  if (!Array.isArray(els)) return [];
  return els.flatMap((e) => (e?.type === 'image' && typeof e.asset_id === 'string' ? [e.asset_id] : [])).slice(0, 200);
}
