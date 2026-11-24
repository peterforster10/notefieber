'use client';

// Ansicht eines Spaces (E15, CLAUDE.md Abschnitt 9): Seitenleiste mit Space-Umschalter, Seitenbaum,
// Papierkorb und Abmelden; rechts der Kopfbereich (page-header.tsx) und die ausgewählte Seite (ohne
// Auswahl die Startseite) mit dem Editor (page-editor.tsx) oder die Einstellungen des Spaces
// (space-settings.tsx, /s/<schlüssel>/settings). Das Gerüst mit Schublade kommt aus app-shell.tsx.
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { invalidatePageLinks } from '@/lib/page-links';
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
  type TreePage,
} from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { AppShell, Main, SidebarTop, Topbar } from './app-shell';
import { LockIcon, RestoreIcon, SettingsIcon, SignOutIcon, TrashIcon, UpDownIcon } from './icons';
import { MenuButton } from './menu';
import { PageByline } from './page-byline';
import { PageDialogs, PageHeader, type PageDialog } from './page-header';
import { PageTree } from './page-tree';
import type { PersonState } from './presence';
import { SidebarFoot } from './sidebar-foot';
import { SpaceSettings } from './space-settings';
import { loadTrashOpen, saveTrashOpen } from '@/lib/sidebar-state';
import { useDocumentTitle } from '@/lib/document-title';

function EditorLoading() {
  const t = useTranslations('space');
  return (
    <p className="nf-muted" role="status">
      {t('editorLoading')}
    </p>
  );
}

// Editor nur im Browser: BlockNote und Yjs brauchen das DOM und eine WebSocket-Verbindung
const PageEditor = dynamic(() => import('./page-editor').then((m) => m.PageEditor), {
  ssr: false,
  loading: () => <EditorLoading />,
});

export function SpaceView({ view = 'page' }: { view?: 'page' | 'settings' }) {
  const params = useParams<{ key: string; slug?: string }>();
  const pathname = usePathname();
  const key = decodeURIComponent(params.key);
  const me = useMe();
  const common = useTranslations('common');
  const account = useTranslations('account');

  if (me.isPending) return <Shell>{common('loading')}</Shell>;
  if (me.isError) return <Shell>{common('apiUnreachable')}</Shell>;
  if (!me.data)
    return (
      <Shell>
        <h1>{account('signIn')}</h1>
        <LoginForm returnTo={pathname} />
      </Shell>
    );
  // Adresse /s/entw/p/<titel>-<kurze id>: zählt nur die ID (siehe packages/shared/src/urls.ts)
  const pageId = params.slug ? (pageIdFromSlug(decodeURIComponent(params.slug)) ?? 'ungueltig') : undefined;
  return (
    <SignedInSpace spaceKey={key} pageId={pageId} view={view} user={{ id: me.data.id, name: me.data.displayName }} />
  );
}

/**
 * Die gültige Adresse in die Adresszeile schreiben, ohne neuen Eintrag im Verlauf: Space-Schlüssel
 * klein, Seitentitel aktuell (alte Links mit altem Titel funktionieren, die Adresse wird nachgezogen).
 * Nur in der Adresszeile (history.replaceState, das Next.js mitbekommt), nicht als Navigation: Ein
 * router.replace auf einen anderen Titel in der Adresse baute die Seite samt Editor neu auf, und wer
 * gerade den Titel schrieb, verlor den Cursor.
 */
function useCanonicalPath(path: string | undefined) {
  const pathname = usePathname();
  useEffect(() => {
    if (path && pathname !== path) window.history.replaceState(null, '', path);
  }, [path, pathname]);
}

function SignedInSpace({
  spaceKey,
  pageId,
  view,
  user,
}: {
  spaceKey: string;
  pageId?: string;
  view: 'page' | 'settings';
  user: { id: string; name: string };
}) {
  const t = useTranslations('space');
  const common = useTranslations('common');
  const account = useTranslations('account');
  const settings = useTranslations('settings');
  const errorText = useErrorText();
  const space = useSpace(spaceKey);
  const canonical = space.data && (view === 'settings' ? spaceSettingsPath(space.data.key) : spacePath(space.data.key));
  useCanonicalPath(!pageId ? canonical : undefined);
  // Tab-Titel: Einstellungen tragen den Namen des Spaces; Seiten setzen ihren Titel selbst (PageView)
  useDocumentTitle(view === 'settings' ? space.data?.name : undefined);

  if (space.isError) {
    const notFound = space.error instanceof ApiError && [400, 404].includes(space.error.status);
    return (
      <Shell>
        <p role="alert">{notFound ? t('notFound') : errorText(space.error)}</p>
        <Link href="/">{common('toHome')}</Link>
      </Shell>
    );
  }
  if (!space.data) return <Shell>{common('loading')}</Shell>;
  const selected = view === 'settings' ? undefined : (pageId ?? space.data.homePageId ?? undefined);

  return (
    <AppShell
      sidebar={
        <>
          <SidebarTop />
          <SpaceSwitcher current={space.data} />
          <PageTree key={space.data.id} space={space.data} selectedId={selected} />
          <SidebarFoot>
            <Trash space={space.data} />
            <button type="button" className="nf-nav-item" onClick={logout}>
              <SignOutIcon />
              {account('signOut')}
            </button>
          </SidebarFoot>
        </>
      }
    >
      {view === 'settings' ? (
        <>
          <Topbar
            start={
              <nav aria-label={t('breadcrumb')} className="nf-breadcrumb">
                <ol>
                  <li>
                    <Link href={spacePath(space.data.key)}>{space.data.name}</Link>
                    <span className="nf-crumb-sep" aria-hidden>
                      /
                    </span>
                  </li>
                  <li>
                    <span aria-current="page">{settings('title')}</span>
                  </li>
                </ol>
              </nav>
            }
          />
          <Main>
            <SpaceSettings key={space.data.id} space={space.data} />
          </Main>
        </>
      ) : selected ? (
        <PageView key={selected} id={selected} canonicalize={!!pageId} spaceName={space.data.name} user={user} />
      ) : (
        <>
          <Topbar />
          <Main>
            <p>{t('noHomePage')}</p>
          </Main>
        </>
      )}
    </AppShell>
  );
}

/**
 * Space-Umschalter: Karte mit Kürzel, Name und Schlüssel; öffnet die Liste aller Spaces. Wer einen
 * Space verwalten darf, findet an seinem Eintrag „⋯“ mit „Einstellungen“ (Untermenü nach rechts).
 */
function SpaceSwitcher({ current }: { current: Space }) {
  const t = useTranslations('space');
  const spaces = useSpaces();
  const list = spaces.data ?? [current];
  return (
    <div className="nf-switcher">
      <MenuButton
        className="nf-space-card"
        items={[
          ...list.map((s) => ({
            key: s.id,
            label: s.archived ? t('archivedSpace', { name: s.name }) : s.name,
            href: spacePath(s.key),
            current: s.id === current.id,
            submenu: mayManage(s)
              ? {
                  label: t('spaceActions', { name: s.name }),
                  items: [
                    { key: 'settings', label: t('settings'), href: spaceSettingsPath(s.key), icon: <SettingsIcon /> },
                  ],
                }
              : undefined,
            icon: (
              <span className="nf-space-badge" aria-hidden>
                {badge(s.key)}
              </span>
            ),
          })),
          { key: 'all', label: t('allSpaces'), href: '/', separatorBefore: true },
        ]}
      >
        <span className="nf-space-badge" aria-hidden>
          {badge(current.key)}
        </span>
        <span className="nf-space-names">
          <span className="nf-visually-hidden">{t('switchSpace')}: </span>
          <span className="nf-space-name">{current.name}</span>
          <span className="nf-space-key">{t('spaceKey', { key: current.key })}</span>
        </span>
        <UpDownIcon />
      </MenuButton>
      {current.archived && <p className="nf-sidebar-note">{t('archivedReadOnly')}</p>}
    </div>
  );
}

/** Einstellungen öffnen dürfen Admins des Spaces und wer ihn archivieren darf (Organisations-Admins) */
const mayManage = (s: Space) => s.canManage || s.role === 'admin';

/** Kürzel im Badge: die ersten zwei Zeichen des Schlüssels (ENTW → EN, wie im Prototyp) */
const badge = (key: string) => key.slice(0, 2);

function Trash({ space }: { space: Space }) {
  const t = useTranslations('space');
  const common = useTranslations('common');
  const errorText = useErrorText();
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
  // Offen oder zu bleibt beim Seitenwechsel (lib/sidebar-state.ts)
  const [open, setOpen] = useState(() => loadTrashOpen(space.id));
  return (
    <details
      className="nf-trash"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        saveTrashOpen(space.id, now);
      }}
    >
      <summary className="nf-nav-item">
        <TrashIcon />
        {t('trash', { count: items.length })}
      </summary>
      {restore.isError && (
        <p role="alert" className="nf-alert">
          {errorText(restore.error)}
        </p>
      )}
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <span>{p.title || common('untitled')}</span>
            {canEdit(space.role) && (
              <button
                type="button"
                className="nf-icon-button"
                aria-label={t('restorePage', { title: p.title || common('untitled') })}
                title={t('restore')}
                disabled={restore.isPending}
                onClick={() => restore.mutate(p.id)}
              >
                <RestoreIcon />
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Titeländerung im Editor, eigene oder von anderen (kommt über Yjs): sofort im Seitenbaum (Zwischenspeicher
 * aller geladenen Ebenen) und über `onLive` in der Brotkrume zeigen, nicht erst, wenn die API ihn kennt.
 * Den Titel in pages.title schreibt der Collab-Server entprellt (ca. 2 s, spätestens 10 s); 3 s und
 * 11 s nach der letzten Änderung gleichen Baum, Seite, Adresse und Seitenlinks deshalb mit der API ab
 * (E04-08). Die Adresse zieht erst dann nach, damit sie nicht bei jedem Tastendruck wechselt.
 */
function useTitleChange(spaceKey: string | undefined, pageId: string, onLive: (title: string) => void) {
  const queryClient = useQueryClient();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return useCallback(
    (title: string) => {
      onLive(title);
      if (!spaceKey) return;
      queryClient.setQueriesData<TreePage[]>({ queryKey: queryKeys.tree(spaceKey) }, (old) =>
        old?.some((p) => p.id === pageId) ? old.map((p) => (p.id === pageId ? { ...p, title } : p)) : old,
      );
      timers.current.forEach(clearTimeout);
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.tree(spaceKey) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
        ]).then(invalidatePageLinks);
      timers.current = [setTimeout(refresh, 3_000), setTimeout(refresh, 11_000)];
    },
    [queryClient, spaceKey, pageId, onLive],
  );
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
    invalidatePageLinks();
  }, [queryClient, spaceKey]);
}

function PageView({
  id,
  canonicalize,
  spaceName,
  user,
}: {
  id: string;
  canonicalize: boolean;
  spaceName: string;
  user: { id: string; name: string };
}) {
  const t = useTranslations('space');
  const common = useTranslations('common');
  const page = usePage(id);
  const [people, setPeople] = useState<PersonState[]>([]);
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  // Titel, wie er gerade im Editor steht (Yjs); bis zur ersten Änderung der aus der API
  const [liveTitle, setLiveTitle] = useState<string>();
  useCanonicalPath(page.data && canonicalize ? pagePath(page.data.spaceKey, page.data) : undefined);
  const onTitleChange = useTitleChange(page.data?.spaceKey, id, setLiveTitle);
  const refreshAccess = useRefreshAccess(page.data?.spaceKey);
  // Aus dem Papierkorb holen; danach meldet der Collab-Server die Verbindung schreibend neu an
  const restore = useCallback(async () => {
    await api(`/pages/${id}/restore`, { method: 'POST' });
    await refreshAccess();
  }, [id, refreshAccess]);
  const closeDialog = useCallback(() => setDialog(null), []);
  // Tab-Titel: der Titel der Seite (beim Tippen mit), auf der Startseite des Spaces (/s/entw) sein Name
  const shownTitle = liveTitle ?? page.data?.title;
  useDocumentTitle(canonicalize ? (page.data ? shownTitle || common('untitled') : undefined) : spaceName);

  if (page.isPending)
    return (
      <>
        <Topbar />
        <Main>
          <p role="status">{common('loading')}</p>
        </Main>
      </>
    );
  // Schlägt erst das Neuladen fehl (Recht entzogen, während die Seite offen war), bleiben die alten
  // Daten stehen: Dann sagt der Editor „Kein Zugriff mehr“ und zeigt keinen Inhalt (E04-05)
  if (page.isError && !page.data) {
    return (
      <>
        <Topbar />
        <Main>
          <p role="alert">{t('pageNotFound')}</p>
        </Main>
      </>
    );
  }
  const p = liveTitle === undefined ? page.data : { ...page.data, title: liveTitle };
  const chip = p.restricted ? (
    <span className="nf-restricted-chip" title={common('restricted')}>
      <LockIcon size={13} />
      {common('restrictedChip')}
    </span>
  ) : null;
  const meta = <PageByline page={p} />;
  return (
    <>
      <PageHeader page={p} people={people} selfId={user.id} onOpen={setDialog} />
      <Main>
        <article>
          <PageEditor
            key={p.id}
            pageId={p.id}
            spaceKey={p.spaceKey}
            user={user}
            mayEdit={canEdit(p.role)}
            trashed={p.trashed}
            fallbackTitle={p.title}
            onTitleChange={onTitleChange}
            beforeTitle={chip}
            afterTitle={meta}
            onPresence={setPeople}
            onAccessChange={refreshAccess}
            onRestore={restore}
          />
        </article>
      </Main>
      <PageDialogs page={p} spaceName={spaceName} open={dialog} onClose={closeDialog} />
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      sidebar={
        <>
          <SidebarTop />
          <SidebarFoot />
        </>
      }
    >
      <Topbar />
      <Main>{children}</Main>
    </AppShell>
  );
}
