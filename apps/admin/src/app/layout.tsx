import type { Metadata } from 'next';
import { Inter, Oswald } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import type { Lang } from '@/lib/i18n';
import { Providers } from './providers';
import './globals.css';

// Player ilovasi bilan bir xil: Oswald — sarlavhalar (lotin + kirill), Inter — matn
const oswald = Oswald({ subsets: ['latin', 'cyrillic'], weight: ['600', '700'], variable: '--font-oswald' });
const inter = Inter({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'Match Up Admin', template: '%s · Match Up Admin' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang: Lang = (await cookies()).get('mu_lang')?.value === 'ru' ? 'ru' : 'uz-Latn';
  return (
    <html lang={lang === 'ru' ? 'ru' : 'uz-Latn'} className={`${oswald.variable} ${inter.variable}`}>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
