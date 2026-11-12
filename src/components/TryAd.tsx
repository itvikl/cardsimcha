'use client';

import { useState, type FormEvent } from 'react';
import s from './festive.module.css';
import type { BrandDraft } from '@/lib/brandDraft';

/** A live preview card that shows the business's brand in realtime. */
function LivePreview({
  businessName,
  phone,
  primaryColor,
  secondaryColor,
}: {
  businessName: string;
  phone: string;
  primaryColor: string;
  secondaryColor: string;
}) {
  const name = businessName.trim() || 'שם העסק';
  const tel = phone.trim() || '050-0000000';

  return (
    <div
      className={s.livePreview}
      style={{ background: primaryColor, color: '#fff' }}
      aria-hidden="true"
    >
      <div className={s.livePreviewBadge} style={{ background: secondaryColor }} />
      <div className={s.livePreviewInner}>
        <span className={s.livePreviewName}>{name}</span>
        <span className={s.livePreviewTagline}>מקצועי • אמין • זמין</span>
        <span className={s.livePreviewPhone} style={{ color: secondaryColor, direction: 'ltr' }}>
          {tel}
        </span>
      </div>
      <div className={s.livePreviewFooter} style={{ borderTopColor: secondaryColor + '55' }}>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>כך ייראו המודעות שלכם</span>
      </div>
    </div>
  );
}

/** A business's first minute: its name and phone, and every ad on the page redraws with them, before any sign-up. */
export function TryAd({ onSubmit, signedIn }: { onSubmit: (draft: BrandDraft) => Promise<void> | void; signedIn: boolean }) {
  const [businessName, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [primaryColor, setPrimary] = useState('#14336B');
  const [secondaryColor, setSecondary] = useState('#E8A33D');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ businessName: businessName.trim(), phone: phone.trim(), primaryColor, secondaryColor });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className={s.tryAdWrap}>
      <LivePreview
        businessName={businessName}
        phone={phone}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
      />
      <form className={`card ${s.tryAd}`} onSubmit={submit}>
        <strong>איך המודעות ייראו עם העסק שלכם?</strong>
        <p className="status" style={{ margin: 0 }}>
          {signedIn
            ? 'מקלידים שם וטלפון — המודעות מתעדכנות בזמן אמת.'
            : 'מקלידים שם וטלפון — המודעות מתעדכנות בזמן אמת. בלי הרשמה.'}
        </p>
        <div className={s.tryFields}>
          <label className="field">
            שם העסק
            <input
              type="text"
              required
              maxLength={80}
              value={businessName}
              placeholder="למשל: כהן מיזוג אוויר"
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
            />
          </label>
          <label className="field">
            טלפון
            <input
              type="tel"
              dir="ltr"
              maxLength={30}
              pattern="[0-9+\-\(\) ]*"
              title="ספרות בלבד"
              value={phone}
              placeholder="050-0000000"
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </label>
          <div className={s.colorRow}>
            <label className={`field ${s.colorField}`}>
              צבע ראשי
              <input type="color" value={primaryColor} onChange={(e) => setPrimary(e.target.value)} />
            </label>
            <label className={`field ${s.colorField}`}>
              צבע משני
              <input type="color" value={secondaryColor} onChange={(e) => setSecondary(e.target.value)} />
            </label>
          </div>
        </div>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <button className="btn primary shine" type="submit" disabled={busy || !businessName.trim()}>
          {busy ? 'מעדכן…' : 'הציגו את המודעות שלי'}
        </button>
      </form>
    </div>
  );
}
