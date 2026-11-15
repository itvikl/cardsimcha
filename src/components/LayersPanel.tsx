'use client';

import { useState } from 'react';
import { nameOf } from '@/lib/historyLabel';
import type { CanvasDoc, CanvasElement, LayerName } from '@/lib/types';

const KIND: Record<CanvasElement['type'], string> = { text: 'ט', image: '▣', shape: '■' };
const SECTIONS: [LayerName, string][] = [
  ['overlay', 'שכבה עליונה'],
  ['content', 'תוכן'],
];

/**
 * The card's three layers, the top one first, each with its elements (the one drawn on top first). Click selects
 * (Shift adds), dragging a row changes the order inside its layer or moves it to the other one, and each row can be
 * hidden (left out of every download) or pinned (stays put in the editor; clicks go through it). The background is
 * the fixed bottom row. Ported from feature/business-ads (Vitol) onto card format v2.
 */
export function LayersPanel({
  doc,
  selected,
  onSelect,
  onToggle,
  onMove,
  onSelectBackground,
}: {
  doc: CanvasDoc;
  selected: string[];
  onSelect: (id: string, add: boolean) => void;
  onToggle: (id: string, key: 'hidden' | 'pinned') => void;
  /** puts the element at this index of that layer's drawing order (0 is the bottom) */
  onMove: (id: string, layer: LayerName, index: number) => void;
  onSelectBackground: () => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (layer: LayerName, index: number) => {
    if (dragged) onMove(dragged, layer, index);
    setDragged(null);
    setOver(null);
  };
  return (
    <div className="layers" role="tree" aria-label="שכבות">
      {SECTIONS.map(([layer, title]) => {
        const els = doc.layers[layer];
        return (
          <div key={layer} role="group" aria-label={title}>
            <div
              className={'layer-head' + (over === layer ? ' over' : '')}
              // dropped on the heading: on top of that layer
              onDragOver={(ev) => {
                ev.preventDefault();
                setOver(layer);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(ev) => {
                ev.preventDefault();
                drop(layer, els.length);
              }}
            >
              {title}
              <span className="status"> · {els.length}</span>
            </div>
            {els.length === 0 && <p className="status layer-empty">ריקה. אפשר לגרור לכאן אלמנט.</p>}
            {[...els].reverse().map((e, i) => {
              const index = els.length - 1 - i;
              const key = `${layer}:${index}`;
              return (
                <div
                  key={e.id}
                  role="treeitem"
                  aria-selected={selected.includes(e.id)}
                  className={'layer-row' + (selected.includes(e.id) ? ' on' : '') + (over === key ? ' over' : '') + (e.hidden ? ' dim' : '')}
                  draggable
                  onDragStart={() => setDragged(e.id)}
                  onDragOver={(ev) => {
                    ev.preventDefault();
                    setOver(key);
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    if (dragged !== e.id) drop(layer, index);
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
                    {e.group && (
                      <span className="layer-group" title="בקבוצה">
                        ⧉
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="layer-toggle"
                    aria-pressed={!!e.hidden}
                    aria-label={e.hidden ? `הצגה: ${nameOf(e)}` : `הסתרה: ${nameOf(e)}`}
                    title={e.hidden ? 'מוסתר: לא מופיע בכרטיס ובהורדות' : 'הסתרה'}
                    onClick={() => onToggle(e.id, 'hidden')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      {e.hidden ? (
                        <path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.7M6.6 6.7C4.2 8.3 3 12 3 12s4 6 9 6a9 9 0 0 0 3.8-.8" />
                      ) : (
                        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />
                      )}
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="layer-toggle"
                    aria-pressed={!!e.pinned}
                    aria-label={e.pinned ? `שחרור נעילה: ${nameOf(e)}` : `נעילה בעורך: ${nameOf(e)}`}
                    title={e.pinned ? 'נעול בעורך: לחיצות עוברות דרכו' : 'נעילה בעורך (לא קשור להרשאות הלקוח)'}
                    onClick={() => onToggle(e.id, 'pinned')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d={e.pinned ? 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4' : 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2'} />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      <div role="group" aria-label="רקע">
        <div className="layer-head">רקע</div>
        <div className="layer-row">
          <button type="button" className="layer-name" onClick={onSelectBackground}>
            <span className="layer-kind" aria-hidden="true">
              ▤
            </span>
            <span className="layer-label">{doc.layers.background.image ? 'צבע ותמונת רקע' : 'צבע רקע'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
