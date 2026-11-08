import { InviteLanding } from '@/components/invites';

// Ziel des Einladungslinks: /invite/<token>
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <strong className="nf-brand">NoteFieber</strong>
        <p className="nf-eu">Daten gehostet in der EU</p>
      </aside>
      <section className="nf-main">
        <h1>Einladung</h1>
        <InviteLanding token={token} />
      </section>
    </main>
  );
}
