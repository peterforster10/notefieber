import { SPACE_ROLES } from '@notefieber/shared';

// Grundgerüst: zeigt, dass die Oberfläche läuft und das gemeinsame Paket einbindet.
// Seitenbaum, Editor und Login folgen (ROADMAP M0 bis M2).
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Home() {
  return (
    <main style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 260, background: 'var(--nf-sidebar)', color: '#fff', padding: 24 }}>
        <strong>NoteFieber</strong>
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 'auto' }}>Daten gehostet in der EU</p>
      </aside>
      <section style={{ padding: 48, maxWidth: 720 }}>
        <h1>Grundgerüst läuft</h1>
        <p>
          Rollen aus <code>@notefieber/shared</code>: {SPACE_ROLES.join(', ')}
        </p>
        <p>
          API: <a href={`${apiUrl}/api/v1/health`}>{apiUrl}/api/v1/health</a>
        </p>
      </section>
    </main>
  );
}
