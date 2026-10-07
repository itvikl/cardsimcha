import type { Metadata } from 'next';
import './globals.css';
import { TopBar } from '@/components/TopBar';
import { AuthProvider } from '@/components/Auth';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = { title: 'סטודיו עיצוב', description: 'יצירת עיצובים מקטגוריות ותמונות' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;800&family=Frank+Ruhl+Libre:wght@400;700&family=Assistant:wght@400;700&family=Secular+One&display=swap"
        />
      </head>
      <body>
        <ToastProvider>
          <AuthProvider>
            <TopBar />
            {children}
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
