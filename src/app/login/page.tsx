'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeNext, useMe } from '@/components/Auth';

export default function LoginPage() {
  const router = useRouter();
  const { me, refresh } = useMe();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState('/');

  useEffect(() => {
    const n = safeNext(new URLSearchParams(window.location.search).get('next'));
    setNext(n);
    if (n !== '/') setMode('register'); // arrived from a card: most likely a new customer
  }, []);

  useEffect(() => {
    if (me) router.replace(next);
  }, [me, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <form className="card login-box" onSubmit={submit}>
        <h1 style={{ fontSize: 24, margin: 0 }}>{mode === 'login' ? 'כניסה' : 'יצירת חשבון'}</h1>
        {next !== '/' && <p className="status" style={{ margin: 0 }}>כדי להתחיל לערוך את הכרטיס צריך להיכנס או להירשם. זה לוקח דקה.</p>}
        {mode === 'register' && (
          <label className="field">
            שם
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
          </label>
        )}
        <label className="field">
          אימייל
          <input type="text" inputMode="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">
          סיסמה {mode === 'register' && '(לפחות 8 תווים)'}
          <input
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            style={{ width: '100%', font: 'inherit', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', minHeight: 40 }}
          />
        </label>
        {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {mode === 'login' ? 'כניסה' : 'יצירת חשבון'}
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? 'אין לי חשבון עדיין, להרשמה' : 'כבר יש לי חשבון'}
        </button>
      </form>
    </main>
  );
}
