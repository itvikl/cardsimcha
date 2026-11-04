'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteFooter } from './SiteFooter';
import s from './festive.module.css';
import type { CatalogItem } from '@/lib/types';

type Draft = { id: string | null; name: string; details: string; price: string; file: File | null };
const EMPTY: Draft = { id: null, name: '', details: '', price: '', file: null };

function readSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('הקובץ אינו תמונה תקינה'));
    };
    img.src = url;
  });
}

/** What the business sells, kept once: choosing an item fills an ad with its name, details, price and picture. */
export function CatalogForm() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/catalog', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('טעינת הקטלוג נכשלה');
        setItems(await r.json());
      })
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('name', draft.name);
      form.set('details', draft.details);
      form.set('price', draft.price);
      if (draft.file) {
        const { width, height } = await readSize(draft.file);
        form.set('file', draft.file);
        form.set('width', String(width));
        form.set('height', String(height));
      }
      const res = await fetch(draft.id ? `/api/catalog/${draft.id}` : '/api/catalog', { method: draft.id ? 'PUT' : 'POST', body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'השמירה נכשלה');
      setItems((list) => [d as CatalogItem, ...(list ?? []).filter((i) => i.id !== d.id)]);
      setDraft(EMPTY);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: CatalogItem) {
    if (!window.confirm(`למחוק את "${item.name}" מהקטלוג? מודעות שכבר נוצרו איתו יישארו כמו שהן.`)) return;
    setError('');
    const res = await fetch(`/api/catalog/${item.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError('המחיקה נכשלה');
      return;
    }
    setItems((list) => (list ?? []).filter((i) => i.id !== item.id));
  }

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, file: e.target.files?.[0] ?? null }));

  return (
    <div className={`${s.root} ${s.business}`}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href="/business">
          → חזרה לעיצובים לעסק
        </Link>
        <div className={`${s.head} ${s.rise}`}>
          <span className={s.eyebrow}>הקטלוג של העסק</span>
          <h1 className={s.h2}>
            מוצרים ושירותים, <span className={s.shine}>מוכנים למודעה</span>
          </h1>
          <p>מכניסים פעם אחת שם, פרטים, מחיר ותמונה. בעמוד המודעות בוחרים פריט, והוא נכנס לכל העיצובים.</p>
        </div>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        <div className={s.brandLayout}>
          <form className={`card ${s.brandForm}`} onSubmit={submit}>
            <label className="field">
              שם הפריט
              <input type="text" required maxLength={80} value={draft.name} placeholder="למשל: מזגן עילי 1.5 כ&quot;ס" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="field">
              פרטים
              <input type="text" maxLength={200} value={draft.details} placeholder="למשל: כולל התקנה סטנדרטית" onChange={(e) => setDraft({ ...draft, details: e.target.value })} />
            </label>
            <label className="field">
              מחיר (לא חובה)
              <input type="text" maxLength={60} value={draft.price} placeholder="למשל: 2,490 ₪" onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            </label>
            <label className="field">
              תמונה (לא חובה)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} />
              <span className="status">תמונה שצילמתם או שיש לכם רשות להשתמש בה. עד 5MB.</span>
            </label>
            <button className="btn primary" type="submit" disabled={busy || !draft.name.trim()}>
              {busy ? 'שומר…' : draft.id ? 'שמירת השינויים' : 'הוספה לקטלוג'}
            </button>
            {draft.id && (
              <button className="btn small" type="button" onClick={() => setDraft(EMPTY)}>
                ביטול העריכה
              </button>
            )}
          </form>

          <div className={s.catalogList} aria-label="הפריטים בקטלוג">
            {items === null && !error && <p className="status">טוען…</p>}
            {items?.length === 0 && <p className="status">עוד אין פריטים בקטלוג.</p>}
            {items?.map((item) => (
              <article key={item.id} className={`card ${s.catalogItem}`}>
                {item.photo && <img src={`/api/uploads/${item.photo.file}`} alt="" />}
                <div>
                  <strong>{item.name}</strong>
                  {item.details && <p>{item.details}</p>}
                  {item.price && <p>{item.price}</p>}
                  <div className={s.catalogActions}>
                    <button className="btn small" type="button" onClick={() => setDraft({ id: item.id, name: item.name, details: item.details, price: item.price, file: null })}>
                      עריכה
                    </button>
                    <button className="btn small" type="button" onClick={() => remove(item)}>
                      מחיקה
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
