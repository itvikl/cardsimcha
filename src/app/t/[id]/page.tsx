'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMe } from '@/components/Auth';
import { formatPrice } from '@/lib/price';

// price: not stored on this branch yet, so the API leaves it out
type Template = { id: string; name: string; price?: number | null; width_mm: number; height_mm: number; thumbnail: string | null; fields: string[]; canSwapBackground: boolean };

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { ensureSession } = useMe();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    fetch(`/api/templates/${id}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'הכרטיס לא נמצא');
        setTpl(d);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const start = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await ensureSession();
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'לא הצלחנו ליצור את הכרטיס');
      router.push(`/editor/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [id, router, ensureSession]);

  // a link saved with ?start=1 from when this page sent visitors to sign up: create the card right away
  useEffect(() => {
    if (!tpl || started.current) return;
    if (new URLSearchParams(window.location.search).get('start') === '1') {
      started.current = true;
      start();
    }
  }, [tpl, start]);

  if (error && !tpl) {
    return (
      <main className="page">
        <p className="error" role="alert">{error}</p>
        <Link className="btn" href="/">חזרה לכל הכרטיסים</Link>
      </main>
    );
  }
  if (!tpl) return <p className="status" style={{ padding: 24 }}>טוען…</p>;

  return (
    <main className="page">
      <Link href="/#cats" className="btn small">
        כל הכרטיסים
      </Link>
      <div className="tpl-layout">
        <div
          className="preview tpl-preview"
          style={{
            aspectRatio: `${tpl.width_mm} / ${tpl.height_mm}`,
            ...(tpl.thumbnail ? { backgroundImage: `url(${tpl.thumbnail})`, backgroundSize: 'cover' } : {}),
          }}
          role="img"
          aria-label={`תצוגה מקדימה של ${tpl.name}`}
        >
          {!tpl.thumbnail && 'אין תצוגה מקדימה'}
        </div>
        <div style={{ display: 'grid', gap: 22, alignContent: 'start', paddingTop: 12 }}>
          <div>
            <span className="eyebrow">כרטיס</span>
            <h1 style={{ margin: '4px 0 0', fontSize: 'clamp(34px, 5vw, 56px)', lineHeight: 1.08 }}>{tpl.name}</h1>
            {typeof tpl.price === 'number' && <p style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 700 }}>{formatPrice(tpl.price)}</p>}
          </div>
          {(tpl.fields.length > 0 || tpl.canSwapBackground) && (
            <div>
              <p className="panel-title">מה אפשר לשנות בכרטיס</p>
              <ul className="chips">
                {tpl.fields.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
                <li>צבע ומיקום הטקסטים</li>
                {tpl.canSwapBackground && <li>רקע</li>}
              </ul>
            </div>
          )}
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div>
            <button className="btn primary xl" onClick={start} disabled={busy}>
              התחלת עריכה
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
