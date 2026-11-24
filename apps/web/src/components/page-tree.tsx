'use client';

// Seitenbaum in der Seitenleiste (CLAUDE.md, Abschnitt 9). Der Baum lädt ebenenweise
// (ARCHITECTURE_REVIEW.md, A-01): erst die oberste Ebene und die Ebene unter der Startseite,
// dann jede Ebene, sobald jemand sie aufklappt (GET /spaces/:key/pages?parent=…). Aufgeklappt
// ist, was die Person zuletzt in diesem Space aufgeklappt hat (bleibt beim Seitenwechsel und
// Neuladen, lib/sidebar-state.ts), dazu immer der Weg zur ausgewählten Seite (ihre Brotkrume). Wie in Confluence steht die
// Startseite nicht im Baum, sondern als eigener Eintrag darüber; der Baum beginnt mit ihren
// Unterseiten. Eine Seite, deren Elternseite die Person nicht sieht, steht unter der nächsten
// sichtbaren Seite (wie in der Brotkrume); sie heißt hier „verwaist“ und lässt sich nicht
// zwischen ihre angezeigten Nachbarn sortieren, weil sie nicht deren Geschwister ist.
//
// Verschieben per Drag & Drop (natives HTML5): obere Kante einer Zeile = davor, untere = dahinter
// (bei aufgeklappten Seiten: als erste Unterseite), Mitte = hinein (ans Ende). Dieselben
// Verschiebungen gehen über das Menü „⋯“ der Zeile, auch per Tastatur und auf Touch-Geräten: nach
// oben, nach unten, einrücken (unter die vorige Seite), ausrücken (hinter die Elternseite). Der Baum
// zeigt das Ergebnis sofort und lädt danach die betroffenen Ebenen neu; lehnt die API ab, springt er
// zurück. Die Rechte prüft die Datenbank (app.move_page).
//
// Tastatur (ARIA-Muster „Tree View“, E15): Der Baum ist ein Tab-Stopp (wandernder tabindex auf den
// Links). ↑/↓ wechseln die Zeile, → klappt auf bzw. springt in die erste Unterseite, ← klappt zu bzw.
// springt zur Elternseite, Pos1/Ende an den Anfang bzw. ans Ende, Enter öffnet die Seite. F2 benennt
// um, Entf legt in den Papierkorb. Tab führt von der Zeile zu „Neue Unterseite“ und ihrem Menü.
//
// Neue Seite: „+“ (neben „Seiten“ unter der Startseite, an einer Zeile darunter) legt sie sofort
// ohne Titel an und öffnet sie; der Editor setzt den Cursor in den leeren Titel (lib/new-page.ts).
//
// Umbenennen geht über die API, die den Collab-Server bittet, den Titel im Yjs-Dokument zu
// ändern (E04-08): Wer die Seite gerade offen hat, sieht den neuen Titel sofort.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { invalidatePageLinks } from '@/lib/page-links';
import { pagePath, spacePath } from '@notefieber/shared';
import { api, canEdit, queryKeys, usePage, useTreeLevel, type Space, type TreePage } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import { loadExpanded, saveExpanded } from '@/lib/sidebar-state';
import { markNewPage } from '@/lib/new-page';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  HomeIcon,
  IndentIcon,
  LockIcon,
  MoreIcon,
  OutdentIcon,
  PageIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './icons';
import { ConfirmDialog } from './dialog';
import { MenuButton } from './menu';

type MoveBody = { parentId: string | null; afterId?: string; beforeId?: string };
type Zone = 'before' | 'inside' | 'after';

/** Eine Seite, wie sie im Baum steht */
interface Item {
  page: TreePage;
  /** Ebene, in der sie angezeigt wird: Seite darüber im Baum (null = oberste Ebene) */
  level: string | null;
  /** Angezeigte Vorfahren von oben nach unten (gegen Ablegen in die eigenen Unterseiten) */
  ancestors: string[];
}

const DRAG_TYPE = 'application/x-nf-page';
const EXPAND_DELAY_MS = 700; // beim Ziehen über einer zugeklappten Seite: aufklappen

const isOrphan = (i: Item) => i.page.parentId !== i.level;

interface Tree {
  space: Space;
  homeId: string | null;
  selectedId?: string;
  expanded: Set<string>;
  toggle(id: string): void;
  expand(id: string): void;
  /** Zeile, die per Tab erreichbar ist (wandernder tabindex) */
  focusId: string | null;
  setFocusId(id: string): void;
  busy: boolean;
  renaming: string | null;
  setRenaming(id: string | null): void;
  renamePending: boolean;
  rename(id: string, title: string): void;
  createPending: boolean;
  /** Neue Seite ohne Titel anlegen und öffnen */
  create(parentId: string | null): void;
  move(item: Item, body: MoveBody): void;
  trash(item: Item): void;
  dragging: Item | null;
  setDragging(item: Item | null): void;
  drop: { id: string; zone: Zone } | null;
  setDrop(drop: { id: string; zone: Zone } | null): void;
  /** Wohin eine Ablage an dieser Stelle führt; undefined = hier nicht erlaubt */
  dropBody(target: Item, zone: Zone): MoveBody | undefined;
}
const TreeContext = createContext<Tree | null>(null);
const useTree = () => useContext(TreeContext)!;

export function PageTree({ space, selectedId }: { space: Space; selectedId?: string }) {
  const t = useTranslations('tree');
  const common = useTranslations('common');
  const errorText = useErrorText();
  const router = useRouter();
  const queryClient = useQueryClient();
  const headingId = useId();
  const treeRef = useRef<HTMLUListElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Seite, für die die Rückfrage „In den Papierkorb?“ offen ist
  const [confirmTrash, setConfirmTrash] = useState<Item | null>(null);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const homeId = space.homePageId;
  const [focusId, setFocusId] = useState<string | null>(selectedId ?? homeId);
  const editableSpace = canEdit(space.role) && !space.archived;

  const root = useTreeLevel(space.key, null);
  const homeLevel = useTreeLevel(space.key, homeId, !!homeId);
  const home = root.data?.find((p) => p.id === homeId);

  // Aufgeklappt: was die Person in diesem Space zuletzt aufgeklappt hat (die Seitenleiste entsteht
  // bei jedem Seitenwechsel neu), dazu der Weg zur ausgewählten Seite (Brotkrume, dieselbe Abfrage
  // wie die Seite selbst)
  const selected = usePage(selectedId);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(space.id));
  useEffect(() => saveExpanded(space.id, expanded), [space.id, expanded]);
  // Neue Brotkrume (andere Seite ausgewählt): ihre Seiten zusätzlich aufklappen. Während des
  // Renderns statt in einem Effekt, damit der Baum nicht erst zugeklappt erscheint.
  const crumbs = selected.data?.breadcrumb.map((c) => c.id).join(',');
  const [openedFor, setOpenedFor] = useState<string | undefined>();
  if (crumbs && crumbs !== openedFor) {
    setOpenedFor(crumbs);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of crumbs.split(',')) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expand = (id: string) => setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // Genau eine Zeile per Tab erreichbar: Ist die gemerkte nicht (mehr) zu sehen (zugeklappt, gelöscht),
  // übernimmt die erste
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || tree.querySelector('[data-tree-link][tabindex="0"]')) return;
    tree.querySelector<HTMLElement>('[data-tree-link]')?.setAttribute('tabindex', '0');
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tree(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trash(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
    ]).then(invalidatePageLinks);
  const onError = (err: Error) => setError(errorText(err));

  const moveMutation = useMutation({
    mutationFn: ({ item, body }: { item: Item; body: MoveBody }) =>
      api(`/pages/${item.page.id}/move`, { method: 'POST', body }),
    // Sofort im Baum zeigen: aus der alten Ebene nehmen, in die neue einsetzen (falls geladen)
    onMutate: async ({ item, body }) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: queryKeys.tree(space.key) });
      const snapshot = queryClient.getQueriesData<TreePage[]>({ queryKey: queryKeys.tree(space.key) });
      const moved = { ...item.page, parentId: body.parentId };
      queryClient.setQueryData<TreePage[]>(queryKeys.treeLevel(space.key, item.level), (old) =>
        old?.filter((p) => p.id !== item.page.id),
      );
      queryClient.setQueryData<TreePage[]>(queryKeys.treeLevel(space.key, body.parentId), (old) => {
        if (!old) return old;
        const list = old.filter((p) => p.id !== item.page.id);
        const ref = body.beforeId ?? body.afterId;
        const i = ref ? list.findIndex((p) => p.id === ref) : -1;
        const at = i < 0 ? list.length : body.afterId ? i + 1 : i;
        return [...list.slice(0, at), moved, ...list.slice(at)];
      });
      if (body.parentId) expand(body.parentId);
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      onError(err);
    },
    // Verschoben per Tastatur: Fokus bleibt auf der Seite, auch an ihrem neuen Platz
    onSuccess: (_d, { item }) => {
      requestAnimationFrame(() =>
        treeRef.current?.querySelector<HTMLElement>(`[data-tree-link][data-id="${item.page.id}"]`)?.focus(),
      );
    },
    onSettled: refresh,
  });
  const trashMutation = useMutation({
    mutationFn: (id: string) => api<{ count: number }>(`/pages/${id}`, { method: 'DELETE' }),
    onMutate: () => setError(null),
    onSuccess: async (_d, id) => {
      await refresh();
      // Lag die ausgewählte Seite darunter, zurück zur Startseite
      const inside = id === selectedId || selected.data?.breadcrumb.some((c) => c.id === id);
      if (inside) router.push(spacePath(space.key));
    },
    onError,
  });
  const renameMutation = useMutation({
    mutationFn: (v: { id: string; title: string }) =>
      api(`/pages/${v.id}/title`, { method: 'POST', body: { title: v.title } }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setRenaming(null);
      // Gespeichert ist der neue Titel schon; Baum, Brotkrume und Adresse ziehen nach
      await refresh();
    },
    onError,
  });
  const createMutation = useMutation({
    mutationFn: (v: { parentId: string | null }) =>
      api<{ id: string }>(`/spaces/${space.key}/pages`, { method: 'POST', body: { parentId: v.parentId, title: '' } }),
    onMutate: () => setError(null),
    onSuccess: async ({ id }, v) => {
      markNewPage(id);
      if (v.parentId) expand(v.parentId);
      await refresh();
      router.push(pagePath(space.key, { id, title: '' }));
    },
    onError,
  });

  function dropBody(target: Item, zone: Zone): MoveBody | undefined {
    const d = dragging;
    if (!d || !editableSpace) return undefined;
    // nicht auf sich selbst und nicht in die eigenen Unterseiten
    if (target.page.id === d.page.id || target.ancestors.includes(d.page.id)) return undefined;
    if (zone === 'inside') return canEdit(target.page.role) ? { parentId: target.page.id } : undefined;
    // davor und dahinter nur zwischen echte Geschwister, nicht neben die Startseite
    if (isOrphan(target) || target.page.id === homeId) return undefined;
    if (zone === 'before') return { parentId: target.page.parentId, beforeId: target.page.id };
    // dahinter bei einer aufgeklappten Seite mit Unterseiten: als erste Unterseite, wie es aussieht
    if (expanded.has(target.page.id) && target.page.hasChildren) {
      const first = queryClient
        .getQueryData<TreePage[]>(queryKeys.treeLevel(space.key, target.page.id))
        ?.find((p) => p.parentId === target.page.id && p.id !== d.page.id);
      if (!canEdit(target.page.role)) return undefined;
      return first ? { parentId: target.page.id, beforeId: first.id } : { parentId: target.page.id };
    }
    return { parentId: target.page.parentId, afterId: target.page.id };
  }

  /** Pfeiltasten, Pos1 und Ende im Baum; die Reihenfolge der sichtbaren Zeilen kommt aus dem DOM */
  function onTreeKey(e: KeyboardEvent<HTMLUListElement>) {
    const link = e.target as HTMLElement;
    if (!link.matches('[data-tree-link]') || e.altKey || e.ctrlKey || e.metaKey) return;
    const links = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-link]') ?? [])];
    const i = links.indexOf(link);
    const row = link.closest<HTMLElement>('[role="treeitem"]');
    const id = link.dataset.id;
    const level = Number(row?.getAttribute('aria-level'));
    const state = row?.getAttribute('aria-expanded');
    const go = (el: HTMLElement | undefined) => {
      if (!el?.dataset.id) return;
      setFocusId(el.dataset.id);
      el.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        go(links[i + 1]);
        break;
      case 'ArrowUp':
        go(links[i - 1]);
        break;
      case 'Home':
        go(links[0]);
        break;
      case 'End':
        go(links.at(-1));
        break;
      case 'ArrowRight':
        if (state === 'false' && id) toggle(id);
        else if (state === 'true') {
          const next = links[i + 1];
          if (Number(next?.closest('[role="treeitem"]')?.getAttribute('aria-level')) === level + 1) go(next);
        }
        break;
      case 'ArrowLeft':
        if (state === 'true' && id) toggle(id);
        else
          go(
            row?.parentElement?.closest('[role="treeitem"]')?.querySelector<HTMLElement>('[data-tree-link]') ??
              undefined,
          );
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // Nach der Rückfrage zurück in den Baum: auf die Seite (Abbrechen) oder die aktive Zeile. Der Knopf
  // „⋯“, der den Dialog geöffnet hat, ist dann schon wieder unsichtbar und kann den Fokus nicht nehmen.
  function closeConfirmTrash(pageId: string | undefined) {
    setConfirmTrash(null);
    requestAnimationFrame(() => {
      const tree = treeRef.current;
      const row = pageId ? tree?.querySelector<HTMLElement>(`[data-tree-link][data-id="${pageId}"]`) : null;
      (row ?? tree?.querySelector<HTMLElement>('[data-tree-link][tabindex="0"]'))?.focus();
    });
  }

  const tree: Tree = {
    space,
    homeId,
    selectedId,
    expanded,
    toggle,
    expand,
    focusId,
    setFocusId,
    busy: moveMutation.isPending || trashMutation.isPending,
    renaming,
    setRenaming,
    renamePending: renameMutation.isPending,
    rename: (id, title) => renameMutation.mutate({ id, title }),
    createPending: createMutation.isPending,
    create: (parentId) => createMutation.mutate({ parentId }),
    move: (item, body) => moveMutation.mutate({ item, body }),
    trash: (item) => setConfirmTrash(item),
    dragging,
    setDragging,
    drop,
    setDrop,
    dropBody,
  };

  // Oberste Ebene im Baum: Unterseiten der Startseite, danach weitere Seiten ganz oben
  const topFromHome = (homeLevel.data ?? []).map((page) => ({
    page,
    level: homeId,
    ancestors: homeId ? [homeId] : [],
  }));
  const topFromRoot = (root.data ?? [])
    .filter((p) => p.id !== homeId)
    .map((page) => ({ page, level: null, ancestors: [] }));
  const homeItem: Item | undefined = home ? { page: home, level: null, ancestors: [] } : undefined;
  const top = [...topFromHome, ...topFromRoot];
  const loading = root.isPending || (!!homeId && homeLevel.isPending);

  return (
    <TreeContext.Provider value={tree}>
      <div className="nf-tree">
        <div className="nf-tree-head">
          <h2 className="nf-tree-heading" id={headingId}>
            {t('heading')}
          </h2>
          {editableSpace && (
            <button
              type="button"
              className="nf-icon-button"
              aria-label={t('newPage')}
              title={t('newPage')}
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({ parentId: homeId })}
            >
              <PlusIcon />
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="nf-alert">
            {error}
          </p>
        )}
        {(root.isError || homeLevel.isError) && (
          <p role="alert" className="nf-alert">
            {t('loadError')}
          </p>
        )}
        {loading ? (
          <p className="nf-tree-loading" role="status">
            {common('loading')}
          </p>
        ) : (
          <ul
            ref={treeRef}
            role="tree"
            aria-label={t('pagesIn', { space: space.name })}
            aria-describedby={headingId}
            onKeyDown={onTreeKey}
          >
            {homeItem && <HomeRow item={homeItem} setSize={top.length + 1} />}
            <ItemList items={top} depth={1} offset={homeItem ? 1 : 0} setSize={top.length + (homeItem ? 1 : 0)} />
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!confirmTrash}
        title={
          confirmTrash &&
          t(confirmTrash.page.hasChildren ? 'confirmTrashWithChildren' : 'confirmTrash', {
            title: confirmTrash.page.title || common('untitled'),
          })
        }
        message={t('trashHint')}
        confirmLabel={t('trash')}
        busy={trashMutation.isPending}
        onCancel={() => closeConfirmTrash(confirmTrash?.page.id)}
        onConfirm={() => {
          if (confirmTrash) trashMutation.mutate(confirmTrash.page.id);
          closeConfirmTrash(undefined);
        }}
      />
    </TreeContext.Provider>
  );
}

/** Seiten einer Ebene; Geschwister sind nur Seiten mit derselben echten Elternseite */
function ItemList({
  items,
  parent,
  depth,
  offset = 0,
  setSize = items.length,
}: {
  items: Item[];
  parent?: Item;
  depth: number;
  offset?: number;
  setSize?: number;
}) {
  return (
    <>
      {items.map((item, index) => {
        const sibs = isOrphan(item) ? [] : items.filter((s) => !isOrphan(s) && s.page.parentId === item.page.parentId);
        const i = sibs.findIndex((s) => s.page.id === item.page.id);
        return (
          <TreeItem
            key={item.page.id}
            item={item}
            prev={sibs[i - 1]}
            next={sibs[i + 1]}
            parent={parent}
            depth={depth}
            position={offset + index + 1}
            setSize={setSize}
          />
        );
      })}
    </>
  );
}

/** Ebene unter einer aufgeklappten Seite, erst beim Aufklappen geladen */
function ChildLevel({ parent, depth }: { parent: Item; depth: number }) {
  const t = useTranslations('tree');
  const { space } = useTree();
  const level = useTreeLevel(space.key, parent.page.id);
  const ancestors = [...parent.ancestors, parent.page.id];
  if (level.isPending) {
    return (
      <ul role="group">
        <li className="nf-tree-loading" role="none">
          …
        </li>
      </ul>
    );
  }
  if (level.isError) {
    return (
      <ul role="group">
        <li className="nf-tree-loading" role="none">
          {t('notLoaded')}
        </li>
      </ul>
    );
  }
  const items = level.data.map((page) => ({ page, level: parent.page.id, ancestors }));
  return (
    <ul role="group">
      <ItemList items={items} parent={parent} depth={depth} />
    </ul>
  );
}

/** Ziehen und Ablegen für eine Zeile; die Startseite nimmt nur „hinein“ an */
function useDropTarget(item: Item, onlyInside = false) {
  const t = useTree();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  function zoneAt(e: DragEvent<HTMLElement>): Zone | undefined {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const preferred: Zone = onlyInside ? 'inside' : y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    if (t.dropBody(item, preferred)) return preferred;
    if (onlyInside) return undefined;
    // Ausweichen: hinein nicht erlaubt → davor/dahinter nach der Hälfte, und umgekehrt
    const fallback: Zone = preferred === 'inside' ? (y < 0.5 ? 'before' : 'after') : 'inside';
    return t.dropBody(item, fallback) ? fallback : undefined;
  }

  return {
    onDragOver(e: DragEvent<HTMLElement>) {
      if (!t.dragging) return;
      const zone = zoneAt(e);
      if (!zone) {
        if (t.drop?.id === item.page.id) t.setDrop(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (t.drop?.id !== item.page.id || t.drop.zone !== zone) t.setDrop({ id: item.page.id, zone });
      if (!onlyInside && item.page.hasChildren && !t.expanded.has(item.page.id) && !timer.current) {
        timer.current = setTimeout(() => t.expand(item.page.id), EXPAND_DELAY_MS);
      }
    },
    onDragLeave(e: DragEvent<HTMLElement>) {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      clearTimer();
      if (t.drop?.id === item.page.id) t.setDrop(null);
    },
    onDrop(e: DragEvent<HTMLElement>) {
      clearTimer();
      const zone = zoneAt(e);
      const body = zone && t.dropBody(item, zone);
      const dragged = t.dragging;
      t.setDrop(null);
      t.setDragging(null);
      if (!body || !dragged) return;
      e.preventDefault();
      t.move(dragged, body);
    },
    dropClass: t.drop?.id === item.page.id ? ` nf-drop-${t.drop.zone}` : '',
  };
}

function HomeRow({ item, setSize }: { item: Item; setSize: number }) {
  const tr = useTranslations('tree');
  const t = useTree();
  const target = useDropTarget(item, true);
  const id = item.page.id;
  const selected = id === t.selectedId;
  return (
    <li role="treeitem" aria-level={1} aria-posinset={1} aria-setsize={setSize} aria-selected={selected}>
      <div
        className={`nf-tree-row${selected ? ' nf-selected' : ''}${target.dropClass}`}
        onDragOver={target.onDragOver}
        onDragLeave={target.onDragLeave}
        onDrop={target.onDrop}
      >
        <span className="nf-home-icon">
          <HomeIcon />
        </span>
        <Link
          href={spacePath(t.space.key)}
          className="nf-tree-link"
          draggable={false}
          data-tree-link
          data-id={id}
          tabIndex={t.focusId === id ? 0 : -1}
          aria-current={selected ? 'page' : undefined}
          onFocus={() => t.setFocusId(id)}
        >
          <span className="nf-tree-title">{tr('home')}</span>
        </Link>
      </div>
    </li>
  );
}

function TreeItem({
  item,
  prev,
  next,
  parent,
  depth,
  position,
  setSize,
}: {
  item: Item;
  prev?: Item;
  next?: Item;
  parent?: Item;
  depth: number;
  position: number;
  setSize: number;
}) {
  const tr = useTranslations('tree');
  const common = useTranslations('common');
  const t = useTree();
  const p = item.page;
  const link = useRef<HTMLAnchorElement>(null);
  const open = t.expanded.has(p.id) && p.hasChildren;
  const editable = canEdit(p.role) && !t.space.archived;
  const isHome = p.id === t.homeId;
  const orphan = isOrphan(item);
  const selected = p.id === t.selectedId;
  // Ausrücken nur hinter eine angezeigte, nicht verwaiste Elternseite (nicht aus der Startseite)
  const outdent = parent && parent.page.id !== t.homeId && !isOrphan(parent) ? parent : undefined;
  const draggable = editable && !isHome && !orphan;
  const target = useDropTarget(item);
  const dragged = t.dragging?.page.id === p.id;
  const title = p.title || common('untitled');
  // Nur die aktive Zeile und ihre Knöpfe sind per Tab erreichbar
  const tab = t.focusId === p.id ? 0 : -1;
  const backToRow = () => link.current?.focus();

  return (
    <li
      role="treeitem"
      aria-level={depth}
      aria-posinset={position}
      aria-setsize={setSize}
      aria-expanded={p.hasChildren ? open : undefined}
      aria-selected={selected}
    >
      <div
        className={`nf-tree-row${selected ? ' nf-selected' : ''}${dragged ? ' nf-dragging' : ''}${target.dropClass}`}
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DRAG_TYPE, p.id); // ohne Daten zieht Firefox nicht
          t.setDragging(item);
        }}
        onDragEnd={() => {
          t.setDragging(null);
          t.setDrop(null);
        }}
        onDragOver={target.onDragOver}
        onDragLeave={target.onDragLeave}
        onDrop={target.onDrop}
      >
        {/* Mit der Maus; per Tastatur klappen → und ← auf und zu */}
        <button
          type="button"
          className="nf-twisty"
          tabIndex={-1}
          data-open={open}
          onClick={() => {
            t.setFocusId(p.id);
            t.toggle(p.id);
          }}
          aria-label={tr(open ? 'collapse' : 'expand', { title })}
          style={{ visibility: p.hasChildren ? 'visible' : 'hidden' }}
        >
          <ChevronRightIcon size={14} />
        </button>
        <Link
          ref={link}
          href={pagePath(t.space.key, p)}
          className="nf-tree-link"
          draggable={false}
          data-tree-link
          data-id={p.id}
          tabIndex={tab}
          aria-current={selected ? 'page' : undefined}
          aria-keyshortcuts={editable && !isHome ? 'F2 Delete' : undefined}
          onFocus={() => t.setFocusId(p.id)}
          onKeyDown={(e) => {
            if (!editable) return;
            if (e.key === 'F2') {
              e.preventDefault();
              t.setRenaming(p.id);
            } else if (e.key === 'Delete' && !isHome) {
              e.preventDefault();
              t.trash(item);
            }
          }}
        >
          <PageIcon size={15} />
          <span className="nf-tree-title">{title}</span>
          {p.restricted && <LockIcon size={14} label={common('restrictedLabel')} />}
        </Link>
        {editable && (
          <span className="nf-actions">
            <IconButton
              label={tr('newSubpage')}
              tabIndex={tab}
              disabled={t.createPending}
              onClick={() => t.create(p.id)}
            >
              <PlusIcon size={14} />
            </IconButton>
            <MenuButton
              className="nf-icon-button"
              label={tr('actionsFor', { title })}
              align="end"
              tabIndex={tab}
              items={[
                {
                  key: 'rename',
                  label: tr('rename'),
                  icon: <PencilIcon />,
                  shortcut: 'F2',
                  keys: 'F2',
                  disabled: t.renamePending,
                  onSelect: () => t.setRenaming(p.id),
                },
                ...(isHome
                  ? []
                  : [
                      {
                        key: 'up',
                        label: tr('moveUp'),
                        icon: <ArrowUpIcon />,
                        separatorBefore: true,
                        disabled: !prev || t.busy,
                        onSelect: () => prev && t.move(item, { parentId: p.parentId, beforeId: prev.page.id }),
                      },
                      {
                        key: 'down',
                        label: tr('moveDown'),
                        icon: <ArrowDownIcon />,
                        disabled: !next || t.busy,
                        onSelect: () => next && t.move(item, { parentId: p.parentId, afterId: next.page.id }),
                      },
                      {
                        key: 'indent',
                        label: tr('indent'),
                        icon: <IndentIcon />,
                        disabled: !prev || t.busy,
                        onSelect: () => prev && t.move(item, { parentId: prev.page.id }),
                      },
                      {
                        key: 'outdent',
                        label: tr('outdent'),
                        icon: <OutdentIcon />,
                        disabled: !outdent || orphan || t.busy,
                        onSelect: () =>
                          outdent && t.move(item, { parentId: outdent.page.parentId, afterId: outdent.page.id }),
                      },
                      {
                        key: 'trash',
                        label: tr('trash'),
                        icon: <TrashIcon />,
                        shortcut: tr('deleteKey'),
                        keys: 'Delete',
                        danger: true,
                        separatorBefore: true,
                        disabled: t.busy,
                        onSelect: () => t.trash(item),
                      },
                    ]),
              ]}
            >
              <MoreIcon />
            </MenuButton>
          </span>
        )}
      </div>
      {t.renaming === p.id && (
        <TitleForm
          initial={p.title}
          label={tr('newTitle')}
          submitText={tr('rename')}
          busy={t.renamePending}
          onCancel={() => {
            t.setRenaming(null);
            backToRow();
          }}
          onSubmit={(value) => (value === p.title ? t.setRenaming(null) : t.rename(p.id, value))}
        />
      )}
      {open && <ChildLevel parent={item} depth={depth + 1} />}
    </li>
  );
}

/** Neuen Titel eingeben (Umbenennen aus der Seitenleiste) */
function TitleForm({
  initial = '',
  label,
  submitText,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  label: string;
  submitText: string;
  busy: boolean;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('tree');
  const common = useTranslations('common');
  const [title, setTitle] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) onSubmit(title.trim());
  }
  return (
    <form onSubmit={submit} className="nf-new-page">
      <input
        autoFocus
        aria-label={label}
        placeholder={t('titlePlaceholder')}
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          // Esc bricht nur das Formular ab, schließt nicht auch die Schublade
          e.preventDefault();
          onCancel();
        }}
      />
      <button type="submit" className="nf-button" disabled={busy}>
        {submitText}
      </button>
      <button type="button" className="nf-button nf-button-secondary" onClick={onCancel}>
        {common('cancel')}
      </button>
    </form>
  );
}

function IconButton(props: {
  label: string;
  disabled?: boolean;
  tabIndex?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="nf-icon-button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      tabIndex={props.tabIndex}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
