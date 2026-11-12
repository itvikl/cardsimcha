import { heightOf } from './adText';
import type { BrandKit, CanvasDoc, CanvasElement, TextElement } from './types';

/**
 * The foot of a business's ad: the details beyond its name and phone, with small icons, and its QR code.
 * Worked out from where the design's phone stands, so it fits every layout and size. Icons are library pictures
 * made by scripts/seed-content.ts --only=business, under these fixed ids.
 */
const ICONS = {
  phone: { light: '3b05b41c-04b5-3807-099f-dbbff1f23a97', dark: 'b5be62e2-bdda-192c-4de5-56fc9b70b7bb' },
  pin: { light: '6cd9782c-f99d-f5e3-2c4c-3baa0d7a86b0', dark: '2c2d4c6f-0083-1f02-3523-7d944d892b0f' },
  globe: { light: 'e8d5d0e2-9ca9-3f30-880d-fd6d5779ff0b', dark: '6b4e97e4-ba9d-e9e2-02f2-3c204f949d62' },
};

export const STRIP_PREFIX = 'strip_';

const PT_TO_MM = 25.4 / 72;
/** what a design's phone is drawn at when it is at scale 1 (see contactBar in scripts/seed-content.ts) */
const PHONE_PT = 17;

/** a line's width in mm, as far as it can be told away from a canvas */
const widthOf = (t: string, sizePt: number) => t.length * sizePt * PT_TO_MM * 0.56;

const isLight = (hex: string) => parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11 > 150;

const image = (id: string, asset: string, x: number, y: number, w: number, h: number): CanvasElement => ({
  id: STRIP_PREFIX + id,
  type: 'image',
  x_mm: x,
  y_mm: y,
  w_mm: w,
  h_mm: h,
  rotation: 0,
  z: 0,
  asset_id: asset,
});

/** The ad with its strip. Only an ad has one: a design with a call to action and a phone. */
export function addStrip<D extends CanvasDoc>(doc: D, kit: BrandKit): D {
  const phone = doc.elements.find((e): e is TextElement => e.type === 'text' && e.role === 'phone');
  const isAd = doc.elements.some((e) => e.type === 'text' && e.label === 'קריאה לפעולה');
  if (!phone || !isAd || doc.elements.some((e) => e.id.startsWith(STRIP_PREFIX))) return doc;

  const { width_mm: pw, height_mm: ph } = doc.page;
  const fs = phone.font.size_pt / PHONE_PT;
  const margin = 5 * fs;
  const tone = isLight(phone.font.color) ? 'light' : 'dark';
  const added: CanvasElement[] = [];

  // the QR stands in the corner beside the details
  let left = margin;
  if (kit.qr) {
    const size = 19 * fs;
    const x = 4 * fs;
    const y = ph - size - 4 * fs;
    added.push({ id: STRIP_PREFIX + 'qr_plate', type: 'rect', x_mm: x - 1 * fs, y_mm: y - 1 * fs, w_mm: size + 2 * fs, h_mm: size + 2 * fs, rotation: 0, z: 0, fill: '#FFFFFF', cornerRadius_mm: 1.5 * fs });
    added.push(image('qr', kit.qr.assetId, x, y, size, size));
    left = x + size + 3 * fs;
  }

  const iconSize = 4 * fs;
  if (phone.text.trim()) {
    const center = phone.x_mm + phone.w_mm / 2;
    const half = widthOf(phone.text.trim(), phone.font.size_pt) / 2;
    added.push(image('phone', ICONS.phone[tone], center + half + 1.5 * fs, phone.y_mm + 1.6 * fs, iconSize, iconSize));
  }

  // address and website, each with its icon, on one line under the phone
  const lineY = phone.y_mm + heightOf(phone.text, phone.font.size_pt, phone.w_mm) + 0.4 * fs;
  const parts = [
    { key: 'address' as const, icon: ICONS.pin, text: kit.address.trim() },
    { key: 'website' as const, icon: ICONS.globe, text: kit.website.trim() },
  ].filter((p) => p.text);
  const size = 8.5 * fs;
  if (parts.length && lineY + size * PT_TO_MM * 1.25 <= ph) {
    const room = (pw - margin - left) / parts.length;
    parts.forEach((p, i) => {
      const fits = Math.min(size, ((room - iconSize - 1.5 * fs) / (p.text.length * PT_TO_MM * 0.56)));
      const w = room - iconSize - 1.5 * fs;
      const x = left + room * i;
      const used = Math.min(widthOf(p.text, fits), w);
      added.push({
        id: STRIP_PREFIX + p.key,
        type: 'text',
        x_mm: x,
        y_mm: lineY,
        w_mm: w,
        rotation: 0,
        z: 0,
        text: p.text,
        align: 'center',
        role: p.key,
        ...(phone.colorRole ? { colorRole: phone.colorRole } : {}),
        font: { family: 'Heebo', weight: 400, size_pt: fits, color: phone.font.color },
      });
      added.push(image(p.key + '_icon', p.icon[tone], x + w / 2 + used / 2 + 1 * fs, lineY + 0.1 * fs, iconSize * 0.9, iconSize * 0.9));
    });
  }
  return { ...doc, elements: [...doc.elements, ...added].map((e, i) => ({ ...e, z: i })) };
}
