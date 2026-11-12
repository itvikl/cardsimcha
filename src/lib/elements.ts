import type { CanvasDoc, ImageAsset, ImageElement, ShapeElement, TextElement } from './types';

/** Default new elements, shared by the editor's "add" buttons and the agent. */
export function newText(doc: CanvasDoc, text = 'לחצו לעריכת הטקסט'): TextElement {
  const w = Math.min(120, doc.page.width_mm - 20);
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x_mm: (doc.page.width_mm - w) / 2,
    y_mm: doc.page.height_mm / 3,
    w_mm: w,
    rotation: 0,
    z: doc.elements.length,
    text,
    align: 'center',
    editable: true,
    label: 'טקסט',
    font: { family: 'Heebo', weight: 700, size_pt: 32, color: '#1F3A2E' },
  };
}

export function newRect(doc: CanvasDoc): ShapeElement {
  return {
    id: crypto.randomUUID(),
    type: 'rect',
    x_mm: doc.page.width_mm / 4,
    y_mm: doc.page.height_mm / 4,
    w_mm: doc.page.width_mm / 2,
    h_mm: doc.page.height_mm / 6,
    rotation: 0,
    z: doc.elements.length,
    fill: '#E4ECE3',
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
    z: doc.elements.length,
    asset_id: asset.id,
  };
}

export type DividerKind = 'line' | 'diamond' | 'dots' | 'double';
export const DIVIDERS: { id: DividerKind; label: string }[] = [
  { id: 'line', label: 'קו' },
  { id: 'diamond', label: 'קו ויהלום' },
  { id: 'dots', label: 'שלוש נקודות' },
  { id: 'double', label: 'קו כפול' },
];

/** A divider between lines of text: a few shapes in one group, across the middle of the page, so they move as one. */
export function newDivider(doc: CanvasDoc, kind: DividerKind, color = '#B8892F'): ShapeElement[] {
  const group = crypto.randomUUID();
  const W = doc.page.width_mm;
  const w = Math.min(70, W * 0.42);
  const x = (W - w) / 2;
  const y = doc.page.height_mm / 2;
  const t = Math.max(0.35, W / 300);
  const z = doc.elements.length;
  const shape = (s: Partial<ShapeElement> & Pick<ShapeElement, 'x_mm' | 'y_mm' | 'w_mm' | 'h_mm'>, i: number): ShapeElement => ({
    id: crypto.randomUUID(),
    type: 'rect',
    rotation: 0,
    z: z + i,
    fill: color,
    group,
    ...s,
  });
  if (kind === 'line') return [shape({ x_mm: x, y_mm: y, w_mm: w, h_mm: t }, 0)];
  if (kind === 'double') return [shape({ x_mm: x, y_mm: y - t * 1.6, w_mm: w, h_mm: t }, 0), shape({ x_mm: x, y_mm: y + t * 1.6, w_mm: w, h_mm: t }, 1)];
  const d = Math.max(1.6, w / 22);
  if (kind === 'dots') {
    return [-1, 0, 1].map((k, i) => shape({ x_mm: W / 2 + k * d * 2.6 - d / 2, y_mm: y - d / 2, w_mm: d, h_mm: d, cornerRadius_mm: d / 2 }, i));
  }
  // a diamond between two lines: a square turned 45° about its corner, so its middle stays on the line
  const side = d * 1.3;
  const gap = side * 1.4;
  return [
    shape({ x_mm: x, y_mm: y - t / 2, w_mm: w / 2 - gap, h_mm: t }, 0),
    shape({ x_mm: W / 2 + gap, y_mm: y - t / 2, w_mm: w / 2 - gap, h_mm: t }, 1),
    shape({ x_mm: W / 2, y_mm: y - (side * Math.SQRT2) / 2, w_mm: side, h_mm: side, rotation: 45 }, 2),
  ];
}
