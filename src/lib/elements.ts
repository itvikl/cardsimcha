import { FIELD_LOCKS, LOCKED } from './canvas';
import type { CanvasDoc, ImageAsset, ImageElement, ShapeElement, TextElement } from './types';

/**
 * Default new elements, shared by the editor's "add" buttons and the agent. A new text is
 * a customer form field (they may change its text and colour, design doc §4.3); new
 * images and shapes are locked until the author unlocks them.
 */
export function newText(doc: CanvasDoc, text = 'לחצו לעריכת הטקסט'): TextElement {
  const w = Math.min(120, doc.page.width_mm - 20);
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x_mm: (doc.page.width_mm - w) / 2,
    y_mm: doc.page.height_mm / 3,
    w_mm: w,
    rotation: 0,
    text,
    align: 'center',
    locks: FIELD_LOCKS,
    field: { label: 'טקסט' },
    font: { family: 'Heebo', weight: 700, size_pt: 32, color: '#1F3A2E' },
  };
}

export function newRect(doc: CanvasDoc): ShapeElement {
  return {
    id: crypto.randomUUID(),
    type: 'shape',
    shape: 'rect',
    x_mm: doc.page.width_mm / 4,
    y_mm: doc.page.height_mm / 4,
    w_mm: doc.page.width_mm / 2,
    h_mm: doc.page.height_mm / 6,
    rotation: 0,
    locks: LOCKED,
    fill: { type: 'solid', color: '#E4ECE3' },
  };
}

export function newImage(doc: CanvasDoc, asset: ImageAsset): ImageElement {
  let w = Math.min(doc.page.width_mm * 0.6, 200);
  let h = (w * asset.height) / asset.width;
  const maxH = doc.page.height_mm * 0.7;
  if (h > maxH) {
    h = maxH;
    w = (h * asset.width) / asset.height;
  }
  return {
    id: crypto.randomUUID(),
    type: 'image',
    x_mm: (doc.page.width_mm - w) / 2,
    y_mm: (doc.page.height_mm - h) / 2,
    w_mm: w,
    h_mm: h,
    rotation: 0,
    locks: LOCKED,
    asset_id: asset.id,
  };
}
