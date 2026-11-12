'use client';

import { useState } from 'react';

type Kind = 'serif' | 'sans' | 'display' | 'uploaded';
const KINDS: { id: Kind | 'all'; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'serif', label: 'סריף' },
  { id: 'sans', label: 'בלי סריף' },
  { id: 'display', label: 'כותרות' },
  { id: 'uploaded', label: 'שהועלו' },
];
/** the built-in fonts by look; an uploaded one is filed under its own tab */
const KIND_OF: Record<string, Kind> = { 'Frank Ruhl Libre': 'serif', Heebo: 'sans', Assistant: 'sans', Arial: 'sans', 'Secular One': 'display' };

/**
 * Every font the editor offers, each written in itself with the selected text, so choosing is by look and not by name.
 */
export function FontPicker({
  value,
  sample,
  builtIn,
  uploaded,
  bold,
  onPick,
}: {
  value: string;
  sample: string;
  builtIn: readonly string[];
  uploaded: string[];
  bold: boolean;
  onPick: (family: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const words = sample.replace(/\s+/g, ' ').trim().slice(0, 22) || 'מזל טוב';
  const all = [...builtIn.map((f) => ({ f, k: KIND_OF[f] ?? ('sans' as Kind) })), ...uploaded.map((f) => ({ f, k: 'uploaded' as Kind }))];
  const list = all.filter(({ f, k }) => (kind === 'all' || k === kind) && f.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="font-picker">
      <input type="search" placeholder="חיפוש פונט" aria-label="חיפוש פונט" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="chip-row" role="group" aria-label="סוג הפונט">
        {KINDS.filter((k) => k.id !== 'uploaded' || uploaded.length > 0).map((k) => (
          <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="font-list" role="listbox" aria-label="פונטים">
        {list.length === 0 && <p className="status">לא נמצא פונט כזה.</p>}
        {list.map(({ f }) => (
          <button key={f} type="button" role="option" aria-selected={f === value} className="font-row" onClick={() => onPick(f)}>
            <span className="font-sample" style={{ fontFamily: `"${f}"`, fontWeight: bold ? 700 : 400 }}>
              {words}
            </span>
            <span className="font-name">{f}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
