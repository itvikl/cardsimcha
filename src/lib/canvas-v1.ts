import { LOCKED, validateDoc } from './canvas';
import type { BackgroundLayer, CanvasDoc, CanvasElement, Locks } from './types';

// Card format v1 (schema_version 1) and its conversion to v2 (design doc §5).
// v1: one flat element list ordered by `z`, the page colour on `page.background`, and two
// flags for customers: `editable` on texts and `swappable` on images.

type V1Base = { id: string; x_mm: number; y_mm: number; rotation: number; z: number };
type V1Text = V1Base & {
  type: 'text';
  w_mm: number;
  text: string;
  align: 'right' | 'center' | 'left';
  editable?: boolean;
  label?: string;
  font: { family: string; weight: number; size_pt: number; color: string };
};
type V1Image = V1Base & {
  type: 'image';
  w_mm: number;
  h_mm: number;
  asset_id: string;
  swappable?: boolean;
  swapCategoryId?: string;
  colorOverride?: string;
  label?: string;
};
type V1Rect = V1Base & { type: 'rect'; w_mm: number; h_mm: number; fill: string };
type V1Element = V1Text | V1Image | V1Rect;
export type CanvasDocV1 = {
  schema_version: 1;
  page: { width_mm: number; height_mm: number; background: string };
  elements: V1Element[];
};

/** today's customers may also drag the texts they edit */
const V1_TEXT_LOCKS: Locks = { content: true, transform: true, delete: false, style: true };
const SWAP_LOCKS: Locks = { ...LOCKED, content: true };
const TOLERANCE_MM = 1;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function coversPage(e: V1Image, w: number, h: number) {
  return (
    Math.abs(num(e.rotation)) < 0.01 &&
    e.x_mm <= TOLERANCE_MM &&
    e.y_mm <= TOLERANCE_MM &&
    e.x_mm + e.w_mm >= w - TOLERANCE_MM &&
    e.y_mm + e.h_mm >= h - TOLERANCE_MM
  );
}

/**
 * v1 → v2, a pure function:
 * 1. page.background → background fill
 * 2. the lowest-z image covering the whole page (±1 mm) → background image
 * 3. everything else, sorted by z → content (rect → shape)
 * 4. editable text → content + transform + style locks and a field; other texts locked
 * 5. swappable image → content lock, swap collection and field
 * Null when the result is not a valid v2 doc.
 */
export function migrateV1(v1: CanvasDocV1): CanvasDoc | null {
  const { width_mm: W, height_mm: H } = v1.page;
  const sorted = [...(v1.elements ?? [])].filter(Boolean).sort((a, b) => num(a.z) - num(b.z));
  const bgImage = sorted.find((e): e is V1Image => e.type === 'image' && coversPage(e, W, H));

  const background: BackgroundLayer = { fill: { type: 'solid', color: v1.page.background }, locks: LOCKED };
  if (bgImage) {
    background.image = { asset_id: bgImage.asset_id, fit: 'cover', ...(bgImage.colorOverride && { colorOverride: bgImage.colorOverride }) };
    if (bgImage.swappable) {
      background.locks = SWAP_LOCKS;
      background.field = { label: bgImage.label || 'רקע' };
      if (bgImage.swapCategoryId) background.swap_collection_id = bgImage.swapCategoryId;
    }
  }

  const content: CanvasElement[] = [];
  for (const e of sorted) {
    if (e === bgImage) continue;
    const base = { id: e.id, x_mm: num(e.x_mm), y_mm: num(e.y_mm), rotation: num(e.rotation) };
    if (e.type === 'text') {
      content.push({
        ...base,
        type: 'text',
        w_mm: e.w_mm,
        text: e.text,
        align: e.align,
        font: { family: e.font.family, weight: e.font.weight, size_pt: e.font.size_pt, color: e.font.color },
        locks: e.editable ? V1_TEXT_LOCKS : LOCKED,
        ...(e.editable && { field: { label: e.label || 'טקסט' } }),
      });
    } else if (e.type === 'image') {
      content.push({
        ...base,
        type: 'image',
        w_mm: e.w_mm,
        h_mm: e.h_mm,
        asset_id: e.asset_id,
        locks: e.swappable ? SWAP_LOCKS : LOCKED,
        ...(e.swappable && { field: { label: e.label || 'תמונה' } }),
        ...(e.swappable && e.swapCategoryId && { swap_collection_id: e.swapCategoryId }),
        ...(e.colorOverride && { colorOverride: e.colorOverride }),
      });
    } else if (e.type === 'rect') {
      content.push({ ...base, type: 'shape', shape: 'rect', w_mm: e.w_mm, h_mm: e.h_mm, fill: { type: 'solid', color: e.fill }, locks: LOCKED });
    }
  }
  return validateDoc({ schema_version: 2, page: { width_mm: W, height_mm: H }, layers: { background, content, overlay: [] } });
}

/** Any stored card as v2: v2 is validated, v1 converted. Null when neither works. */
export function toV2(raw: unknown): CanvasDoc | null {
  const v = (raw as { schema_version?: unknown } | null)?.schema_version;
  if (v === 2) return validateDoc(raw);
  if (v === 1) {
    try {
      return migrateV1(raw as CanvasDocV1);
    } catch {
      return null;
    }
  }
  return null;
}
