import type { ImageAsset } from './types';

/** the longest side a business's picture is kept at; 5MB is the upload's limit */
const MAX_SIDE = 2000;

export type PickedPicture = { canvas: HTMLCanvasElement; file: File };

/** A chosen file, drawn so its pixels can be read. */
export function readPicture(file: File): Promise<PickedPicture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ canvas, file });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('הקובץ אינו תמונה תקינה'));
    };
    img.src = url;
  });
}

const blobOf = (canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg') =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('לא הצלחנו להכין את הקובץ'))), type, 0.9));

/** Stores a drawn picture as the business's own; answers with its library row. */
export async function uploadPicture(canvas: HTMLCanvasElement, o: { name?: string; sticker?: boolean; type?: 'image/png' | 'image/jpeg' } = {}): Promise<ImageAsset> {
  const type = o.type ?? 'image/png';
  const blob = await blobOf(canvas, type);
  const form = new FormData();
  form.set('file', new File([blob], type === 'image/png' ? 'picture.png' : 'picture.jpg', { type }));
  form.set('width', String(canvas.width));
  form.set('height', String(canvas.height));
  if (o.name) form.set('name', o.name);
  if (o.sticker) form.set('sticker', 'true');
  const res = await fetch('/api/my-images', { method: 'POST', body: form });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'ההעלאה נכשלה');
  return d;
}

/** A background from the business's two colours, in the shape of the place it goes. */
export function gradientPicture(primary: string, secondary: string, ratio: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ratio >= 1 ? 1600 : Math.round(1600 * ratio);
  canvas.height = ratio >= 1 ? Math.round(1600 / ratio) : 1600;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, primary);
  g.addColorStop(1, secondary);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
