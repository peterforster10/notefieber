'use client';

// Unten in der Seitenleiste: optional Papierkorb und Abmelden, dann die Sprache und „Daten gehostet
// in der EU“
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/app/locale';
import { ShieldIcon } from './icons';

export function SidebarFoot({ children }: { children?: ReactNode }) {
  const t = useTranslations('common');
  return (
    <div className="nf-sidebar-foot">
      {children}
      <LocaleSwitcher />
      <p className="nf-eu">
        <ShieldIcon size={14} />
        {t('euHosted')}
      </p>
    </div>
  );
}
