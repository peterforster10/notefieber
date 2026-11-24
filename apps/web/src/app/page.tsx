import { AppShell, Main, SidebarTop, Topbar } from '@/components/app-shell';
import { SidebarFoot } from '@/components/sidebar-foot';
import { Home } from './home';

// Startseite: Anmelden über die API (Zitadel), danach die eigenen Spaces.
export default function Page() {
  return (
    <AppShell
      sidebar={
        <>
          <SidebarTop />
          <SidebarFoot />
        </>
      }
    >
      <Topbar />
      <Main>
        <h1>NoteFieber</h1>
        <Home />
      </Main>
    </AppShell>
  );
}
