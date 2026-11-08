import { Home } from './home';

// Startseite: Anmelden über die API (Zitadel), danach die eigenen Spaces.
export default function Page() {
  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <strong className="nf-brand">NoteFieber</strong>
        <p className="nf-eu">Daten gehostet in der EU</p>
      </aside>
      <section className="nf-main">
        <h1>NoteFieber</h1>
        <Home />
      </section>
    </main>
  );
}
