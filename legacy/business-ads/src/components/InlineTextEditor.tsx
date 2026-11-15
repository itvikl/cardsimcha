'use client';

import { useEffect, useRef, useState } from 'react';
import type { TextElement } from '@/lib/types';

/**
 * Writing straight on the card: a text box laid exactly over the text being edited, in its font, size and colour.
 * Enter keeps a new line; a click elsewhere or Ctrl+Enter keeps the words, Escape leaves them as they were.
 */
export function InlineTextEditor({
  el,
  box,
  fontSize,
  lineHeight,
  onDone,
}: {
  el: TextElement;
  /** where the text stands in the frame, in screen pixels */
  box: { x: number; y: number; w: number; h: number; rotation: number };
  fontSize: number;
  lineHeight: number;
  onDone: (text: string | null) => void;
}) {
  const [value, setValue] = useState(el.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus();
    t.select();
  }, []);
  // grows with its lines, as the text on the card would
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.max(box.h, t.scrollHeight)}px`;
  }, [value, box.h]);
  return (
    <textarea
      ref={ref}
      className="inline-text"
      dir="rtl"
      aria-label="עריכת הטקסט בכרטיס"
      value={value}
      maxLength={500}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onDone(null);
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onDone(value);
        }
      }}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        transform: `rotate(${box.rotation}deg)`,
        fontFamily: `"${el.font.family}"`,
        fontWeight: el.font.weight,
        fontSize,
        lineHeight,
        color: el.foil ? '#B8892F' : el.font.color,
        textAlign: el.align,
      }}
    />
  );
}
