'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMe } from '@/components/Auth';
import { CUSTOMER_FONTS, FONTS } from '@/lib/canvas';
import { loadUploadedFonts, type UploadedFont } from '@/lib/fontsClient';

const SAMPLE = 'מבצע החודש אבגד 123';

/** The admin's font library: what designs are written in, and which of those businesses may choose for their own texts. */
export default function FontsPage() {
  const { me, loading } = useMe();
  const router = useRouter();
  const [fonts, setFonts] = useState<UploadedFont[] | null>(null);
  const [family, setFamily] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/fonts', { cache: 'no-store' });
    if (!res.ok) throw new Error('טעינת הפונטים נכשלה');
    setFonts(await res.json());
  }, []);

  useEffect(() => {
    if (loading) return;
    if (me?.role !== 'admin') {
      router.replace('/');
      return;
    }
    load().catch((e) => setError(e.message));
    loadUploadedFonts().catch(() => {});
  }, [me, loading, load, router]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('family', family);
      const res = await fetch('/api/fonts', { method: 'POST', body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'ההעלאה נכשלה');
      document.fonts.add(await new FontFace(d.family, `url(/api/uploads/${d.file})`).load());
      setFamily('');
      setFile(null);
      setFileKey((k) => k + 1);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setOffered(f: UploadedFont, customer: boolean) {
    setError('');
    const res = await fetch(`/api/fonts/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer }) });
    if (!res.ok) return setError('השמירה נכשלה');
    await load();
  }

  async function remove(f: UploadedFont) {
    if (!confirm(`להסיר את "${f.family}" מהרשימה? עיצובים שכבר נכתבו בו יישארו בלעדיו אם ייפתחו אחרי ההסרה.`)) return;
    setError('');
    const res = await fetch(`/api/fonts/${f.id}`, { method: 'DELETE' });
    if (!res.ok) return setError('ההסרה נכשלה');
    await load();
  }

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>ספריית פונטים</h1>
        <Link className="btn small" href="/">חזרה לתבניות</Link>
      </div>
      <p className="status">
        הפונטים כאן זמינים לעיצוב התבניות. עסק רואה רק את הרשימה הקצרה שמסומנת כאן, ורק כשהוא כותב טקסט משלו. קובץ פונט שהאתר משתמש בו נשלח לדפדפן, אז אפשר להקשות על העתקה שלו אבל לא למנוע אותה: חשוב שהרישיון יתיר שימוש ברשת.
      </p>
      <form className="card row" style={{ flexWrap: 'wrap', alignItems: 'end' }} onSubmit={add}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          שם הפונט
          <input type="text" required maxLength={60} value={family} placeholder="כך הוא יופיע ברשימות" onChange={(e) => setFamily(e.target.value)} />
        </label>
        <label className="field">
          קובץ (WOFF2, WOFF, TTF, OTF)
          <input key={fileKey} type="file" required accept=".woff2,.woff,.ttf,.otf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'מעלה…' : 'הוספת פונט'}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <table className="font-table">
        <thead>
          <tr>
            <th>פונט</th>
            <th>כך הוא נראה</th>
            <th>מוצע לעסקים</th>
            <th aria-label="פעולות" />
          </tr>
        </thead>
        <tbody>
          {FONTS.map((f) => (
            <tr key={f}>
              <td>{f}</td>
              <td style={{ fontFamily: `"${f}"`, fontSize: 22 }}>{SAMPLE}</td>
              <td>{CUSTOMER_FONTS.includes(f) ? 'כן' : 'לא'}</td>
              <td className="status">מובנה</td>
            </tr>
          ))}
          {fonts?.map((f) => (
            <tr key={f.id}>
              <td>{f.family}</td>
              <td style={{ fontFamily: `"${f.family}"`, fontSize: 22 }}>{SAMPLE}</td>
              <td>
                <input type="checkbox" aria-label={`להציע לעסקים את ${f.family}`} checked={f.customer} onChange={(e) => setOffered(f, e.target.checked)} />
              </td>
              <td>
                <button type="button" className="btn small" onClick={() => remove(f)}>
                  הסרה
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
