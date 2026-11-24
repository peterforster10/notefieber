// Fehler als Text für die Oberfläche, in der Sprache der Person (E15). Die API liefert
// { error, code?, message? }; übersetzt werden code (genaue Regel) und error (Art), nie message.
// Neue Codes der API kommen unter errors in apps/web/messages/de.json und en.json.
'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { ApiError } from './api';

type ErrorKey = Parameters<ReturnType<typeof useTranslations<'errors'>>>[0];

/** Text nach HTTP-Status, wenn weder code noch error bekannt sind */
function byStatus(status: number): ErrorKey | undefined {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 413) return 'too_large';
  if (status >= 500) return 'unavailable';
  return undefined;
}

/** (Fehler) → Text; für alles, was die Oberfläche bei fehlgeschlagenen Anfragen zeigt */
export function useErrorText() {
  const t = useTranslations('errors');
  return useCallback(
    (err: unknown): string => {
      if (!(err instanceof ApiError)) return t('internal');
      for (const key of [err.code, err.kind]) {
        if (key && t.has(key as ErrorKey)) return t(key as ErrorKey);
      }
      const key = byStatus(err.status);
      return key ? t(key) : t('status', { status: err.status });
    },
    [t],
  );
}
