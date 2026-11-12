import Link from 'next/link';
import s from './festive.module.css';

/** The footer of the customer-facing pages (inside a festive `.root`, which supplies its colours). */
export function SiteFooter() {
  return (
    <footer className={s.footer}>
      <div className={s.wrap}>
        <div className={s.footerGrid}>
          <div className={s.footerBrand}>
            <strong>סטודיו עיצוב</strong>
            <p>הזמנות, תעודות ומודעות בעיצוב אישי. בוחרים עיצוב, מתאימים אותו ומורידים קובץ מוכן לדפוס, בלי גרפיקאי.</p>
          </div>
          <nav className={s.footerCol} aria-label="עיצובים">
            <h3>עיצובים</h3>
            <Link href="/">לשמחה</Link>
            <Link href="/business">לעסק</Link>
            <Link href="/#cats">כל הקטגוריות</Link>
          </nav>
          <nav className={s.footerCol} aria-label="האתר">
            <h3>האתר</h3>
            <Link href="/#how">איך זה עובד</Link>
            <Link href="/my-cards">הסלסלה שלי</Link>
            <Link href="/accessibility">הצהרת נגישות</Link>
          </nav>
        </div>
        <div className={s.footerBottom}>
          <span>© {new Date().getFullYear()} סטודיו עיצוב. כל הזכויות שמורות.</span>
          <span>לכל שמחה, יש כרטיס מושלם.</span>
        </div>
      </div>
    </footer>
  );
}
