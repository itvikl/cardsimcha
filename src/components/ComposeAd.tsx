'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import s from './festive.module.css';
import { AD_FORMATS, MEDIUM_LABEL, type AdMedium } from '@/lib/adFormats';
import { placePhoto, writeAd, type AdTexts } from '@/lib/adText';
import { brandPreview } from '@/lib/brand';
import { renderCard, type DrawableDoc } from '@/lib/renderCard';
import type { BrandKit, CatalogItem } from '@/lib/types';

type Option = { templateId: string; direction: string; itemId: string | null; texts: AdTexts; picture?: string | null };

/**
 * The add-on beside the gallery: one sentence, three ads to pick from. What the business picks opens in the editor like
 * any design, so it can still change everything there.
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
  const [opening, setOpening] = useState(false);
  const [canvases, setCanvases] = useState<Record<string, DrawableDoc>>({});

  useEffect(() => {
    if (!open) return;
    fetch(`/api/templates/canvas?topic=${encodeURIComponent(topic)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; canvas: DrawableDoc }[]) => setCanvases(Object.fromEntries(list.map((d) => [d.id, d.canvas]))))
      .catch(() => {});
  }, [open, topic]);

  async function draw(o: Option): Promise<Option> {
    const base = canvases[o.templateId];
    if (!base) return { ...o, picture: null };
    let doc = writeAd(kit ? brandPreview(base, kit) : base, o.texts);
    const photo = items.find((i) => i.id === o.itemId)?.photo;
    if (photo) doc = placePhoto(doc, { ...photo, src: `/api/uploads/${photo.file}` });
    return { ...o, picture: await renderCard(doc).catch(() => null) };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setQuestion('');
    setOptions([]);
    try {
      const res = await fetch('/api/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, request, format }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'לא הצלחנו לכתוב את המודעות');
      if (d.question) setQuestion(d.question);
      else setOptions(await Promise.all((d.options as Option[]).map(draw)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose(o: Option) {
    setOpening(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: o.templateId, useBrand: !!kit, adTexts: o.texts, itemId: o.itemId }),
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
            {busy ? 'כותב שלוש מודעות… (עד דקה)' : 'תכינו לי שלוש מודעות'}
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
      {options.length > 0 && (
        <div className={s.composeCards}>
          {options.map((o) => (
            <button key={o.templateId} type="button" className={s.design} onClick={() => choose(o)} disabled={opening}>
              {o.picture && <img src={o.picture} alt={o.texts['כותרת']} className={s.composePicture} />}
              <span className={s.designName}>{o.direction}</span>
              <span className={s.designHint}>לפתיחה בעורך</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
