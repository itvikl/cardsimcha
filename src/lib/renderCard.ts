import type KonvaNs from 'konva';
import { arcBox, drawArc, hasArc } from './arcText';
import { cropOf, maskPath, pageLook, shapeLook, textLook } from './nodeStyle';
import { loadUploadedFonts } from './fontsClient';
import type { CanvasDoc, CanvasElement } from './types';

/** an image element as GET /api/templates/canvas sends it: with the URL of its picture */
export type DrawableElement = CanvasElement & { src?: string | null };
export type DrawableDoc = Omit<CanvasDoc, 'elements'> & { elements: DrawableElement[] };

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/**
 * Draws a card off screen and returns it as a JPEG data URL, `width` pixels wide. Mirrors the editor's
 * drawing (Editor.tsx: same Konva nodes, line height and wrapping) so a preview matches what opens in the editor.
 */
export async function renderCard(doc: DrawableDoc, width = 500): Promise<string> {
  const stage = await drawCard(doc, width);
  const url = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.86 });
  stage.destroy();
  return url;
}

/** The card without its texts, as pixels: what its texts have to read against (see fitColor.ts). */
export async function cardPixels(doc: DrawableDoc, width = 240): Promise<ImageData> {
  const stage = await drawCard({ ...doc, elements: doc.elements.filter((e) => e.type !== 'text') }, width);
  const canvas = stage.toCanvas({ pixelRatio: 1 });
  stage.destroy();
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
}

async function drawCard(doc: DrawableDoc, width: number) {
  const { default: Konva } = await import('konva');
  await loadUploadedFonts();
  const px = width / doc.page.width_mm;
  const fonts = new Set(doc.elements.flatMap((e) => (e.type === 'text' ? [`${e.font.weight} 16px "${e.font.family}"`] : [])));
  const [images] = await Promise.all([
    Promise.all(doc.elements.map((e) => (e.type === 'image' && e.src && !e.colorOverride ? loadImage(e.src) : Promise.resolve(null)))),
    Promise.allSettled([...fonts].map((f) => document.fonts.load(f, 'אבגabc'))),
  ]);

  const stage = new Konva.Stage({ container: document.createElement('div'), width, height: doc.page.height_mm * px });
  const layer = new Konva.Layer();
  stage.add(layer);
  const pageH = doc.page.height_mm * px;
  layer.add(new Konva.Rect({ x: 0, y: 0, width, height: pageH, fill: doc.page.background, ...pageLook(doc.page, width, pageH) }));
  doc.elements.forEach((e, i) => {
    if (e.hidden) return;
    const box = { x: e.x_mm * px, y: e.y_mm * px, width: e.w_mm * px, rotation: e.rotation };
    if (e.type === 'image') {
      const img = images[i];
      const h = e.h_mm * px;
      const node = e.colorOverride
        ? new Konva.Rect({ width: box.width, height: h, fill: e.colorOverride })
        : img
          ? new Konva.Image({ width: box.width, height: h, image: img, crop: cropOf(e, img.naturalWidth, img.naturalHeight) })
          : null;
      if (!node) return;
      const mask = e.mask;
      const group = new Konva.Group({ ...box, ...(mask ? { clipFunc: (ctx: KonvaNs.Context) => maskPath(ctx._context, mask, box.width, h) } : {}) });
      group.add(node);
      layer.add(group);
    } else if (e.type === 'rect') {
      layer.add(new Konva.Rect({ ...box, height: e.h_mm * px, fill: e.fill, cornerRadius: (e.cornerRadius_mm ?? 0) * px, opacity: e.opacity ?? 1, ...shapeLook(e, px) }));
    } else if (hasArc(e)) {
      layer.add(new Konva.Shape({ ...box, height: arcBox(e, px).height, sceneFunc: (ctx) => drawArc(ctx._context, e, px) }));
    } else {
      layer.add(
        new Konva.Text({
          ...box,
          text: e.text,
          align: e.align,
          direction: 'rtl', // same as the editor; this stage is off the page, so it would not inherit it
          fontFamily: e.font.family,
          fontStyle: e.font.weight === 700 ? 'bold' : 'normal',
          fill: e.font.color,
          ...textLook(e, px),
          wrap: 'word',
        }),
      );
    }
  });
  layer.draw();
  return stage;
}
