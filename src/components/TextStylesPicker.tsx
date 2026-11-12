'use client';

import { useEffect, useState } from 'react';
import type { TextElement } from '@/lib/types';

/** what a saved style carries: the look of a text, not its words or place */
type Style = { id: string; name: string } & Pick<TextElement, 'font' | 'letterSpacing' | 'lineHeight' | 'shadow' | 'stroke' | 'foil' | 'arc' | 'align'>;
const KEY = 'editor-text-styles-v1';

const read = (): Style[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/**
 * Text styles an author keeps (title, names, details…) and lays on another text in one click. Kept in this browser,
 * as a working aid while building templates.
 */
export function TextStylesPicker({ text, onApply }: { text: TextElement; onApply: (patch: Partial<TextElement>) => void }) {
  const [styles, setStyles] = useState<Style[]>([]);
  useEffect(() => setStyles(read()), []);
  const keep = (next: Style[]) => {
    setStyles(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };
  const save = () => {
    const name = text.label || text.text.replace(/\s+/g, ' ').trim().slice(0, 16) || 'סגנון';
    const { font, letterSpacing, lineHeight, shadow, stroke, foil, arc, align } = text;
    keep([{ id: crypto.randomUUID(), name, font, letterSpacing, lineHeight, shadow, stroke, foil, arc, align }, ...styles].slice(0, 24));
  };
  return (
    <div className="text-styles">
      {styles.length > 0 && (
        <div className="style-list">
          {styles.map((s) => (
            <span key={s.id} className="style-chip">
              <button
                type="button"
                title={`${s.font.family} · ${Math.round(s.font.size_pt)}pt`}
                style={{ fontFamily: `"${s.font.family}"`, fontWeight: s.font.weight, color: s.font.color }}
                onClick={() => {
                  const { id: _i, name: _n, ...look } = s;
                  void [_i, _n];
                  onApply(look);
                }}
              >
                {s.name}
              </button>
              <button type="button" className="style-x" aria-label={`מחיקת הסגנון ${s.name}`} onClick={() => keep(styles.filter((x) => x.id !== s.id))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <button type="button" className="btn small" onClick={save}>
        + שמירת העיצוב של הטקסט כסגנון
      </button>
    </div>
  );
}
