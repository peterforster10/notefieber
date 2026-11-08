import { Account } from './account';

// Startseite des Grundgerüsts: Anmelden über die API (Zitadel) und die angemeldete Person.
// Seitenbaum und Editor folgen (ROADMAP M0 bis M2).
const defaultTenant = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? '';

export default function Home() {
  return (
    <main style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 260,
          background: 'var(--nf-sidebar)',
          color: '#fff',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <strong>NoteFieber</strong>
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 'auto' }}>Daten gehostet in der EU</p>
      </aside>
      <section style={{ padding: 48, maxWidth: 720 }}>
        <h1>NoteFieber</h1>
        <Account defaultTenant={defaultTenant} />
      </section>
    </main>
  );
}
