import { getTranslations } from 'next-intl/server';
import { AppShell, Main, SidebarTop, Topbar } from '@/components/app-shell';
import { InviteLanding } from '@/components/invites';
import { SidebarFoot } from '@/components/sidebar-foot';

// Ziel des Einladungslinks: /invite/<token>
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('invites');
  return (
    <AppShell
      sidebar={
        <>
          <SidebarTop brand="NoteFieber" />
          <SidebarFoot />
        </>
      }
    >
      <Topbar />
      <Main>
        <h1>{t('landingTitle')}</h1>
        <InviteLanding token={token} />
      </Main>
    </AppShell>
  );
}
