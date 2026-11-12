'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteFooter } from './SiteFooter';
import s from './festive.module.css';

type Mine = { id: string; kind: 'template' | 'design'; name: string; updatedAt: string; thumbnail: string | null; keep: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'שגיאה לא צפויה');
  return data as T;
}

/** The customer's basket: only cards they already started editing (the server leaves out ones just opened). */
export function Basket() {
  const router = useRouter();
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const list = await api<Mine[]>('/api/projects');
    setMine(list.filter((p) => p.kind === 'design'));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  /** a new ad from one the business keeps as its template; the template itself stays as it is */
  async function startFrom(it: Mine) {
    try {
      const { id } = await api<{ id: string }>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromDesign: it.id }) });
      router.push(`/editor/${id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(it: Mine) {
    if (!confirm(`למחוק את "${it.name}"? אי אפשר לבטל.`)) return;
    try {
      await api(`/api/projects/${it.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className={s.root}>
      <section className={`${s.wrap} ${s.basket}`}>
        <span className={s.eyebrow}>ההמשך שלכם</span>
        <h1 className={s.h2}>
          הסלסלה <span className={s.shine}>שלי</span>
        </h1>
        <p className={s.basketLead}>כל כרטיס כאן שמור בדיוק כמו שהשארתם אותו. בחרו אחד וחזרו לעבוד עליו.</p>

        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {mine === null ? (
          <p className={s.basketLead}>טוען…</p>
        ) : mine.length === 0 ? (
          <div className={s.emptyState}>
            <strong>הסלסלה עדיין ריקה</strong>
            <span>כרטיס נכנס לסלסלה ברגע שמתחילים לערוך אותו.</span>
            <Link className={`${s.btn} ${s.dark}`} href="/#cats">
              בחרו עיצוב ←
            </Link>
          </div>
        ) : (
          <div className={s.mineGrid}>
            {mine.map((it) => (
              <div key={it.id} className={s.mineCard}>
                <Link href={`/editor/${it.id}`} aria-label={`המשך עריכה של ${it.name}`}>
                  <div className={s.mineThumb} style={it.thumbnail ? { backgroundImage: `url("${it.thumbnail}")` } : undefined} />
                </Link>
                <strong>{it.name}</strong>
                <small>עודכן {new Date(it.updatedAt).toLocaleString('he-IL')}</small>
                {it.keep && <small>✓ התבנית שלי</small>}
                <div className={s.mineRow}>
                  {it.keep && (
                    <button type="button" className={`${s.btn} ${s.dark}`} onClick={() => startFrom(it)}>
                      מודעה חדשה מהתבנית
                    </button>
                  )}
                  <Link className={`${s.btn} ${s.dark}`} href={`/editor/${it.id}`}>
                    המשך עריכה
                  </Link>
                  <button type="button" className={`${s.btn} ${s.danger}`} onClick={() => remove(it)}>
                    מחיקה
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
