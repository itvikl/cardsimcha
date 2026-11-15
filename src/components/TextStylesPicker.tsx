'use client';

import { useEffect, useState } from 'react';
import type { TextLook } from '@/lib/canvas';
import type { TextElement } from '@/lib/types';

type Style = { id: string; name: string; look: TextLook };

/** the look of a text: what a style keeps, without its words, place or customer rules */
const lookOf = (t: TextElement): TextLook => ({
  font: t.font,
  align: t.align,
  ...(t.arc !== undefined && { arc: t.arc }),
  ...(t.fit && { fit: t.fit }),
  ...(t.shadow && { shadow: t.shadow }),
  ...(t.stroke && { stroke: t.stroke }),
  ...(t.foil && { foil: t.foil }),
});

/**
 * Text styles the admins keep (title, names, details…) and lay on another text in one click, so headings and names
 * look the same across templates. Stored on the server and shared by every admin. Applying a style copies its look;
 * a text never changes later because a style was edited or deleted. Ported from feature/business-ads (Vitol), where
 * styles lived in the browser.
 */
export function TextStylesPicker({
  text,
  onApply,
  onError,
}: {
  text: TextElement;
  /** the look to lay on the text; arc, fit and effects the style doesn't have are cleared */
  onApply: (patch: Partial<TextElement>) => void;
  onError: (message: string) => void;
}) {
  const [styles, setStyles] = useState<Style[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/text-styles')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { styles: Style[] }) => alive && setStyles(d.styles))
      .catch(() => alive && setStyles([]));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const name = text.field?.label || text.text.replace(/\s+/g, ' ').trim().slice(0, 16) || 'סגנון';
    setBusy(true);
    try {
      const r = await fetch('/api/text-styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, look: lookOf(text) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'השמירה נכשלה');
      setStyles((s) => [d as Style, ...(s ?? [])]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Style) => {
    if (!confirm(`למחוק את הסגנון "${s.name}"? טקסטים שכבר קיבלו אותו לא ישתנו.`)) return;
    const r = await fetch(`/api/text-styles/${s.id}`, { method: 'DELETE' });
    if (r.ok || r.status === 404) setStyles((list) => (list ?? []).filter((x) => x.id !== s.id));
    else onError('המחיקה נכשלה');
  };

  return (
    <div className="text-styles">
      {styles === null && <p className="status">טוען סגנונות…</p>}
      {styles && styles.length > 0 && (
        <div className="style-list">
          {styles.map((s) => (
            <span key={s.id} className="style-chip">
              <button
                type="button"
                title={`${s.look.font.family} · ${Math.round(s.look.font.size_pt)}pt`}
                style={{ fontFamily: `"${s.look.font.family}"`, fontWeight: s.look.font.weight, color: s.look.font.color }}
                onClick={() => onApply({ arc: undefined, fit: undefined, shadow: undefined, stroke: undefined, foil: undefined, ...s.look })}
              >
                {s.name}
              </button>
              <button type="button" className="style-x" aria-label={`מחיקת הסגנון ${s.name}`} onClick={() => remove(s)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <button type="button" className="btn small" disabled={busy} onClick={save}>
        + שמירת העיצוב של הטקסט כסגנון
      </button>
    </div>
  );
}
