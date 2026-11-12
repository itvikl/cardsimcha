'use client';

import { useEffect, useState } from 'react';
import { fitDocColors } from '@/lib/fitColor';
import { cardPixels, renderCard, type DrawableDoc } from '@/lib/renderCard';
import { applyWording, type Wording } from '@/lib/wording';
import type { CanvasDoc } from '@/lib/types';

/**
 * The wordings this card can take, each drawn on the card's own background with the customer's details.
 * An admin building a card sees it too, and with `manage` it also says what to do when there are none yet.
 */
export function WordingPicker({
  doc,
  topic,
  manage,
  drawable,
  onPick,
}: {
  doc: CanvasDoc;
  topic: string;
  manage: boolean;
  drawable: (d: CanvasDoc) => DrawableDoc;
  onPick: (w: Wording) => void;
}) {
  const [wordings, setWordings] = useState<Wording[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const { width_mm, height_mm } = doc.page;

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ topic, width: String(width_mm), height: String(height_mm) });
    fetch(`/api/wordings?${q}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((list: Wording[]) => alive && setWordings(list));
    return () => {
      alive = false;
    };
  }, [topic, width_mm, height_mm]);

  // the previews change with what is under the wording and with the customer's details, and not with the rest of their edits
  const look = JSON.stringify(doc.elements.flatMap<unknown>((e) => (e.type === 'text' ? (e.detail ? [e.label, e.text] : []) : [e])));
  useEffect(() => {
    if (!wordings?.length) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      try {
        const px = await cardPixels(drawable(doc));
        for (const w of wordings) {
          const url = await renderCard(drawable(fitDocColors(applyWording(doc, w), px)), 220);
          if (!alive) return;
          setPreviews((p) => ({ ...p, [w.id]: url }));
        }
      } catch (e) {
        console.error('could not draw the wordings', e);
      }
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [look, wordings]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wordings) return null;
  if (wordings.length === 0) {
    return manage ? (
      <div className="field-card">
        <span className="field-label">נוסח</span>
        <p className="status" style={{ margin: 0 }}>אין עדיין נוסחים בנושא &quot;{topic}&quot; ובגודל הזה. יוצרים אותם בעמוד התבניות.</p>
      </div>
    ) : null;
  }
  // a customer whose card has one wording has nothing to choose
  if (!manage && wordings.length < 2) return null;

  return (
    <div className="field field-card" style={{ order: -1 }}>
      <span className="field-label">בחירת נוסח</span>
      <div className="wording-grid">
        {wordings.map((w) => (
          <button
            key={w.id}
            type="button"
            className="wording-pick"
            aria-pressed={w.id === doc.wordingId}
            onClick={() => w.id !== doc.wordingId && onPick(w)}
          >
            <span className="wording-face" style={{ aspectRatio: `${width_mm} / ${height_mm}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {previews[w.id] && <img src={previews[w.id]} alt="" />}
            </span>
            <span className="wording-name">{w.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
