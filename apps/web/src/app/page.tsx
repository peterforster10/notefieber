import { SidebarFoot } from '@/components/sidebar-foot';
import { Home } from './home';

// Startseite: Anmelden über die API (Zitadel), danach die eigenen Spaces.
export default function Page() {
  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <strong className="nf-brand">NoteFieber</strong>
        <SidebarFoot />
      </aside>
      <section className="nf-main">
        <h1>NoteFieber</h1>
        <Home />
      </section>
    </main>
  );
}
