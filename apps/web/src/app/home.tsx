'use client';

// Startseite: anmelden, danach die eigenen Spaces und „Neuer Space“.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { spacePath } from '@notefieber/shared';
import { api, useMe, useSpaces, type Space } from '@/lib/api';
import { LoginForm, SignedIn } from './account';

export function Home() {
  const me = useMe();
  const spaces = useSpaces(!!me.data);

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
      <NewSpace />
    </>
  );
}

function NewSpace() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api<Space>('/spaces', { method: 'POST', body: { key, name } }),
    onSuccess: async (s) => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      router.push(spacePath(s.key));
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
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
      <button type="submit" className="nf-button" disabled={create.isPending}>
        Anlegen
      </button>
    </form>
  );
}
