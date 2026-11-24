// next-intl ohne Sprache in der Adresse: pro Anfrage Sprache und Texte bestimmen (src/i18n/locales.ts).
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, fromAcceptLanguage, matchLocale } from './locales';

export default getRequestConfig(async () => {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = matchLocale(cookie) ?? fromAcceptLanguage((await headers()).get('accept-language')) ?? DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
