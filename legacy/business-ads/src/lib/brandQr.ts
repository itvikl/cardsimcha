import QRCode from 'qrcode';
import { brandCategory, qrUrl } from './brand';
import { newId, saveUpload, setRow } from './db';
import type { BrandKit, QrTarget } from './types';

const SIZE = 600;

/**
 * The kit's QR code as it should be for this target: kept when it already leads there, made when it doesn't.
 * The old picture stays in storage: designs already made with it keep showing it.
 */
export async function qrFor(kit: BrandKit, target: QrTarget | null): Promise<BrandKit['qr']> {
  const url = target && qrUrl(target, kit);
  if (!target || !url) return undefined;
  if (kit.qr?.url === url) return { ...kit.qr, target };
  const data = await QRCode.toBuffer(url, { width: SIZE, margin: 1, errorCorrectionLevel: 'M' });
  const id = newId();
  const file = `${id}.png`;
  await saveUpload(file, data, 'image/png');
  await setRow('images', { id, categoryId: brandCategory(kit.id), name: 'קוד QR', file, width: SIZE, height: SIZE, createdAt: new Date().toISOString(), removed: true });
  return { target, url, assetId: id, file, width: SIZE, height: SIZE };
}
