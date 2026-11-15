'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import s from './festive.module.css';
import { AD_FORMATS, MEDIUM_LABEL, type AdMedium } from '@/lib/adFormats';
import { placePhoto, writeAd, type AdTexts } from '@/lib/adText';
import { brandPreview } from '@/lib/brand';
import { renderCard, type DrawableDoc } from '@/lib/renderCard';
import { placeSticker } from '@/lib/sticker';
import type { BrandKit, CatalogItem } from '@/lib/types';

/** one wording the system wrote */
type Option = {
  direction: string;
  itemId: string | null;
  sticker: { id: string; file: string; width: number; height: number } | null;
  texts: AdTexts;
};
/** the approved wording on one layout */
type Look = { templateId: string; picture: string | null };

const WORD_FIELDS: { label: string; rows: number; maxLength: number }[] = [
  { label: 'כותרת', rows: 2, maxLength: 60 },
  { label: 'משפט משנה', rows: 2, maxLength: 120 },
  { label: 'נקודה 1', rows: 1, maxLength: 50 },
  { label: 'נקודה 2', rows: 1, maxLength: 50 },
  { label: 'נקודה 3', rows: 1, maxLength: 50 },
  { label: 'קריאה לפעולה', rows: 1, maxLength: 30 },
];

/**
 * The add-on beside the gallery, in the order the business decides things: what to say, then how it looks. One sentence gives
 * three wordings to approve or change; the approved one is drawn on the layouts, and the one picked opens in the editor.
 */
export function ComposeAd({ topic, signedIn, kit, items }: { topic: string; signedIn: boolean; kit: BrandKit | null; items: CatalogItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [format, setFormat] = useState('status');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [layouts, setLayouts] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Option | null>(null);
  const [looks, setLooks] = useState<Look[]>([]);
  const [opening, setOpening] = useState(false);
  const [canvases, setCanvases] = useState<Record<string, DrawableDoc>>({});

  useEffect(() => {
    if (!open) return;
    fetch(`/api/templates/canvas?topic=${encodeURIComponent(topic)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; canvas: DrawableDoc }[]) => setCanvases(Object.fromEntries(list.map((d) => [d.id, d.canvas]))))
      .catch(() => {});
  }, [open, topic]);

  async function draw(o: Option, templateId: string): Promise<Look> {
    const base = canvases[templateId];
    if (!base) return { templateId, picture: null };
    let doc = writeAd(kit ? brandPreview(base, kit) : base, o.texts);
    const photo = items.find((i) => i.id === o.itemId)?.photo;
    if (photo) doc = placePhoto(doc, { ...photo, src: `/api/uploads/${photo.file}` });
    if (o.sticker) doc = placeSticker(doc, { assetId: o.sticker.id, width: o.sticker.width, height: o.sticker.height, src: `/api/uploads/${o.sticker.file}` });
    return { templateId, picture: await renderCard(doc).catch(() => null) };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setQuestion('');
    setOptions([]);
    setChosen(null);
    setLooks([]);
    try {
      const res = await fetch('/api/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, request, format }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'לא הצלחנו לכתוב את המודעות');
      if (d.question) setQuestion(d.question);
      else {
        setOptions(d.options);
        setLayouts(d.layouts);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** a change to the words of a wording, before it is approved */
  const edit = (i: number, label: string, value: string) =>
    setOptions((list) => list.map((o, n) => (n === i ? { ...o, texts: { ...o.texts, [label]: value } } : o)));

  async function approve(e: FormEvent, o: Option) {
    e.preventDefault();
    setChosen(o);
    setLooks(await Promise.all(layouts.map((t) => draw(o, t))));
  }

  async function choose(look: Look) {
    if (!chosen) return;
    setOpening(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: look.templateId, useBrand: !!kit, adTexts: chosen.texts, itemId: chosen.itemId, stickerId: chosen.sticker?.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'לא הצלחנו לפתוח את המודעה');
      router.push(`/editor/${d.id}`);
    } catch (err) {
      setError((err as Error).message);
      setOpening(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${s.btn} ${s.dark}`} onClick={() => setOpen(true)}>
        ✦ אין זמן? תכינו לי מודעה ממשפט אחד
      </button>
    );
  }

  return (
    <div className={`card ${s.compose}`}>
      {!signedIn ? (
        <p style={{ margin: 0 }}>
          כדי שהמערכת תכתוב לכם מודעות, <Link href={`/login?next=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.pathname)}`}>נרשמים בחינם</Link>.
        </p>
      ) : (
        <form onSubmit={submit} className={s.composeForm}>
          <label className="field">
            מה תרצו לפרסם?
            <textarea
              rows={2}
              maxLength={500}
              required
              value={request}
              placeholder="למשל: מבצע ניקוי מזגנים עד סוף החודש, 149 ₪ ליחידה"
              onChange={(e) => setRequest(e.target.value)}
            />
          </label>
          <label className="field">
            מידה
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {(['digital', 'print'] as AdMedium[]).map((m) => (
                <optgroup key={m} label={MEDIUM_LABEL[m]}>
                  {AD_FORMATS.filter((f) => f.medium === m).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy || request.trim().length < 3}>
            {busy ? 'כותב שלושה ניסוחים… (עד דקה)' : options.length ? 'לא זה. כתבו לי ניסוחים אחרים' : 'כתבו לי שלושה ניסוחים'}
          </button>
          <p className="status" style={{ margin: 0 }}>
            המערכת כותבת רק ממה שמסרתם כאן, בעמוד המיתוג ובקטלוג. כדאי לעבור על הנוסח לפני ההורדה.
          </p>
        </form>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {question && (
        <p role="status" style={{ margin: 0 }}>
          <strong>שאלה לפני שכותבים:</strong> {question} (מוסיפים את התשובה למשפט ושולחים שוב)
        </p>
      )}
      {options.length > 0 && !chosen && (
        <div className={s.composeWordings}>
          {options.map((o, i) => (
            <form key={i} className={s.composeWording} onSubmit={(e) => approve(e, o)} aria-label={o.direction}>
              <strong>{o.direction}</strong>
              {WORD_FIELDS.map((f) => (
                <label key={f.label} className="field">
                  {f.label}
                  <textarea rows={f.rows} maxLength={f.maxLength} required value={o.texts[f.label] ?? ''} onChange={(e) => edit(i, f.label, e.target.value)} />
                </label>
              ))}
              <button className="btn primary small" type="submit">
                הניסוח הזה טוב, לעיצוב ←
              </button>
            </form>
          ))}
        </div>
      )}
      {chosen && (
        <>
          <button type="button" className={s.back} onClick={() => setChosen(null)}>
            → חזרה לניסוחים
          </button>
          {looks.length === 0 && <p className="status" role="status" style={{ margin: 0 }}>מכין את העיצובים…</p>}
          <div className={s.composeCards}>
            {looks.map((l) => (
              <button key={l.templateId} type="button" className={s.design} onClick={() => choose(l)} disabled={opening}>
                {l.picture && <img src={l.picture} alt={chosen.texts['כותרת']} className={s.composePicture} />}
                <span className={s.designHint}>לפתיחה בעורך</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
