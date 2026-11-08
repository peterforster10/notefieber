'use client';

// Einladungen: Admins eines Workspaces laden per Link ein (E-Mails verschickt die App noch
// nicht), die eingeladene Person öffnet den Link und meldet sich an. Angenommen wird beim
// Login (API: auth/accounts.ts). Das Konto beim Login-Dienst muss es schon geben.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Mitglied',
  guest: 'Gast',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'offen',
  accepted: 'angenommen',
  revoked: 'zurückgenommen',
  expired: 'abgelaufen',
};

interface Invite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  status: 'open' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string | null;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: string;
}

/** Bereich für Admins eines Workspaces: einladen, offene Einladungen, zurücknehmen */
export function WorkspaceInvites({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const key = ['invites', workspace.id];
  const invites = useQuery({ queryKey: key, queryFn: () => api<Invite[]>(`/workspaces/${workspace.id}/invites`) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api<{ link: string }>(`/workspaces/${workspace.id}/invites`, { method: 'POST', body: { email, role } }),
    onSuccess: async (r) => {
      setLink({ email, link: r.link });
      setCopied(false);
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link.link);
    setCopied(true);
  }

  return (
    <section className="nf-form" aria-labelledby={`invites-${workspace.id}`}>
      <h3 id={`invites-${workspace.id}`}>Einladungen in „{workspace.name}“</h3>
      <form onSubmit={submit} className="nf-inline-form">
        <label className="nf-visually-hidden" htmlFor={`invite-email-${workspace.id}`}>
          E-Mail-Adresse
        </label>
        <input
          id={`invite-email-${workspace.id}`}
          type="email"
          required
          placeholder="E-Mail-Adresse"
          className="nf-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="nf-visually-hidden" htmlFor={`invite-role-${workspace.id}`}>
          Rolle
        </label>
        <select
          id={`invite-role-${workspace.id}`}
          className="nf-input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="member">Mitglied</option>
          <option value="admin">Admin</option>
          <option value="guest">Gast</option>
        </select>
        <button type="submit" className="nf-button" disabled={create.isPending}>
          Einladen
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="nf-alert">
          {create.error.message}
        </p>
      )}
      {link && (
        <div className="nf-invite-link" role="status">
          <p>
            Link für <strong>{link.email}</strong>, sieben Tage gültig. Er wird nur jetzt angezeigt; bitte selbst
            weitergeben (E-Mails verschickt NoteFieber noch nicht).
          </p>
          <code>{link.link}</code>{' '}
          <button type="button" className="nf-link-button" onClick={copy}>
            {copied ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      )}
      {invites.data && invites.data.length > 0 && (
        <table className="nf-table">
          <thead>
            <tr>
              <th>E-Mail</th>
              <th>Rolle</th>
              <th>Status</th>
              <th>Gültig bis</th>
              <th>
                <span className="nf-visually-hidden">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.data.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{ROLE_LABELS[i.role] ?? i.role}</td>
                <td>{STATUS_LABELS[i.status]}</td>
                <td>{new Date(i.expiresAt).toLocaleDateString('de')}</td>
                <td>
                  {i.status === 'open' && (
                    <button
                      type="button"
                      className="nf-link-button"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(i.id)}
                    >
                      Zurücknehmen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface InviteDetails {
  tenantName: string;
  workspaceName: string;
  email: string;
  role: string;
  invitedBy: string | null;
}

/** Seite hinter dem Einladungslink: worum es geht, dann anmelden und annehmen */
export function InviteLanding({ token }: { token: string }) {
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InviteDetails>(`/invites/${token}`),
    retry: false,
  });
  if (invite.isPending) return <p>Einen Moment …</p>;
  if (invite.isError) {
    const gone = invite.error instanceof ApiError && invite.error.status === 404;
    return (
      <p role="alert">
        {gone
          ? 'Diese Einladung ist ungültig, abgelaufen oder wurde schon benutzt. Bitte um einen neuen Link.'
          : invite.error.message}
      </p>
    );
  }
  const i = invite.data;
  const params = new URLSearchParams({ invite: token, returnTo: '/' });
  return (
    <>
      <p>
        {i.invitedBy ?? 'Jemand'} lädt dich in den Workspace <strong>{i.workspaceName}</strong> von {i.tenantName} ein,
        als {ROLE_LABELS[i.role] ?? i.role}.
      </p>
      <p className="nf-muted">
        Die Einladung gilt für <strong>{i.email}</strong>. Melde dich mit dem Konto für genau diese Adresse an.
      </p>
      {/* Der Browser navigiert zur API, die zum Login-Dienst weiterleitet und beim Rücksprung annimmt */}
      <a className="nf-button nf-button-link" href={`/api/v1/auth/login?${params}`}>
        Annehmen und anmelden
      </a>
    </>
  );
}
