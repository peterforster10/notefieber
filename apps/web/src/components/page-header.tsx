'use client';

// Kopfbereich einer Seite (E15, CLAUDE.md Abschnitt 9): links die Brotkrume, rechts wer gerade auf
// der Seite ist und die Knöpfe „Versionen“, „Exportieren“ und „Teilen und Rechte“. Die Funktionen
// dahinter kommen noch (Versionen E08, Rechte-Dialog M3, Export E14); bis dahin öffnen die Knöpfe
// einen Dialog, der sagt, was dort entsteht, und bei den Rechten schon zeigt, woher sie kommen.
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { pagePath } from '@notefieber/shared';
import type { PageDetails } from '@/lib/api';
import { Topbar } from './app-shell';
import { Dialog } from './dialog';
import { ClockIcon, ExportIcon, InfoIcon, LockIcon, PeopleIcon } from './icons';
import { PresenceAvatars, type PersonState } from './presence';

export type PageDialog = 'rights' | 'versions' | 'export';

export function PageHeader({
  page,
  people,
  selfId,
  onOpen,
}: {
  page: PageDetails;
  people: PersonState[];
  selfId: string;
  onOpen: (dialog: PageDialog) => void;
}) {
  const t = useTranslations('pageHeader');
  return (
    <Topbar
      start={<Breadcrumb page={page} />}
      end={
        <>
          <PresenceAvatars people={people} selfId={selfId} />
          <button
            type="button"
            className="nf-btn"
            aria-haspopup="dialog"
            title={t('versions')}
            onClick={() => onOpen('versions')}
          >
            <ClockIcon />
            <span className="nf-btn-label nf-btn-label-secondary">{t('versions')}</span>
          </button>
          <button
            type="button"
            className="nf-btn"
            aria-haspopup="dialog"
            title={t('export')}
            onClick={() => onOpen('export')}
          >
            <ExportIcon />
            <span className="nf-btn-label nf-btn-label-secondary">{t('export')}</span>
          </button>
          <button
            type="button"
            className="nf-btn nf-btn-primary"
            aria-haspopup="dialog"
            onClick={() => onOpen('rights')}
          >
            <PeopleIcon />
            <span className="nf-btn-label">{t('share')}</span>
          </button>
        </>
      }
    />
  );
}

/** Brotkrume: Vorfahren, die die Person lesen darf (aus der API), dann die Seite selbst */
export function Breadcrumb({ page }: { page: Pick<PageDetails, 'spaceKey' | 'title' | 'breadcrumb'> }) {
  const t = useTranslations('space');
  const common = useTranslations('common');
  return (
    <nav aria-label={t('breadcrumb')} className="nf-breadcrumb">
      <ol>
        {page.breadcrumb.map((c) => (
          <li key={c.id}>
            <Link href={pagePath(page.spaceKey, c)}>{c.title || common('untitled')}</Link>
            <span className="nf-crumb-sep" aria-hidden>
              /
            </span>
          </li>
        ))}
        <li>
          <span aria-current="page">{page.title || common('untitled')}</span>
        </li>
      </ol>
    </nav>
  );
}

/** Die Dialoge hinter den Knöpfen, vorerst als Vorschau auf das, was kommt */
export function PageDialogs({
  page,
  spaceName,
  open,
  onClose,
}: {
  page: PageDetails;
  spaceName: string;
  open: PageDialog | null;
  onClose: () => void;
}) {
  const t = useTranslations('pageHeader');
  const common = useTranslations('common');
  const roles = useTranslations('roles');
  const title = page.title || common('untitled');
  return (
    <>
      <Dialog
        open={open === 'rights'}
        onClose={onClose}
        title={t('rightsTitle', { title })}
        description={t('rightsDescription')}
      >
        <div className="nf-dialog-band">
          <strong>
            {page.restricted && <LockIcon size={14} />} {page.restricted ? t('rightsOwn') : t('rightsInheritedTitle')}
          </strong>
          <span>{page.restricted ? t('rightsOwnText') : t('rightsInherited', { space: spaceName })}</span>
        </div>
        <div className="nf-dialog-body">
          <p>{t('yourRole', { role: page.role ? roles(page.role) : '–' })}</p>
          <Soon text={t('rightsSoon')} />
        </div>
      </Dialog>
      <Dialog open={open === 'versions'} onClose={onClose} title={t('versionsTitle', { title })}>
        <div className="nf-dialog-body">
          <Soon text={t('versionsSoon')} />
        </div>
      </Dialog>
      <Dialog open={open === 'export'} onClose={onClose} title={t('exportTitle', { title })}>
        <div className="nf-dialog-body">
          <Soon text={t('exportSoon')} />
        </div>
      </Dialog>
    </>
  );
}

function Soon({ text }: { text: string }) {
  return (
    <div className="nf-dialog-soon">
      <InfoIcon size={18} />
      <p>{text}</p>
    </div>
  );
}
