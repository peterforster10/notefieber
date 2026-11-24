'use client';

// Unten in der Seitenleiste: optional Abmelden, die Sprache und „Daten gehostet in der EU“
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { LocaleSwitcher } from '@/app/locale';

export function SidebarFoot({ children }: { children?: ReactNode }) {
  const t = useTranslations('common');
  return (
    <div className="nf-sidebar-foot">
      {children}
      <LocaleSwitcher />
      <p className="nf-eu">{t('euHosted')}</p>
    </div>
  );
}
