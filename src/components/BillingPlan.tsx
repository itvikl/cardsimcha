'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteFooter } from './SiteFooter';
import { useToast } from './Toast';
import s from './festive.module.css';
import { formatPrice } from '@/lib/price';
import type { Subscription } from '@/lib/types';

type Plan = { enabled: boolean; subscriptionPrice: number; subscription: Subscription | null };

/** The customer's plan: free, or a monthly subscription they can start and cancel here. */
export function BillingPlan() {
  const { push } = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/billing', { cache: 'no-store' });
    if (r.ok) setPlan(await r.json());
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const sub = plan?.subscription;
  const active = !!sub && sub.currentPeriodEnd > new Date().toISOString();
  const until = sub ? new Date(sub.currentPeriodEnd).toLocaleDateString('he-IL') : '';

  async function subscribe() {
    setBusy(true);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'subscription' }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error);
      window.location.href = d.url;
    } catch (e) {
      push((e as Error).message || 'לא הצלחנו לפתוח את התשלום.', 'error');
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm(`לבטל את המנוי? הוא ימשיך לעבוד עד ${until}, ולא יהיו חיובים נוספים.`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/billing', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await load();
      push('המנוי בוטל.', 'success');
    } catch {
      push('הביטול נכשל. נסו שוב.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${s.root} ${s.business}`}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href="/business">
          → חזרה לעיצובים לעסק
        </Link>
        <div className={`${s.head} ${s.rise}`}>
          <span className={s.eyebrow}>התוכנית שלי</span>
          <h1 className={s.h2}>{active ? 'יש לכם מנוי' : 'התוכנית החינמית'}</h1>
        </div>
        {plan && (
          <div className={`card ${s.plan}`}>
            {!plan.enabled ? (
              <p>בשלב הזה כל ההורדות חינם. כשהתשלום ייפתח, נעדכן כאן.</p>
            ) : active ? (
              <>
                <p>{sub!.status === 'canceled' ? `המנוי בוטל, וימשיך לעבוד עד ${until}.` : `המנוי פעיל. החיוב הבא: ${until}.`}</p>
                <p>כל העיצובים פתוחים להורדה, וזמני השבת יוצאים בלי קרדיט.</p>
                {sub!.status === 'active' && (
                  <button className="btn small" disabled={busy} onClick={cancel}>
                    ביטול המנוי
                  </button>
                )}
              </>
            ) : (
              <>
                <p>המיתוג, זמני השבת והודעות הפרסום חינם. עיצוב בתשלום מורידים לפי המחיר שלו, או עם מנוי.</p>
                <button className={`${s.btn} ${s.dark}`} disabled={busy} onClick={subscribe}>
                  מנוי, {formatPrice(plan.subscriptionPrice)} לחודש
                </button>
              </>
            )}
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
