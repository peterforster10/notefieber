'use client';

// Einladungen: Admins eines Workspaces laden per Link ein (E-Mails verschickt die App noch
// nicht), die eingeladene Person öffnet den Link und meldet sich an. Angenommen wird beim
// Login (API: auth/accounts.ts). Das Konto beim Login-Dienst muss es schon geben.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { useErrorText } from '@/lib/errors';

const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
const isWorkspaceRole = (role: string): role is WorkspaceRole => (WORKSPACE_ROLES as readonly string[]).includes(role);

/** Name einer Rolle im Workspace; unbekannte Rollen (neuer Server, alter Browser) wie geliefert */
function useWorkspaceRoleName() {
  const t = useTranslations('workspaceRoles');
  return (role: string) => (isWorkspaceRole(role) ? t(role) : role);
}

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
  const t = useTranslations('invites');
  const roleName = useWorkspaceRoleName();
  const errorText = useErrorText();
  const format = useFormatter();
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
      <h3 id={`invites-${workspace.id}`}>{t('title', { workspace: workspace.name })}</h3>
      <form onSubmit={submit} className="nf-inline-form">
        <label className="nf-visually-hidden" htmlFor={`invite-email-${workspace.id}`}>
          {t('email')}
        </label>
        <input
          id={`invite-email-${workspace.id}`}
          type="email"
          required
          placeholder={t('email')}
          className="nf-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="nf-visually-hidden" htmlFor={`invite-role-${workspace.id}`}>
          {t('role')}
        </label>
        <select
          id={`invite-role-${workspace.id}`}
          className="nf-input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {(['member', 'admin', 'guest'] as const).map((r) => (
            <option key={r} value={r}>
              {roleName(r)}
            </option>
          ))}
        </select>
        <button type="submit" className="nf-button" disabled={create.isPending}>
          {t('invite')}
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="nf-alert">
          {errorText(create.error)}
        </p>
      )}
      {link && (
        <div className="nf-invite-link" role="status">
          <p>{t.rich('linkFor', { strong: (chunks) => <strong>{chunks}</strong>, email: link.email })}</p>
          <code>{link.link}</code>{' '}
          <button type="button" className="nf-link-button" onClick={copy}>
            {copied ? t('copied') : t('copy')}
          </button>
        </div>
      )}
      {invites.data && invites.data.length > 0 && (
        <table className="nf-table">
          <thead>
            <tr>
              <th>{t('columnEmail')}</th>
              <th>{t('columnRole')}</th>
              <th>{t('columnStatus')}</th>
              <th>{t('columnValidUntil')}</th>
              <th>
                <span className="nf-visually-hidden">{t('columnAction')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.data.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{roleName(i.role)}</td>
                <td>{t(`status.${i.status}`)}</td>
                <td>{format.dateTime(new Date(i.expiresAt), { dateStyle: 'medium' })}</td>
                <td>
                  {i.status === 'open' && (
                    <button
                      type="button"
                      className="nf-link-button"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(i.id)}
                    >
                      {t('revoke')}
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
  const t = useTranslations('invites');
  const common = useTranslations('common');
  const roleName = useWorkspaceRoleName();
  const errorText = useErrorText();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InviteDetails>(`/invites/${token}`),
    retry: false,
  });
  if (invite.isPending) return <p>{common('loading')}</p>;
  if (invite.isError) {
    const gone = invite.error instanceof ApiError && invite.error.status === 404;
    return <p role="alert">{gone ? t('landingInvalid') : errorText(invite.error)}</p>;
  }
  const i = invite.data;
  const params = new URLSearchParams({ invite: token, returnTo: '/' });
  return (
    <>
      <p>
        {t.rich('landingText', {
          strong: (chunks) => <strong>{chunks}</strong>,
          inviter: i.invitedBy ?? t('someone'),
          workspace: i.workspaceName,
          tenant: i.tenantName,
          role: roleName(i.role),
        })}
      </p>
      <p className="nf-muted">
        {t.rich('landingEmail', { strong: (chunks) => <strong>{chunks}</strong>, email: i.email })}
      </p>
      {/* Der Browser navigiert zur API, die zum Login-Dienst weiterleitet und beim Rücksprung annimmt */}
      <a className="nf-button nf-button-link" href={`/api/v1/auth/login?${params}`}>
        {t('accept')}
      </a>
    </>
  );
}
