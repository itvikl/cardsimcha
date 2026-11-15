'use client';

import { useState } from 'react';
import { nameOf } from '@/lib/historyLabel';
import type { CanvasElement } from '@/lib/types';

const KIND: Record<CanvasElement['type'], string> = { text: 'ט', image: '▣', rect: '■' };

/**
 * Every element of the card, the one drawn on top first. Click selects (Shift adds), drag changes the order, and each
 * row can be hidden or locked.
 */
export function LayersPanel({
  elements,
  selected,
  onSelect,
  onToggle,
  onMove,
}: {
  elements: CanvasElement[];
  selected: string[];
  onSelect: (id: string, add: boolean) => void;
  onToggle: (id: string, key: 'hidden' | 'locked') => void;
  /** puts the element at this index of the drawing order (0 is the bottom) */
  onMove: (id: string, index: number) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const top = [...elements].reverse();
  return (
    <div className="layers" role="list" aria-label="שכבות">
      {top.map((e, i) => {
        const index = elements.length - 1 - i;
        return (
          <div
            key={e.id}
            role="listitem"
            className={'layer-row' + (selected.includes(e.id) ? ' on' : '') + (over === index ? ' over' : '') + (e.hidden ? ' dim' : '')}
            draggable
            onDragStart={() => setDragged(e.id)}
            onDragOver={(ev) => {
              ev.preventDefault();
              setOver(index);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(ev) => {
              ev.preventDefault();
              if (dragged && dragged !== e.id) onMove(dragged, index);
              setDragged(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragged(null);
              setOver(null);
            }}
          >
            <button type="button" className="layer-name" onClick={(ev) => onSelect(e.id, ev.shiftKey || ev.ctrlKey || ev.metaKey)}>
              <span className="layer-kind" aria-hidden="true">
                {KIND[e.type]}
              </span>
              <span className="layer-label">{nameOf(e)}</span>
              {e.group && <span className="layer-group" title="בקבוצה">⧉</span>}
            </button>
            <button type="button" className="layer-toggle" aria-pressed={!!e.hidden} aria-label={e.hidden ? `הצגה: ${nameOf(e)}` : `הסתרה: ${nameOf(e)}`} onClick={() => onToggle(e.id, 'hidden')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                {e.hidden ? <path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.7M6.6 6.7C4.2 8.3 3 12 3 12s4 6 9 6a9 9 0 0 0 3.8-.8" /> : <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />}
              </svg>
            </button>
            <button type="button" className="layer-toggle" aria-pressed={!!e.locked} aria-label={e.locked ? `שחרור נעילה: ${nameOf(e)}` : `נעילה: ${nameOf(e)}`} onClick={() => onToggle(e.id, 'locked')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d={e.locked ? 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4' : 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2'} />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
