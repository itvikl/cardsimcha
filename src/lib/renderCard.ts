import type { CanvasDoc, CanvasElement } from './types';

/** an image element as GET /api/templates/canvas sends it: with the URL of its picture */
export type DrawableElement = CanvasElement & { src?: string | null };
export type DrawableDoc = Omit<CanvasDoc, 'elements'> & { elements: DrawableElement[] };

const PT_TO_MM = 25.4 / 72;

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
  const px = width / doc.page.width_mm;
  const fonts = new Set(doc.elements.flatMap((e) => (e.type === 'text' ? [`${e.font.weight} 16px "${e.font.family}"`] : [])));
  const [images] = await Promise.all([
    Promise.all(doc.elements.map((e) => (e.type === 'image' && e.src && !e.colorOverride ? loadImage(e.src) : Promise.resolve(null)))),
    Promise.allSettled([...fonts].map((f) => document.fonts.load(f, 'אבגabc'))),
  ]);

  const stage = new Konva.Stage({ container: document.createElement('div'), width, height: doc.page.height_mm * px });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(new Konva.Rect({ x: 0, y: 0, width, height: doc.page.height_mm * px, fill: doc.page.background }));
  doc.elements.forEach((e, i) => {
    const box = { x: e.x_mm * px, y: e.y_mm * px, width: e.w_mm * px, rotation: e.rotation };
    if (e.type === 'image') {
      const img = images[i];
      if (e.colorOverride) layer.add(new Konva.Rect({ ...box, height: e.h_mm * px, fill: e.colorOverride }));
      else if (img) layer.add(new Konva.Image({ ...box, height: e.h_mm * px, image: img }));
    } else if (e.type === 'rect') {
      layer.add(new Konva.Rect({ ...box, height: e.h_mm * px, fill: e.fill, cornerRadius: (e.cornerRadius_mm ?? 0) * px, opacity: e.opacity ?? 1 }));
    } else {
      layer.add(
        new Konva.Text({
          ...box,
          text: e.text,
          align: e.align,
          direction: 'rtl', // same as the editor; this stage is off the page, so it would not inherit it
          fontFamily: e.font.family,
          fontStyle: e.font.weight === 700 ? 'bold' : 'normal',
          fontSize: e.font.size_pt * PT_TO_MM * px,
          fill: e.font.color,
          lineHeight: 1.25,
          wrap: 'word',
        }),
      );
    }
  });
  layer.draw();
  return stage;
}
