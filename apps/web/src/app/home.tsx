'use client';

// Startseite: anmelden, danach die eigenen Spaces und „Neuer Space“.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { spacePath } from '@notefieber/shared';
import { useQuery } from '@tanstack/react-query';
import { api, useMe, useSpaces, type Space } from '@/lib/api';
import { WorkspaceInvites, type Workspace } from '@/components/invites';
import { LoginForm, SignedIn } from './account';

export function Home() {
  const me = useMe();
  const spaces = useSpaces(!!me.data);
  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<Workspace[]>('/workspaces'),
    enabled: !!me.data,
  });

  if (me.isPending) return <p>Einen Moment …</p>;
  if (me.isError) return <p role="alert">Die API ist nicht erreichbar.</p>;
  if (!me.data) return <LoginForm />;

  return (
    <>
      <SignedIn me={me.data} />
      <h2>Spaces</h2>
      {spaces.isPending && <p>Einen Moment …</p>}
      {spaces.data && spaces.data.length === 0 && <p>Noch keine Spaces.</p>}
      <ul className="nf-space-list">
        {spaces.data?.map((s) => (
          <li key={s.id}>
            <Link href={spacePath(s.key)}>
              <strong>{s.name}</strong> <code>{s.key}</code>
            </Link>
            {s.archived && <span className="nf-muted"> · archiviert</span>}
          </li>
        ))}
      </ul>
      {workspaces.data && <NewSpace workspaces={workspaces.data} />}
      {workspaces.data && <Invites workspaces={workspaces.data} orgAdmin={me.data.orgRole === 'org_admin'} />}
    </>
  );
}

const ACCESS_OPTIONS = [
  { value: 'viewer', label: 'Lesen' },
  { value: 'commenter', label: 'Kommentieren' },
  { value: 'editor', label: 'Bearbeiten' },
  { value: 'none', label: 'Nichts (nur ich als Admin)' },
] as const;

/**
 * Neuer Space: Schlüssel, Name, Workspace (nur wenn es mehrere gibt) und was alle im Workspace
 * (ohne Gäste) dürfen. Spaces anlegen dürfen Mitglieder eines Workspaces, aber keine Gäste
 * (app.create_space); ohne passenden Workspace gibt es das Formular nicht.
 */
function NewSpace({ workspaces }: { workspaces: Workspace[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const allowed = workspaces.filter((w) => w.role !== 'guest');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [access, setAccess] = useState<(typeof ACCESS_OPTIONS)[number]['value']>('viewer');
  const create = useMutation({
    mutationFn: () =>
      api<Space>('/spaces', {
        method: 'POST',
        body: {
          key,
          name,
          workspaceId: workspaceId || allowed[0]?.id,
          workspaceAccess: access === 'none' ? null : access,
        },
      }),
    onSuccess: async (s) => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      router.push(spacePath(s.key));
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  if (allowed.length === 0) return null;
  return (
    <form onSubmit={submit} className="nf-form">
      <h3>Neuer Space</h3>
      {create.isError && (
        <p role="alert" className="nf-alert">
          {create.error.message === 'Schon vorhanden' ? 'Diesen Schlüssel gibt es schon.' : create.error.message}
        </p>
      )}
      <label className="nf-label" htmlFor="space-key">
        Schlüssel (Großbuchstaben, z. B. ENTW)
      </label>
      <input
        id="space-key"
        className="nf-input"
        value={key}
        onChange={(e) => setKey(e.target.value.toUpperCase())}
        pattern="[A-Z][A-Z0-9]{1,31}"
        required
      />
      <label className="nf-label" htmlFor="space-name">
        Name
      </label>
      <input
        id="space-name"
        className="nf-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={200}
      />
      {allowed.length > 1 && (
        <>
          <label className="nf-label" htmlFor="space-workspace">
            Workspace
          </label>
          <select
            id="space-workspace"
            className="nf-input"
            value={workspaceId || allowed[0]!.id}
            onChange={(e) => setWorkspaceId(e.target.value)}
          >
            {allowed.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="nf-label" htmlFor="space-access">
        Alle im Workspace (ohne Gäste) dürfen
      </label>
      <select
        id="space-access"
        className="nf-input"
        value={access}
        onChange={(e) => setAccess(e.target.value as typeof access)}
      >
        {ACCESS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" className="nf-button" disabled={create.isPending}>
        Anlegen
      </button>
    </form>
  );
}

/** Einladungen für jeden Workspace, den die Person verwaltet (Owner, Admin, Organisations-Admin) */
function Invites({ workspaces, orgAdmin }: { workspaces: Workspace[]; orgAdmin: boolean }) {
  const managed = workspaces.filter((w) => orgAdmin || w.role === 'owner' || w.role === 'admin');
  return (
    <>
      {managed.map((w) => (
        <WorkspaceInvites key={w.id} workspace={w} />
      ))}
    </>
  );
}
