import type { Metadata } from 'next';
import './globals.css';
import { QuickNav } from '@/components/QuickNav';
import { TopBar } from '@/components/TopBar';
import { AuthProvider } from '@/components/Auth';
import { ToastProvider } from '@/components/Toast';
import { SiteBackdrop } from '@/components/SiteBackdrop';
import { CardFlight } from '@/components/CardFlight';

export const metadata: Metadata = {
  // share previews (opengraph-image.jpg) need absolute URLs; set SITE_URL to the public address, e.g. https://example.co.il
  metadataBase: process.env.SITE_URL ? new URL(process.env.SITE_URL) : undefined,
  title: 'סטודיו עיצוב',
  description: 'יצירת עיצובים מקטגוריות ותמונות',
  openGraph: { siteName: 'סטודיו עיצוב', locale: 'he_IL', type: 'website' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&family=Frank+Ruhl+Libre:wght@400;700;900&family=Assistant:wght@400;700&family=Secular+One&display=swap"
        />
      </head>
      <body>
        <SiteBackdrop />
        <ToastProvider>
          <AuthProvider>
            <TopBar />
            <QuickNav />
            {children}
            <CardFlight />
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
