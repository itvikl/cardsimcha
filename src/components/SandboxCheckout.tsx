'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/price';
import type { Purchase } from '@/lib/types';

const OUTCOMES: { outcome: 'paid' | 'failed' | 'canceled'; label: string }[] = [
  { outcome: 'paid', label: 'תשלום מצליח' },
  { outcome: 'failed', label: 'תשלום נכשל' },
  { outcome: 'canceled', label: 'ביטול' },
];

/** A test payment page: no card is asked for and no money moves. */
export function SandboxCheckout({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useEffect(() => {
    fetch(`/api/billing/sandbox?purchase=${encodeURIComponent(purchaseId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('התשלום לא נמצא');
        setPurchase(await r.json());
      })
      .catch((e) => setError(e.message));
  }, [purchaseId]);

  async function settle(outcome: 'paid' | 'failed' | 'canceled') {
    const res = await fetch('/api/billing/sandbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purchase: purchaseId, outcome }),
    });
    if (!res.ok) {
      setError('הפעולה נכשלה');
      return;
    }
    if (outcome !== 'paid') {
      setResult(outcome === 'failed' ? 'התשלום נכשל. לא חויבתם, והעיצוב נשאר שמור.' : 'התשלום בוטל. העיצוב נשאר שמור.');
      return;
    }
    router.push(purchase?.projectId ? `/editor/${purchase.projectId}` : purchase?.kind === 'series' ? '/my-cards' : '/business/billing');
  }

  return (
    <main className="page" style={{ maxWidth: 480 }}>
      <h1>תשלום לדוגמה</h1>
      <p className="sub">סביבת בדיקות: לא מזינים כרטיס, ולא עובר כסף.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && <p role="status">{result}</p>}
      {purchase && !result && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <strong>
            {purchase.kind === 'subscription' ? 'מנוי חודשי' : purchase.kind === 'series' ? 'סדרה' : 'עיצוב אחד'}: {formatPrice(purchase.amount)}
          </strong>
          {OUTCOMES.map((o) => (
            <button key={o.outcome} className={o.outcome === 'paid' ? 'btn primary' : 'btn'} onClick={() => settle(o.outcome)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
