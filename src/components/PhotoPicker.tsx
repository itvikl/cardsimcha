'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { gradientPicture, readPicture, uploadPicture } from '@/lib/myImages';
import type { BrandKit, ImageAsset, ImageElement } from '@/lib/types';

const COLORS = ['#FFFFFF', '#14336B', '#111111', '#7A1F2B', '#1F5C4A', '#E8A33D'];

/** The picture of a business's ad: its own, one of the library, a gradient of its colours, or a plain colour. */
export function PhotoPicker({
  el,
  images,
  onPick,
  onColor,
  onUploaded,
}: {
  el: ImageElement;
  images: ImageAsset[];
  onPick: (a: ImageAsset) => void;
  onColor: (color: string, key?: string) => void;
  onUploaded: (a: ImageAsset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kit, setKit] = useState<BrandKit | null>(null);

  useEffect(() => {
    fetch('/api/brand')
      .then((r) => (r.ok ? r.json() : null))
      .then(setKit)
      .catch(() => {});
  }, []);

  async function add(make: () => Promise<ImageAsset>) {
    setBusy(true);
    setError('');
    try {
      const asset = await make();
      onUploaded(asset);
      onPick(asset);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) add(async () => uploadPicture((await readPicture(file)).canvas, { type: 'image/jpeg', name: file.name }));
  }

  const box = el.photoBox;
  return (
    <div className="field field-card" style={{ order: -1 }}>
      <span className="field-label">התמונה במודעה</span>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <label className="btn small sticker-upload">
          {busy ? 'מעלה…' : 'העלאת תמונה'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-file" aria-label="העלאת תמונה" onChange={upload} disabled={busy} />
        </label>
        {kit?.businessName && box && (
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => add(() => uploadPicture(gradientPicture(kit.primaryColor, kit.secondaryColor, box.w_mm / box.h_mm), { type: 'image/jpeg', name: 'רקע מצבעי העסק' }))}
          >
            רקע מצבעי העסק
          </button>
        )}
      </div>
      {error && <span className="error" role="alert">{error}</span>}
      {images.length > 0 && (
        <div className="pick-grid">
          {images.map((img) => (
            <button key={img.id} type="button" className="pick" title={img.name} aria-pressed={!el.colorOverride && img.id === el.asset_id} onClick={() => onPick(img)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/uploads/${img.file}`} alt={img.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <div className="field-head">
        <span>או צבע אחיד</span>
        <div className="swatches" role="group" aria-label="צבע אחיד במקום התמונה">
          {COLORS.map((c) => (
            <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`צבע ${c}`} aria-pressed={el.colorOverride?.toLowerCase() === c.toLowerCase()} onClick={() => onColor(c)} />
          ))}
          <input type="color" className="swatch-picker" aria-label="צבע אחיד חופשי" value={el.colorOverride ?? '#ffffff'} onChange={(e) => onColor(e.target.value, 'photocolor')} />
        </div>
      </div>
    </div>
  );
}
