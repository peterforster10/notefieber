import { getTranslations } from 'next-intl/server';
import { InviteLanding } from '@/components/invites';
import { SidebarFoot } from '@/components/sidebar-foot';

// Ziel des Einladungslinks: /invite/<token>
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('invites');
  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <strong className="nf-brand">NoteFieber</strong>
        <SidebarFoot />
      </aside>
      <section className="nf-main">
        <h1>{t('landingTitle')}</h1>
        <InviteLanding token={token} />
      </section>
    </main>
  );
}
