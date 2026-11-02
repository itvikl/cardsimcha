'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteFooter } from './SiteFooter';
import s from './festive.module.css';
import { emptyBrand, type BrandFields } from '@/lib/brand';
import { categoryHref, LOGO_TOPIC } from '@/lib/categories';
import type { BrandKit } from '@/lib/types';

const TEXT_FIELDS: { key: keyof BrandFields; label: string; placeholder: string; maxLength: number; dir?: 'ltr'; required?: boolean }[] = [
  { key: 'businessName', label: 'שם העסק', placeholder: 'למשל: כהן מיזוג אוויר', maxLength: 80, required: true },
  { key: 'slogan', label: 'סלוגן', placeholder: 'למשל: קר בקיץ, חם בחורף', maxLength: 120 },
  { key: 'phone', label: 'טלפון', placeholder: '050-0000000', maxLength: 30, dir: 'ltr' },
  { key: 'address', label: 'כתובת', placeholder: 'למשל: רחוב הנביאים 12, ירושלים', maxLength: 120 },
  { key: 'website', label: 'אתר', placeholder: 'www.example.co.il', maxLength: 120, dir: 'ltr' },
];

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

async function send(url: string, init: RequestInit): Promise<BrandKit> {
  const res = await fetch(url, init);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || 'השמירה נכשלה');
  return d;
}

/** The business writes its details once; the business door then deals every design with them. */
export function BrandKitForm() {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/brand', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('טעינת הפרטים נכשלה');
        const d = (await r.json()) as BrandKit | null;
        setKit(d ?? emptyBrand(''));
        setSaved(!!d?.businessName);
      })
      .catch((e) => setError(e.message));
  }, []);

  const set = (patch: Partial<BrandKit>) => {
    setKit((k) => (k ? { ...k, ...patch } : k));
    setSaved(false);
  };

  async function run(action: () => Promise<BrandKit>, merge: (done: BrandKit, current: BrandKit) => BrandKit, after?: () => void) {
    setBusy(true);
    setError('');
    try {
      const done = await action();
      setKit((k) => (k ? merge(done, k) : done));
      after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!kit) return;
    run(
      () => send('/api/brand', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kit) }),
      (done) => done,
      () => setSaved(true),
    );
  }

  async function uploadLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // the logo saves on its own: details still being typed stay in the form
    run(
      async () => {
        const { width, height } = await readSize(file);
        const form = new FormData();
        form.set('file', file);
        form.set('width', String(width));
        form.set('height', String(height));
        return send('/api/brand/logo', { method: 'POST', body: form });
      },
      (done, current) => ({ ...current, logo: done.logo }),
    );
  }

  const removeLogo = () =>
    run(
      () => send('/api/brand/logo', { method: 'DELETE' }),
      (_done, current) => {
        const { logo: _logo, ...rest } = current;
        void _logo;
        return rest;
      },
    );

  return (
    <div className={`${s.root} ${s.business}`}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href="/business">
          → חזרה לעיצובים לעסק
        </Link>
        <div className={`${s.head} ${s.rise}`}>
          <span className={s.eyebrow}>המיתוג של העסק</span>
          <h1 className={s.h2}>
            פעם אחת, <span className={s.shine}>על כל העיצובים</span>
          </h1>
          <p>מכניסים לוגו, צבעים ופרטים, והעיצובים לעסק כבר נפתחים איתם.</p>
        </div>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {kit === null ? (
          !error && <p className="status" role="status">טוען…</p>
        ) : (
          <div className={s.brandLayout}>
            <form className={`card ${s.brandForm}`} onSubmit={submit}>
              <div className="field">
                <span id="brand-logo-label">לוגו</span>
                <div className={s.brandLogoRow}>
                  <label className="btn small">
                    {kit.logo ? 'החלפת הלוגו' : 'העלאת לוגו'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" aria-labelledby="brand-logo-label" className={s.brandFile} onChange={uploadLogo} disabled={busy} />
                  </label>
                  {kit.logo && (
                    <button type="button" className="btn small" onClick={removeLogo} disabled={busy}>
                      הסרת הלוגו
                    </button>
                  )}
                </div>
                <span className="status">PNG עם רקע שקוף נראה הכי טוב. עד 5MB.</span>
                {!kit.logo && (
                  <Link className={s.back} href={categoryHref(LOGO_TOPIC, 'business')}>
                    ✎ אין לכם לוגו? יוצרים אחד כאן
                  </Link>
                )}
              </div>

              {TEXT_FIELDS.map((f) => (
                <label key={f.key} className="field">
                  {f.label}
                  <input
                    type="text"
                    dir={f.dir}
                    value={kit[f.key]}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    required={f.required}
                    onChange={(e) => set({ [f.key]: e.target.value })}
                  />
                </label>
              ))}

              <div className={s.brandColors}>
                <label className="field">
                  צבע ראשי
                  <input type="color" value={kit.primaryColor} onChange={(e) => set({ primaryColor: e.target.value })} />
                </label>
                <label className="field">
                  צבע משני
                  <input type="color" value={kit.secondaryColor} onChange={(e) => set({ secondaryColor: e.target.value })} />
                </label>
              </div>

              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'שומר…' : 'שמירה'}
              </button>
              {saved && (
                <p className="status" role="status" style={{ margin: 0 }}>
                  נשמר. <Link href="/business">לעיצובים עם המיתוג שלכם ←</Link>
                </p>
              )}
            </form>

            <aside className={s.brandSample} aria-label="כך הפרטים ייראו">
              {kit.logo && <img src={`/api/uploads/${kit.logo.file}`} alt="הלוגו של העסק" />}
              <strong style={{ color: kit.primaryColor }}>{kit.businessName || 'שם העסק'}</strong>
              {kit.slogan && <span>{kit.slogan}</span>}
              <span className={s.brandStrip} style={{ background: kit.secondaryColor }} aria-hidden="true" />
              {kit.phone && <span dir="ltr">{kit.phone}</span>}
              {kit.address && <span>{kit.address}</span>}
              {kit.website && <span dir="ltr">{kit.website}</span>}
            </aside>
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
