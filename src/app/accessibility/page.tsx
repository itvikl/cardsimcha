import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import s from '@/components/festive.module.css';

export const metadata: Metadata = { title: 'הצהרת נגישות · סטודיו עיצוב' };

/**
 * Draft accessibility statement. The bracketed contact details must be filled in
 * before launch: the regulations require a reachable accessibility contact.
 */
export default function Accessibility() {
  return (
    <div className={s.root}>
      <article className={`${s.wrap} ${s.prose}`}>
        <span className={s.eyebrow}>נגישות</span>
        <h1 className={s.h2}>
          הצהרת <span className={s.shine}>נגישות</span>
        </h1>
        <p>
          אנחנו רוצים שכל אחד ואחת יוכלו לעצב כאן הזמנה, תעודה או מודעה בקלות. האתר נבנה מתוך כוונה לעמוד בתקנות שוויון זכויות
          לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013, ובתקן הישראלי 5568, המבוסס על הנחיות WCAG 2.0 ברמה AA.
        </p>

        <h2>מה עשינו באתר</h2>
        <ul>
          <li>אפשר לנווט באתר במקלדת, ומיקום הפוקוס מסומן בבירור.</li>
          <li>את טבעת העיצובים אפשר לסובב בחיצי המקלדת ולפתוח עיצוב במקש Enter.</li>
          <li>כפתורים, קישורים ותמונות מתוארים בתוויות שקוראי מסך מקריאים.</li>
          <li>מי שהגדיר במכשיר ״הפחתת תנועה״ יראה את האתר בלי אנימציות ובלי וידאו ברקע.</li>
          <li>האתר מותאם לעברית ולכיוון כתיבה מימין לשמאל, ולתצוגה במחשב ובטלפון.</li>
        </ul>

        <h2>מה עוד לא מושלם</h2>
        <p>
          עורך העיצוב הוא כלי גרפי, וחלק מהפעולות בו (למשל גרירת טקסט על הכרטיס) נוחות יותר בעכבר או במגע. אם נתקלתם בקושי, נשמח
          לעזור לכם להשלים את העיצוב בדרך אחרת.
        </p>

        <h2>נתקלתם בבעיה? דברו איתנו</h2>
        <p>נשמח לשמוע על כל קושי בשימוש באתר ולתקן אותו בהקדם.</p>
        <ul>
          <li>רכז/ת נגישות: [שם מלא]</li>
          <li>טלפון: [מספר טלפון]</li>
          <li>דוא״ל: [כתובת דוא״ל]</li>
        </ul>

        <p className={s.proseNote}>ההצהרה עודכנה בתאריך 26.10.2026.</p>
      </article>
      <SiteFooter />
    </div>
  );
}
