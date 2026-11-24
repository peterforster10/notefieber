'use client';

// Sprache der Oberfläche (E15) wählen und abgleichen. Der Server rendert in der Sprache aus dem
// Cookie nf_locale (src/i18n/request.ts); angemeldete Personen haben ihre Sprache in users.locale
// (PATCH /api/v1/me), damit sie auf jedem Gerät gilt.
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LOCALES, isLocale, toLocale, writeLocaleCookie, type Locale } from '@/i18n/locales';
import { api, useMe } from '@/lib/api';
import { useErrorText } from '@/lib/errors';

/**
 * Nach dem Laden der angemeldeten Person: Weicht die Sprache im Profil vom Cookie ab (anderes
 * Gerät, anderer Browser), das Cookie nachziehen und neu rendern. Höchstens einmal pro Sprache,
 * damit ein blockiertes Cookie keine Schleife auslöst.
 */
export function LocaleSync() {
  const me = useMe();
  const locale = useLocale();
  const router = useRouter();
  const tried = useRef<string | null>(null);
  const wanted = me.data ? toLocale(me.data.locale) : undefined;
  useEffect(() => {
    if (!wanted || wanted === locale || tried.current === wanted) return;
    tried.current = wanted;
    writeLocaleCookie(wanted);
    router.refresh();
  }, [wanted, locale, router]);
  return null;
}

/** Auswahl Deutsch / English, unten in der Seitenleiste */
export function LocaleSwitcher() {
  const t = useTranslations('language');
  const errorText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function change(next: Locale) {
    setBusy(true);
    setError(undefined);
    try {
      // Angemeldet: im Profil speichern, sonst nur in diesem Browser
      if (me.data) await api('/me', { method: 'PATCH', body: { locale: next } });
      writeLocaleCookie(next);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nf-locale">
      <label htmlFor="nf-locale" className="nf-visually-hidden">
        {t('label')}
      </label>
      <select
        id="nf-locale"
        value={locale}
        disabled={busy}
        onChange={(e) => isLocale(e.target.value) && change(e.target.value)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {t(l)}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="nf-alert">
          {error}
        </p>
      )}
    </div>
  );
}
