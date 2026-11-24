// Typen für next-intl: Schlüssel aus messages/de.json, nur unterstützte Sprachen.
// Dass en.json dieselben Schlüssel hat, prüft messages/messages.test.mjs.
import type messages from '../messages/de.json';
import type { Locale } from './i18n/locales';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
