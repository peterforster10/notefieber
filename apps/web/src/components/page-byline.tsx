'use client';

// Zeile unter dem Seitentitel (E15, wie die Byline in Confluence): Kürzel und Name der Person, die die
// Seite angelegt hat, wann und von wem sie zuletzt bearbeitet wurde, dazu die eigene Rolle. Namen nur,
// wenn die Leseregel auf users die Person zeigt (Gäste sehen nur sich selbst); sonst fehlen sie, der
// Zeitpunkt bleibt. Wer gerade auf der Seite ist, zeigt der Kopfbereich (page-header.tsx).
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { PageDetails } from '@/lib/api';
import { colorFor } from '@/lib/person-color';
import { initials } from './presence';

/** Bis eine Woche relativ („vor 5 Minuten“), danach mit Datum („am 28. Oktober“) */
const RELATIVE_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export function PageByline({ page }: { page: PageDetails }) {
  const t = useTranslations('byline');
  const space = useTranslations('space');
  const roles = useTranslations('roles');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const updated = new Date(page.updatedAt);
  const when =
    now.getTime() - updated.getTime() < RELATIVE_FOR_MS
      ? format.relativeTime(updated, now)
      : t('onDate', {
          date: format.dateTime(updated, {
            day: 'numeric',
            month: 'long',
            ...(updated.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
          }),
        });
  const editedAt = format.dateTime(updated, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <p className="nf-page-meta">
      {page.author && (
        <span className="nf-byline-author">
          <span className="nf-byline-avatar" style={{ background: colorFor(page.author.id) }} aria-hidden>
            {initials(page.author.name)}
          </span>
          {t('by', { name: page.author.name })}
        </span>
      )}
      <time dateTime={page.updatedAt} title={editedAt}>
        {page.updatedBy ? t('lastEditedBy', { name: page.updatedBy.name, when }) : t('lastEdited', { when })}
      </time>
      <span>
        {space('yourRole', { role: page.role ? roles(page.role) : '–' })}
        {page.trashed ? space('inTrash') : ''}
      </span>
    </p>
  );
}
