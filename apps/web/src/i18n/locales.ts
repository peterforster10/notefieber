// Sprachen der Oberfläche (E15). Die Sprache steht nicht in der Adresse: Der Server liest sie aus
// dem Cookie nf_locale (sonst aus Accept-Language), angemeldete Personen haben sie zusätzlich in
// users.locale (LocaleSync in app/locale.tsx gleicht beides ab). Texte in apps/web/messages/.
export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

/** Cookie mit der gewählten Sprache; eine Einstellung, kein Geheimnis (deshalb nicht HttpOnly) */
export const LOCALE_COOKIE = 'nf_locale';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/** Beliebige Sprachangabe auf eine unterstützte Sprache: de-AT → de, fr → undefined */
export function matchLocale(value: string | null | undefined): Locale | undefined {
  const base = value?.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : undefined;
}

/** Wie matchLocale, ohne Treffer die Standardsprache */
export const toLocale = (value: string | null | undefined): Locale => matchLocale(value) ?? DEFAULT_LOCALE;

/** Erste unterstützte Sprache aus Accept-Language (nach Gewicht q) */
export function fromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  const ranked = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag ?? '', q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return undefined;
}

/** Im Browser: gewählte Sprache für ein Jahr merken */
export function writeLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}
