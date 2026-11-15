'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteFooter } from './SiteFooter';
import { useToast } from './Toast';
import s from './festive.module.css';
import { fillMessage, PROFESSIONS, professionOf } from '@/lib/professions';
import type { BrandKit } from '@/lib/types';

/**
 * Ready advertising messages for each profession, with the business's details written in. The owner adjusts one,
 * copies it, and sends it to whoever they want: the site sends nothing itself.
 */
export function AdMessages({ initialTopic }: { initialTopic?: string }) {
  const { push } = useToast();
  const [kit, setKit] = useState<BrandKit | null | undefined>(undefined);
  const [topic, setTopic] = useState(professionOf(initialTopic ?? null)?.topic ?? PROFESSIONS[0].topic);
  // what the owner changed in a message, by its title; the rest follows the kit
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/brand', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BrandKit | null) => setKit(d?.businessName ? d : null))
      .catch(() => setKit(null));
  }, []);

  const profession = professionOf(topic)!;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      push('ההודעה הועתקה. עכשיו אפשר להדביק ולשלוח למי שרוצים.', 'success');
    } catch {
      push('הדפדפן לא אפשר להעתיק. סמנו את הטקסט והעתיקו ידנית.', 'error');
    }
  }

  return (
    <div className={`${s.root} ${s.business}`}>
      <section className={`${s.wrap} ${s.catPage}`}>
        <Link className={s.back} href="/business">
          → חזרה לעיצובים לעסק
        </Link>
        <div className={`${s.head} ${s.rise}`}>
          <span className={s.eyebrow}>הודעות פרסום</span>
          <h1 className={s.h2}>
            נוסח מוכן, <span className={s.shine}>עם הפרטים שלכם</span>
          </h1>
          <p>בוחרים הודעה, מתאימים אותה, מעתיקים ושולחים למי שרוצים.</p>
        </div>

        <nav className={s.filters} aria-label="מקצוע">
          {PROFESSIONS.map((p) => (
            <button
              key={p.topic}
              type="button"
              className={s.filter}
              aria-pressed={p.topic === topic}
              onClick={() => {
                setTopic(p.topic);
                setEdits({});
              }}
            >
              {p.topic}
            </button>
          ))}
        </nav>

        {kit === null && (
          <div className={s.emptyState}>
            <strong>קודם ממלאים את פרטי העסק</strong>
            <span>שם העסק והטלפון ייכנסו לכל הודעה מעצמם.</span>
            <Link className={`${s.btn} ${s.dark}`} href="/business/brand">
              למיתוג של העסק ←
            </Link>
          </div>
        )}

        {kit && (
          <div className={s.messages}>
            {profession.messages.map((m) => {
              const text = edits[m.title] ?? fillMessage(m.body, kit);
              return (
                <div key={m.title} className={`card ${s.message}`}>
                  <label className="field">
                    {m.title}
                    <textarea dir="rtl" rows={text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 40)), 1)} value={text} maxLength={1000} onChange={(e) => setEdits((x) => ({ ...x, [m.title]: e.target.value }))} />
                  </label>
                  <button type="button" className={`${s.btn} ${s.dark}`} onClick={() => copy(text)}>
                    העתקה
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
