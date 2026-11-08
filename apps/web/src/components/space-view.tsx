'use client';

// Ansicht eines Spaces: Seitenleiste mit Space-Umschalter, Seitenbaum und Papierkorb, rechts
// die ausgewählte Seite (ohne Auswahl die Startseite). Der Editor folgt mit M1.
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pageIdFromSlug, pagePath, spacePath } from '@notefieber/shared';
import { LoginForm, logout } from '@/app/account';
import {
  ApiError,
  api,
  canEdit,
  queryKeys,
  useMe,
  usePage,
  useSpace,
  useSpaces,
  useTrash,
  useTree,
  type Space,
} from '@/lib/api';
import { PageTree } from './page-tree';

const ROLE_NAMES: Record<string, string> = {
  viewer: 'Lesen',
  commenter: 'Kommentieren',
  editor: 'Bearbeiten',
  admin: 'Admin',
};

export function SpaceView() {
  const params = useParams<{ key: string; slug?: string }>();
  const pathname = usePathname();
  const key = decodeURIComponent(params.key);
  const me = useMe();

  if (me.isPending) return <Shell>Einen Moment …</Shell>;
  if (me.isError) return <Shell>Die API ist nicht erreichbar.</Shell>;
  if (!me.data)
    return (
      <Shell>
        <h1>Anmelden</h1>
        <LoginForm returnTo={pathname} />
      </Shell>
    );
  // Adresse /spaces/entw/pages/<titel>-<kurze id>: zählt nur die ID (siehe packages/shared/src/urls.ts)
  const pageId = params.slug ? (pageIdFromSlug(decodeURIComponent(params.slug)) ?? 'ungueltig') : undefined;
  return <SignedInSpace spaceKey={key} pageId={pageId} />;
}

/**
 * Auf die gültige Adresse umleiten, ohne neuen Eintrag im Verlauf: Space-Schlüssel klein,
 * Seitentitel aktuell (alte Links mit altem Titel funktionieren, die Adresse wird nachgezogen).
 */
function useCanonicalPath(path: string | undefined) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (path && pathname !== path) router.replace(path);
  }, [path, pathname, router]);
}

function SignedInSpace({ spaceKey, pageId }: { spaceKey: string; pageId?: string }) {
  const space = useSpace(spaceKey);
  const tree = useTree(spaceKey);
  useCanonicalPath(space.data && !pageId ? spacePath(space.data.key) : undefined);

  if (space.isError) {
    const notFound = space.error instanceof ApiError && [400, 404].includes(space.error.status);
    return (
      <Shell>
        <p role="alert">
          {notFound ? 'Diesen Space gibt es nicht, oder er ist für dich nicht sichtbar.' : space.error.message}
        </p>
        <Link href="/">Zur Startseite</Link>
      </Shell>
    );
  }
  if (!space.data || !tree.data) return <Shell>Einen Moment …</Shell>;
  const selected = pageId ?? space.data.homePageId ?? undefined;

  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <SpaceSwitcher current={space.data} />
        <PageTree key={space.data.id} space={space.data} pages={tree.data} selectedId={selected} />
        <Trash space={space.data} />
        <div className="nf-sidebar-foot">
          <button type="button" className="nf-link-button nf-on-dark" onClick={logout}>
            Abmelden
          </button>
          <p className="nf-eu">Daten gehostet in der EU</p>
        </div>
      </aside>
      <section className="nf-main">
        {selected ? <PageView id={selected} canonicalize={!!pageId} /> : <p>Dieser Space hat keine Startseite.</p>}
      </section>
    </main>
  );
}

function SpaceSwitcher({ current }: { current: Space }) {
  const router = useRouter();
  const spaces = useSpaces();
  return (
    <div className="nf-switcher">
      <Link href="/" className="nf-brand">
        NoteFieber
      </Link>
      <label htmlFor="space-switcher" className="nf-visually-hidden">
        Space wechseln
      </label>
      <select id="space-switcher" value={current.key} onChange={(e) => router.push(spacePath(e.target.value))}>
        {(spaces.data ?? [current]).map((s) => (
          <option key={s.id} value={s.key}>
            {s.name}
          </option>
        ))}
      </select>
      {current.archived && <p className="nf-muted-dark">Archiviert, nur lesbar</p>}
    </div>
  );
}

function Trash({ space }: { space: Space }) {
  const trash = useTrash(space.key);
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: (id: string) => api(`/pages/${id}/restore`, { method: 'POST' }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tree(space.key) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.trash(space.key) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
      ]),
  });
  const items = trash.data ?? [];
  return (
    <details className="nf-trash">
      <summary>Papierkorb ({items.length})</summary>
      {restore.isError && (
        <p role="alert" className="nf-alert nf-alert-dark">
          {restore.error.message}
        </p>
      )}
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <span>{p.title}</span>
            {canEdit(space.role) && (
              <button type="button" className="nf-link-button nf-on-dark" onClick={() => restore.mutate(p.id)}>
                Wiederherstellen
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function PageView({ id, canonicalize }: { id: string; canonicalize: boolean }) {
  const page = usePage(id);
  useCanonicalPath(page.data && canonicalize ? pagePath(page.data.spaceKey, page.data) : undefined);
  if (page.isPending) return <p>Einen Moment …</p>;
  if (page.isError) return <p role="alert">Diese Seite gibt es nicht, oder sie ist für dich nicht sichtbar.</p>;
  const p = page.data;
  return (
    <article>
      <nav aria-label="Brotkrume" className="nf-breadcrumb">
        {p.breadcrumb.map((c) => (
          <span key={c.id}>
            <Link href={pagePath(p.spaceKey, c)}>{c.title}</Link> /{' '}
          </span>
        ))}
      </nav>
      <h1>
        {p.title || 'Ohne Titel'} {p.restricted && <span title="Eigene Rechte">🔒</span>}
      </h1>
      <p className="nf-muted">
        Deine Rolle: {p.role ? ROLE_NAMES[p.role] : '–'}
        {p.trashed ? ' · im Papierkorb' : ''}
      </p>
      <p className="nf-placeholder">Der Editor kommt mit Meilenstein M1 (BlockNote und gemeinsames Bearbeiten).</p>
    </article>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <Link href="/" className="nf-brand">
          NoteFieber
        </Link>
        <p className="nf-eu">Daten gehostet in der EU</p>
      </aside>
      <section className="nf-main">{children}</section>
    </main>
  );
}
