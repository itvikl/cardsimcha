'use client';

import { useState } from 'react';

/**
 * Rulers in millimetres along the top and the side of the page. Dragging out of one lays a guide across the page: from
 * the top ruler a horizontal one, from the side ruler an upright one. Dragged elements snap to guides.
 */
export function EditorRulers({
  widthMm,
  heightMm,
  scale,
  onGuide,
}: {
  widthMm: number;
  heightMm: number;
  /** screen pixels per millimetre */
  scale: number;
  onGuide: (axis: 'x' | 'y', mm: number) => void;
}) {
  const [drag, setDrag] = useState<{ axis: 'x' | 'y'; px: number } | null>(null);
  // a label every 10 mm, or every 20 when they would crowd
  const every = scale * 10 < 28 ? 20 : 10;

  const start = (axis: 'x' | 'y') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const frame = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const at = (ev: PointerEvent | React.PointerEvent) => (axis === 'y' ? ev.clientY - frame.top : ev.clientX - frame.left);
    setDrag({ axis, px: at(e) });
    const move = (ev: PointerEvent) => setDrag({ axis, px: at(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const mm = at(ev) / scale;
      if (mm > 0 && mm < (axis === 'y' ? heightMm : widthMm)) onGuide(axis, Math.round(mm * 2) / 2);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const ticks = (len: number) => Array.from({ length: Math.floor(len / every) + 1 }, (_, i) => i * every);
  return (
    <>
      <div className="ruler ruler-top" style={{ ['--mm' as string]: `${scale}px` }} onPointerDown={start('y')} title="גררו למטה כדי להוסיף קו עזר" aria-hidden="true">
        {ticks(widthMm).map((mm) => (
          <span key={mm} style={{ left: mm * scale }}>
            {mm}
          </span>
        ))}
      </div>
      <div className="ruler ruler-side" style={{ ['--mm' as string]: `${scale}px` }} onPointerDown={start('x')} title="גררו הצידה כדי להוסיף קו עזר" aria-hidden="true">
        {ticks(heightMm).map((mm) => (
          <span key={mm} style={{ top: mm * scale }}>
            {mm}
          </span>
        ))}
      </div>
      {drag && <div className={'guide-ghost ' + drag.axis} style={drag.axis === 'y' ? { top: drag.px } : { left: drag.px }} />}
    </>
  );
}
