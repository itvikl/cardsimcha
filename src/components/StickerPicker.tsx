'use client';

import { useState, type ChangeEvent } from 'react';
import { readPicture, uploadPicture } from '@/lib/myImages';
import { removeFlatBackground } from '@/lib/removeBackground';
import { stickersFor } from '@/lib/sticker';
import type { ImageAsset } from '@/lib/types';

/** a picture the business chose, waiting for its decision about the background */
type Waiting = { original: HTMLCanvasElement; cleared: HTMLCanvasElement | null };

function clearedCopy(original: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = original.getContext('2d')!;
  const done = removeFlatBackground(ctx.getImageData(0, 0, original.width, original.height));
  if (!done) return null;
  const out = document.createElement('canvas');
  out.width = original.width;
  out.height = original.height;
  out.getContext('2d')!.putImageData(done, 0, 0);
  return out;
}

/**
 * The sticker library in the customer's panel: this category's stickers first, and a search through all of them.
 * With `onUpload`, a business also keeps stickers from its own files, which only it sees.
 */
export function StickerPicker({
  stickers,
  own = [],
  topic,
  selected,
  onPick,
  onRemove,
  onUpload,
  onForget,
}: {
  stickers: ImageAsset[];
  own?: ImageAsset[];
  topic: string | null;
  selected: boolean;
  onPick: (s: ImageAsset) => void;
  onRemove: () => void;
  onUpload?: (s: ImageAsset) => void;
  onForget?: (s: ImageAsset) => void;
}) {
  const [search, setSearch] = useState('');
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!stickers.length && !onUpload) return null;
  const shown = stickersFor(stickers, topic, search);

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const { canvas } = await readPicture(file);
      setWaiting({ original: canvas, cleared: clearedCopy(canvas) });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function keep(canvas: HTMLCanvasElement) {
    setBusy(true);
    setError('');
    try {
      const asset = await uploadPicture(canvas, { sticker: true });
      setWaiting(null);
      onUpload?.(asset);
      onPick(asset);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field field-card" style={{ order: -1 }}>
      <span className="field-label">מדבקות</span>
      {onUpload && (
        <>
          <label className="btn small sticker-upload">
            העלאת מדבקה משלי
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-file" aria-label="העלאת מדבקה משלי" onChange={choose} disabled={busy} />
          </label>
          {waiting && (
            <div className="sticker-choice" role="group" aria-label="הרקע של המדבקה">
              {waiting.cleared ? (
                <>
                  <span className="status">להוריד את הרקע?</span>
                  <div className="sticker-compare">
                    <button type="button" className="pick checker" disabled={busy} onClick={() => keep(waiting.cleared!)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={waiting.cleared.toDataURL('image/png')} alt="התמונה בלי הרקע" />
                      <span>בלי הרקע</span>
                    </button>
                    <button type="button" className="pick" disabled={busy} onClick={() => keep(waiting.original)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={waiting.original.toDataURL('image/png')} alt="התמונה כמו שהיא" />
                      <span>כמו שהיא</span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="status">לא מצאנו כאן רקע אחיד להוריד, אז התמונה תיכנס כמו שהיא.</span>
                  <button type="button" className="btn small primary" disabled={busy} onClick={() => keep(waiting.original)}>
                    להוסיף
                  </button>
                </>
              )}
              <button type="button" className="btn small" disabled={busy} onClick={() => setWaiting(null)}>
                ביטול
              </button>
            </div>
          )}
          {error && <span className="error" role="alert">{error}</span>}
          {own.length > 0 && (
            <div className="pick-grid sticker-grid" role="group" aria-label="המדבקות שלי">
              {own.map((s) => (
                <span key={s.id} className="own-sticker">
                  <button type="button" className="pick checker" title={s.name} aria-label={`הוספת המדבקה שלי: ${s.name}`} onClick={() => onPick(s)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/uploads/${s.file}`} alt="" loading="lazy" />
                  </button>
                  {onForget && (
                    <button type="button" className="own-sticker-x" aria-label={`הסרה מהרשימה: ${s.name}`} onClick={() => onForget(s)}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <input type="search" value={search} placeholder="חיפוש, למשל: בית" aria-label="חיפוש מדבקה" maxLength={40} onChange={(e) => setSearch(e.target.value)} />
      {shown.length === 0 ? (
        <span className="status">לא מצאנו מדבקה כזו.</span>
      ) : (
        <div className="pick-grid sticker-grid">
          {shown.map((s) => (
            <button key={s.id} type="button" className="pick" title={s.name} aria-label={`הוספת מדבקה: ${s.name}`} onClick={() => onPick(s)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/uploads/${s.file}`} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {selected ? (
        <button type="button" className="btn small" onClick={onRemove}>
          הסרת המדבקה שנבחרה
        </button>
      ) : (
        <span className="status">לוחצים כדי להוסיף. בכרטיס אפשר לגרור, להגדיל, לסובב ולמחוק.</span>
      )}
    </div>
  );
}
