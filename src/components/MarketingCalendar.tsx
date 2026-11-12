'use client';

import Link from 'next/link';
import { categoryHref } from '@/lib/categories';
import styles from './MarketingCalendar.module.css';

/** A marketing event recommendation: what to post and when. */
type MarketingEvent = {
  month: number; // 1-12
  day?: number;  // if specific day, else first of the month
  label: string;
  tip: string;
  topic: string; // links to this category
  color: string;
};

/** Jewish and Israeli marketing calendar — approximate Gregorian months. */
const EVENTS: MarketingEvent[] = [
  { month: 1,  label: 'ינואר — חורף', tip: 'עסקאות חורף וסיילים. הזמן לפרסם מבצעי עונה.', topic: 'כללי', color: '#3b82f6' },
  { month: 2,  day: 14, label: "ולנטיין / ט\"ו באב", tip: 'מתנות ושירותים לזוגות. מוצרי יופי, ספא, מסעדות.', topic: 'קוסמטיקה ויופי', color: '#ec4899' },
  { month: 3,  label: 'פורים', tip: 'חגיגות ומתנות. זמן מצוין לפרסם מוצרי מתנה ומיוחדים.', topic: 'כללי', color: '#f97316' },
  { month: 4,  label: 'פסח', tip: 'ניקיון ורכישות לחג. מכירות ענקיות ושירותים לבית.', topic: 'כללי', color: '#8b5cf6' },
  { month: 5,  label: "ל\"ג בעומר", tip: 'אירועים בחוץ. ספק ציוד, אוכל, פעילויות.', topic: 'כללי', color: '#22c55e' },
  { month: 6,  label: 'שבועות + קיץ', tip: 'תחילת הקיץ. מוצרי קיץ, מיזוג, קמפינג.', topic: 'כללי', color: '#eab308' },
  { month: 7,  label: 'יולי — שיא הקיץ', tip: 'חופש גדול. שירותים לילדים, בידור, נסיעות.', topic: 'כללי', color: '#f97316' },
  { month: 8,  label: 'אוגוסט — חזרה ללימודים', tip: 'ציוד לבית הספר, תיקים, ביגוד, שיעורים פרטיים.', topic: 'ייעוץ עסקי', color: '#3b82f6' },
  { month: 9,  label: 'ראש השנה + סוכות', tip: 'החגים הגדולים. קידום חגיגי לכל עסק, מתנות, מוצרי חג.', topic: 'כללי', color: '#f59e0b' },
  { month: 10, label: 'שמחת תורה + חשוון', tip: 'אחרי החגים — חזרה לשגרה. פרסום שגרתי ועסקאות.', topic: 'כללי', color: '#6366f1' },
  { month: 11, label: 'חנוכה', tip: 'עונת המתנות. מבצעים ומוצרי מתנה מוכרים מעולה.', topic: 'כללי', color: '#0ea5e9' },
  { month: 12, label: 'דצמבר — סוף שנה', tip: 'סיכום שנה + חנוכה מאוחר / ינואר. מוצרי חורף, מתנות אחרונות.', topic: 'כללי', color: '#8b5cf6' },
];

function monthName(m: number) {
  return ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][m - 1];
}

/** Monthly marketing calendar for the business dashboard. Shows the next 3 months. */
export function MarketingCalendar() {
  const now = new Date();
  const thisMonth = now.getMonth() + 1; // 1-based

  // Show current month + 2 upcoming
  const months = [0, 1, 2].map((offset) => {
    const m = ((thisMonth - 1 + offset) % 12) + 1;
    return { month: m, events: EVENTS.filter((e) => e.month === m) };
  });

  return (
    <section className={styles.root}>
      <div className={styles.head}>
        <h2 className={styles.title}>לוח שיווק</h2>
        <p className={styles.sub}>מה כדאי לפרסם בכל חודש</p>
      </div>
      <div className={styles.grid}>
        {months.map(({ month, events }, idx) => (
          <div key={month} className={`${styles.monthCard} ${idx === 0 ? styles.current : ''}`}>
            <div className={styles.monthHead}>
              <span className={styles.monthName}>{monthName(month)}</span>
              {idx === 0 && <span className={styles.nowBadge}>החודש</span>}
            </div>
            {events.length === 0 ? (
              <p className={styles.empty}>חודש שקט — טוב לפרסם עיצוב כללי לעסק.</p>
            ) : (
              <ul className={styles.eventList}>
                {events.map((ev) => (
                  <li key={ev.label} className={styles.event}>
                    <span className={styles.dot} style={{ background: ev.color }} />
                    <div className={styles.eventBody}>
                      <strong className={styles.eventLabel}>{ev.label}</strong>
                      <p className={styles.eventTip}>{ev.tip}</p>
                      <Link href={categoryHref(ev.topic, 'business')} className={styles.eventCta}>
                        לעיצובים ←
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
