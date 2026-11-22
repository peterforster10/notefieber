'use client';

// Ansicht eines Spaces: Seitenleiste mit Space-Umschalter, Seitenbaum und Papierkorb, rechts
// die ausgewählte Seite (ohne Auswahl die Startseite) mit dem Editor (page-editor.tsx) oder
// die Einstellungen des Spaces (space-settings.tsx, /spaces/<schlüssel>/settings).
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pageIdFromSlug, pagePath, spacePath, spaceSettingsPath } from '@notefieber/shared';
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
  type Space,
} from '@/lib/api';
import { PageTree } from './page-tree';
import { SpaceSettings } from './space-settings';

// Editor nur im Browser: BlockNote und Yjs brauchen das DOM und eine WebSocket-Verbindung
const PageEditor = dynamic(() => import('./page-editor').then((m) => m.PageEditor), {
  ssr: false,
  loading: () => <p className="nf-muted">Editor wird geladen …</p>,
});

const ROLE_NAMES: Record<string, string> = {
  viewer: 'Lesen',
  commenter: 'Kommentieren',
  editor: 'Bearbeiten',
  admin: 'Admin',
};

export function SpaceView({ view = 'page' }: { view?: 'page' | 'settings' }) {
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
  return <SignedInSpace spaceKey={key} pageId={pageId} view={view} />;
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

function SignedInSpace({ spaceKey, pageId, view }: { spaceKey: string; pageId?: string; view: 'page' | 'settings' }) {
  const space = useSpace(spaceKey);
  const canonical = space.data && (view === 'settings' ? spaceSettingsPath(space.data.key) : spacePath(space.data.key));
  useCanonicalPath(!pageId ? canonical : undefined);

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
  if (!space.data) return <Shell>Einen Moment …</Shell>;
  const selected = view === 'settings' ? undefined : (pageId ?? space.data.homePageId ?? undefined);

  return (
    <main className="nf-shell">
      <aside className="nf-sidebar">
        <SpaceSwitcher current={space.data} />
        <PageTree key={space.data.id} space={space.data} selectedId={selected} />
        <Trash space={space.data} />
        <div className="nf-sidebar-foot">
          <button type="button" className="nf-link-button nf-on-dark" onClick={logout}>
            Abmelden
          </button>
          <p className="nf-eu">Daten gehostet in der EU</p>
        </div>
      </aside>
      <section className="nf-main">
        {view === 'settings' ? (
          <SpaceSettings key={space.data.id} space={space.data} />
        ) : selected ? (
          <PageView id={selected} canonicalize={!!pageId} />
        ) : (
          <p>Dieser Space hat keine Startseite.</p>
        )}
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
      {(current.canManage || current.role === 'admin') && (
        <div className="nf-switcher-links">
          <Link href={spaceSettingsPath(current.key)}>Einstellungen</Link>
        </div>
      )}
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

/**
 * Nach einer Titeländerung im Editor Seitenbaum, Brotkrume und Adresse nachziehen (E04-08: spätestens
 * nach 10 s). Den Titel in pages.title schreibt der Collab-Server entprellt (ca. 2 s, spätestens 10 s);
 * deshalb zweimal nachfragen, kurz danach und nach der längsten Wartezeit.
 */
function useRefreshAfterTitleChange(spaceKey: string | undefined) {
  const queryClient = useQueryClient();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return useCallback(() => {
    if (!spaceKey) return;
    timers.current.forEach(clearTimeout);
    const refresh = () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tree(spaceKey) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
      ]);
    timers.current = [setTimeout(refresh, 3_000), setTimeout(refresh, 11_000)];
  }, [queryClient, spaceKey]);
}

/**
 * Nach einer neuen Anmeldung am Collab-Server (Rechte geändert, Papierkorb, Wiederherstellen) Seite,
 * Baum und Papierkorb neu laden, damit Rolle, Hinweis und Seitenleiste wieder stimmen.
 */
function useRefreshAccess(spaceKey: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!spaceKey) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tree(spaceKey) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trash(spaceKey) }),
    ]);
  }, [queryClient, spaceKey]);
}

function PageView({ id, canonicalize }: { id: string; canonicalize: boolean }) {
  const page = usePage(id);
  const me = useMe();
  useCanonicalPath(page.data && canonicalize ? pagePath(page.data.spaceKey, page.data) : undefined);
  const onTitleChange = useRefreshAfterTitleChange(page.data?.spaceKey);
  const refreshAccess = useRefreshAccess(page.data?.spaceKey);
  // Aus dem Papierkorb holen; danach meldet der Collab-Server die Verbindung schreibend neu an
  const restore = useCallback(async () => {
    await api(`/pages/${id}/restore`, { method: 'POST' });
    await refreshAccess();
  }, [id, refreshAccess]);
  if (page.isPending) return <p>Einen Moment …</p>;
  // Schlägt erst das Neuladen fehl (Recht entzogen, während die Seite offen war), bleiben die alten
  // Daten stehen: Dann sagt der Editor „Kein Zugriff mehr“ und zeigt keinen Inhalt (E04-05)
  if (page.isError && !page.data) {
    return <p role="alert">Diese Seite gibt es nicht, oder sie ist für dich nicht sichtbar.</p>;
  }
  const p = page.data;
  const lock = p.restricted ? <span title="Eigene Rechte">🔒</span> : null;
  return (
    <article>
      <nav aria-label="Brotkrume" className="nf-breadcrumb">
        {p.breadcrumb.map((c) => (
          <span key={c.id}>
            <Link href={pagePath(p.spaceKey, c)}>{c.title}</Link> /{' '}
          </span>
        ))}
      </nav>
      <p className="nf-muted">
        Deine Rolle: {p.role ? ROLE_NAMES[p.role] : '–'}
        {p.trashed ? ' · im Papierkorb' : ''}
      </p>
      {me.data ? (
        <PageEditor
          key={p.id}
          pageId={p.id}
          user={{ id: me.data.id, name: me.data.displayName }}
          mayEdit={canEdit(p.role)}
          trashed={p.trashed}
          fallbackTitle={p.title}
          onTitleChange={onTitleChange}
          titleAddon={lock}
          onAccessChange={refreshAccess}
          onRestore={restore}
        />
      ) : (
        <h1>
          {p.title || 'Ohne Titel'} {lock}
        </h1>
      )}
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
