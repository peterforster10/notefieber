import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Providers } from './providers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: 'NoteFieber', description: t('description') };
}

// Mobil: Bildschirmtastatur verkleinert den Inhalt, statt ihn zu überdecken (Hinweis von BlockNote)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content',
};

// Sprache aus Cookie oder Accept-Language (src/i18n/request.ts); die Texte gehen an die
// Client-Komponenten weiter (NextIntlClientProvider)
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
