import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Providers } from './providers';
// Schriften vom eigenen Server (@fontsource, OFL-1.1), nie von Google: Inter als variable Schrift
// für Oberfläche und Inhalt, IBM Plex Mono für Code (CLAUDE.md, Abschnitt 9). Der Browser lädt
// nur die Schriftschnitte und Zeichenbereiche (unicode-range), die eine Seite wirklich braucht.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
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
