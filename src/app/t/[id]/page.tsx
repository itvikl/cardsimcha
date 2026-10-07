'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMe } from '@/components/Auth';

type Template = { id: string; name: string; width_mm: number; height_mm: number; thumbnail: string | null; fields: string[]; canSwapBackground: boolean };

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me } = useMe();
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
  }, [id, router]);

  // coming back from sign-up with ?start=1: create the card right away
  useEffect(() => {
    if (!me || !tpl || started.current) return;
    if (new URLSearchParams(window.location.search).get('start') === '1') {
      started.current = true;
      start();
    }
  }, [me, tpl, start]);

  function onStart() {
    if (me) start();
    else router.push('/login?next=' + encodeURIComponent(`/t/${id}?start=1`));
  }

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
      <Link href="/#cards" className="btn small">
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
            <button className="btn primary xl" onClick={onStart} disabled={busy}>
              {me ? 'התחלת עריכה' : 'התחלת עריכה (נדרשת הרשמה)'}
            </button>
          </div>
          {!me && <p className="status" style={{ margin: 0 }}>צפייה בכרטיסים חופשית. ההרשמה נדרשת רק כדי לערוך ולשמור כרטיס משלך.</p>}
        </div>
      </div>
    </main>
  );
}
