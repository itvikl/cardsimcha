'use client';

import { useEffect, useState } from 'react';
import { applyBackdrop, backdropColor, colorBackdrop, isBase, type Backdrop } from '@/lib/backdrop';
import { fitDocColors } from '@/lib/fitColor';
import { cardPixels, renderCard, type DrawableDoc } from '@/lib/renderCard';
import type { CanvasDoc } from '@/lib/types';

/**
 * The backdrops a private card can lie on, each drawn under the customer's own texts in the colours they would take there,
 * and a flat colour of the customer's choice. `current` is the one the card stands on.
 */
export function BackdropPicker({
  doc,
  list,
  current,
  swatches,
  drawable,
  onPick,
}: {
  doc: CanvasDoc;
  list: Backdrop[];
  current: string | undefined;
  swatches: string[];
  drawable: (d: CanvasDoc) => DrawableDoc;
  onPick: (b: Backdrop, mergeKey?: string) => void;
}) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const { width_mm, height_mm } = doc.page;
  const color = current ? backdropColor(current) : null;

  // the previews change with what lies on the backdrop, and not with the backdrop the card stands on now
  const look = JSON.stringify(doc.elements.filter((e) => !isBase(e)));
  useEffect(() => {
    if (!list.length) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        for (const b of list) {
          const draft = applyBackdrop(doc, b);
          const url = await renderCard(drawable(fitDocColors(draft, await cardPixels(drawable(draft)))), 200);
          if (!alive) return;
          setPreviews((p) => ({ ...p, [b.id]: url }));
        }
      } catch (e) {
        console.error('could not draw the backgrounds', e);
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [look, list]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="field field-card" style={{ order: -1 }}>
      <span className="field-label">רקעים עם הניסוח שלכם</span>
      {list.length > 0 && (
        <div className="wording-grid">
          {list.map((b) => (
            // no name under it: a picture's is a file name, and the preview says it all
            <button
              key={b.id}
              type="button"
              className="wording-pick"
              title={b.name}
              aria-label={`רקע: ${b.name}`}
              aria-pressed={b.id === current}
              onClick={() => b.id !== current && onPick(b)}
            >
              <span className="wording-face" style={{ aspectRatio: `${width_mm} / ${height_mm}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {previews[b.id] && <img src={previews[b.id]} alt="" />}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="field-head">
        <span>{list.length > 0 ? 'או צבע אחיד' : 'צבע אחיד'}</span>
        <div className="swatches" role="group" aria-label="צבע אחיד לרקע">
          {swatches.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-label={`צבע ${c}`}
              aria-pressed={color === c.toUpperCase()}
              onClick={() => onPick(colorBackdrop(c))}
            />
          ))}
          <input
            type="color"
            className="swatch-picker"
            aria-label="צבע אחיד חופשי"
            value={(color ?? doc.page.background).toLowerCase()}
            onChange={(e) => onPick(colorBackdrop(e.target.value), 'backdrop-color')}
          />
        </div>
      </div>
    </div>
  );
}
