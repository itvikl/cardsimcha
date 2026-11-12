'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMe } from './Auth';
import s from './festive.module.css';
import { writeAd } from '@/lib/adText';
import { applyColors } from '@/lib/brand';
import { renderCard, type DrawableDoc } from '@/lib/renderCard';
import { takeSeries } from '@/lib/takeSeries';

type Piece = { id: string; name: string; series: string | null; canvas: DrawableDoc };

/**
 * A whole event's set from one form: the details are written once and go into every piece, each drawn here as it will
 * come out. The customer takes the pieces they need, and can still change each of them in the editor.
 */
export function EventSet({ topic, series }: { topic: string; series: string }) {
  const { ensureSession } = useMe();
  const router = useRouter();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [primaryColor, setPrimary] = useState('#14336B');
  const [secondaryColor, setSecondary] = useState('#E8A33D');
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/templates/canvas?topic=${encodeURIComponent(topic)}`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((list: Piece[]) => alive && setPieces(list.filter((p) => p.series === series)));
    return () => {
      alive = false;
    };
  }, [topic, series]);

  // each field once, in the order the first piece that has it shows it
  const fields = useMemo(() => [...new Set(pieces.flatMap((p) => p.canvas.elements.flatMap((e) => (e.type === 'text' && e.detail && e.label ? [e.label] : []))))], [pieces]);
  const written = useMemo(() => Object.fromEntries(Object.entries(details).filter(([, v]) => v.trim())), [details]);
  const colors = useMemo(() => ({ primaryColor, secondaryColor }), [primaryColor, secondaryColor]);

  useEffect(() => {
    if (!pieces.length) return;
    let alive = true;
    const t = window.setTimeout(async () => {
      for (const p of pieces) {
        const image = await renderCard(writeAd(applyColors(p.canvas, colors), written), 280).catch(() => null);
        if (!alive) return;
        if (image) setPreviews((v) => ({ ...v, [p.id]: image }));
      }
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [pieces, written, colors]);

  const taken = pieces.filter((p) => !left.has(p.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await ensureSession();
      await takeSeries({ series, details: written, colors, only: taken.map((p) => p.id) }, previews);
      router.push('/my-cards');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!pieces.length) return null;

  return (
    <form className={`card ${s.eventSet}`} onSubmit={submit}>
      <h2 className={s.eventTitle}>כותבים פעם אחת, ומקבלים את כל הסט</h2>
      <div className={s.eventFields}>
        {fields.map((f) => (
          <label key={f} className="field">
            {f}
            <input type="text" maxLength={300} value={details[f] ?? ''} onChange={(e) => setDetails((d) => ({ ...d, [f]: e.target.value }))} />
          </label>
        ))}
        <label className="field">
          צבע ראשי
          <input type="color" value={primaryColor} onChange={(e) => setPrimary(e.target.value)} />
        </label>
        <label className="field">
          צבע משני
          <input type="color" value={secondaryColor} onChange={(e) => setSecondary(e.target.value)} />
        </label>
      </div>
      <div className={s.eventPieces} role="group" aria-label="הפריטים בסט">
        {pieces.map((p) => (
          <label key={p.id} className={s.eventPiece} data-left={left.has(p.id) || undefined}>
            <span className={s.eventFace} style={{ aspectRatio: `${p.canvas.page.width_mm} / ${p.canvas.page.height_mm}`, ...(previews[p.id] ? { backgroundImage: `url("${previews[p.id]}")` } : {}) }} />
            <span className={s.eventCheck}>
              <input
                type="checkbox"
                checked={!left.has(p.id)}
                onChange={(e) =>
                  setLeft((cur) => {
                    const next = new Set(cur);
                    if (e.target.checked) next.delete(p.id);
                    else next.add(p.id);
                    return next;
                  })
                }
              />
              {p.name}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={`${s.btn} ${s.dark}`} disabled={busy || taken.length === 0}>
        {busy ? 'מכין…' : `יצירת ${taken.length} פריטים לעריכה ←`}
      </button>
    </form>
  );
}
