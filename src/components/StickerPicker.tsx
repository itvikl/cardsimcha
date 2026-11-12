'use client';

import { useState } from 'react';
import { stickersFor } from '@/lib/sticker';
import type { ImageAsset } from '@/lib/types';

/** The sticker library in the customer's panel: this category's stickers first, and a search through all of them. */
export function StickerPicker({
  stickers,
  topic,
  selected,
  onPick,
  onRemove,
}: {
  stickers: ImageAsset[];
  topic: string | null;
  selected: boolean;
  onPick: (s: ImageAsset) => void;
  onRemove: () => void;
}) {
  const [search, setSearch] = useState('');
  if (!stickers.length) return null;
  const shown = stickersFor(stickers, topic, search);
  return (
    <div className="field field-card" style={{ order: -1 }}>
      <span className="field-label">מדבקות</span>
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
