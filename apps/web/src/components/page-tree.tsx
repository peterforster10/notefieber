'use client';

// Seitenbaum in der Seitenleiste (CLAUDE.md, Abschnitt 9). Der Baum lädt ebenenweise
// (ARCHITECTURE_REVIEW.md, A-01): erst die oberste Ebene und die Ebene unter der Startseite,
// dann jede Ebene, sobald jemand sie aufklappt (GET /spaces/:key/pages?parent=…). Aufgeklappt
// ist anfangs der Weg zur ausgewählten Seite (ihre Brotkrume). Wie in Confluence steht die
// Startseite nicht im Baum, sondern als eigener Eintrag darüber; der Baum beginnt mit ihren
// Unterseiten. Eine Seite, deren Elternseite die Person nicht sieht, steht unter der nächsten
// sichtbaren Seite (wie in der Brotkrume); sie heißt hier „verwaist“ und lässt sich nicht
// zwischen ihre angezeigten Nachbarn sortieren, weil sie nicht deren Geschwister ist.
//
// Verschieben per Drag & Drop (natives HTML5): obere Kante einer Zeile = davor, untere = dahinter
// (bei aufgeklappten Seiten: als erste Unterseite), Mitte = hinein (ans Ende). Dieselben
// Verschiebungen gehen mit Knöpfen, auch per Tastatur und auf Touch-Geräten: nach oben, nach
// unten, einrücken (unter die vorige Seite), ausrücken (hinter die Elternseite). Der Baum zeigt
// das Ergebnis sofort und lädt danach die betroffenen Ebenen neu; lehnt die API ab, springt er
// zurück. Die Rechte prüft die Datenbank (app.move_page).
//
// Umbenennen (✎) geht über die API, die den Collab-Server bittet, den Titel im Yjs-Dokument zu
// ändern (E04-08): Wer die Seite gerade offen hat, sieht den neuen Titel sofort.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pagePath, spacePath } from '@notefieber/shared';
import { api, canEdit, queryKeys, usePage, useTreeLevel, type Space, type TreePage } from '@/lib/api';

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
  busy: boolean;
  renaming: string | null;
  setRenaming(id: string | null): void;
  renamePending: boolean;
  rename(id: string, title: string): void;
  creatingUnder: string | null;
  setCreatingUnder(id: string | null): void;
  createPending: boolean;
  create(parentId: string | null, title: string): void;
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const homeId = space.homePageId;
  const editableSpace = canEdit(space.role) && !space.archived;

  const root = useTreeLevel(space.key, null);
  const homeLevel = useTreeLevel(space.key, homeId, !!homeId);
  const home = root.data?.find((p) => p.id === homeId);

  // Aufgeklappt: der Weg zur ausgewählten Seite (Brotkrume, dieselbe Abfrage wie die Seite selbst),
  // danach, was die Person auf- und zuklappt
  const selected = usePage(selectedId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tree(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trash(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
    ]);
  const onError = (err: Error) => setError(err.message);

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
    mutationFn: (v: { parentId: string | null; title: string }) =>
      api<{ id: string }>(`/spaces/${space.key}/pages`, { method: 'POST', body: v }),
    onMutate: () => setError(null),
    onSuccess: async ({ id }, v) => {
      setCreatingUnder(null);
      if (v.parentId) expand(v.parentId);
      await refresh();
      router.push(pagePath(space.key, { id, title: v.title }));
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

  const tree: Tree = {
    space,
    homeId,
    selectedId,
    expanded,
    toggle,
    expand,
    busy: moveMutation.isPending || trashMutation.isPending,
    renaming,
    setRenaming,
    renamePending: renameMutation.isPending,
    rename: (id, title) => renameMutation.mutate({ id, title }),
    creatingUnder,
    setCreatingUnder,
    createPending: createMutation.isPending,
    create: (parentId, title) => createMutation.mutate({ parentId, title }),
    move: (item, body) => moveMutation.mutate({ item, body }),
    trash: (item) => {
      const msg = item.page.hasChildren
        ? `„${item.page.title}“ und alle Unterseiten in den Papierkorb?`
        : `„${item.page.title}“ in den Papierkorb?`;
      if (window.confirm(msg)) trashMutation.mutate(item.page.id);
    },
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
  const loading = root.isPending || (!!homeId && homeLevel.isPending);

  return (
    <TreeContext.Provider value={tree}>
      <nav aria-label="Seitenbaum" className="nf-tree">
        {editableSpace && (
          <button type="button" className="nf-sidebar-button" onClick={() => setCreatingUnder(homeId ?? 'root')}>
            + Neue Seite
          </button>
        )}
        {/* Die Startseite steht nicht im Baum: Das Formular für Seiten unter ihr kommt hierher */}
        {(creatingUnder === 'root' || (creatingUnder !== null && creatingUnder === homeId)) && (
          <TitleForm
            label="Titel der neuen Seite"
            submitText="Anlegen"
            busy={createMutation.isPending}
            onCancel={() => setCreatingUnder(null)}
            onSubmit={(title) =>
              createMutation.mutate({ parentId: creatingUnder === 'root' ? null : creatingUnder, title })
            }
          />
        )}
        {error && (
          <p role="alert" className="nf-alert nf-alert-dark">
            {error}
          </p>
        )}
        {(root.isError || homeLevel.isError) && (
          <p role="alert" className="nf-alert nf-alert-dark">
            Der Seitenbaum lässt sich gerade nicht laden.
          </p>
        )}
        {homeItem && <HomeRow item={homeItem} />}
        {loading ? (
          <p className="nf-muted-dark">Einen Moment …</p>
        ) : (
          <ul role="tree" aria-label={`Seiten in ${space.name}`}>
            <ItemList items={topFromHome} />
            <ItemList items={topFromRoot} />
          </ul>
        )}
      </nav>
    </TreeContext.Provider>
  );
}

/** Seiten einer Ebene; Geschwister sind nur Seiten mit derselben echten Elternseite */
function ItemList({ items, parent }: { items: Item[]; parent?: Item }) {
  return (
    <>
      {items.map((item) => {
        const sibs = isOrphan(item) ? [] : items.filter((s) => !isOrphan(s) && s.page.parentId === item.page.parentId);
        const i = sibs.findIndex((s) => s.page.id === item.page.id);
        return <TreeItem key={item.page.id} item={item} prev={sibs[i - 1]} next={sibs[i + 1]} parent={parent} />;
      })}
    </>
  );
}

/** Ebene unter einer aufgeklappten Seite, erst beim Aufklappen geladen */
function ChildLevel({ parent }: { parent: Item }) {
  const { space } = useTree();
  const level = useTreeLevel(space.key, parent.page.id);
  const ancestors = [...parent.ancestors, parent.page.id];
  if (level.isPending) {
    return (
      <ul role="group">
        <li className="nf-tree-loading" aria-busy="true">
          …
        </li>
      </ul>
    );
  }
  if (level.isError) {
    return (
      <ul role="group">
        <li className="nf-tree-loading">Nicht geladen</li>
      </ul>
    );
  }
  const items = level.data.map((page) => ({ page, level: parent.page.id, ancestors }));
  return (
    <ul role="group">
      <ItemList items={items} parent={parent} />
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

function HomeRow({ item }: { item: Item }) {
  const t = useTree();
  const target = useDropTarget(item, true);
  return (
    <div
      className={`nf-tree-row nf-home-row${item.page.id === t.selectedId ? ' nf-selected' : ''}${target.dropClass}`}
      onDragOver={target.onDragOver}
      onDragLeave={target.onDragLeave}
      onDrop={target.onDrop}
    >
      <span className="nf-home-icon" aria-hidden="true">
        ⌂
      </span>
      <Link href={spacePath(t.space.key)} className="nf-tree-link" draggable={false}>
        Startseite
      </Link>
    </div>
  );
}

function TreeItem({ item, prev, next, parent }: { item: Item; prev?: Item; next?: Item; parent?: Item }) {
  const t = useTree();
  const p = item.page;
  const open = t.expanded.has(p.id) && p.hasChildren;
  const editable = canEdit(p.role) && !t.space.archived;
  const isHome = p.id === t.homeId;
  const orphan = isOrphan(item);
  // Ausrücken nur hinter eine angezeigte, nicht verwaiste Elternseite (nicht aus der Startseite)
  const outdent = parent && parent.page.id !== t.homeId && !isOrphan(parent) ? parent : undefined;
  const draggable = editable && !isHome && !orphan;
  const target = useDropTarget(item);
  const dragged = t.dragging?.page.id === p.id;

  return (
    <li role="treeitem" aria-expanded={p.hasChildren ? open : undefined} aria-selected={p.id === t.selectedId}>
      <div
        className={`nf-tree-row${p.id === t.selectedId ? ' nf-selected' : ''}${dragged ? ' nf-dragging' : ''}${target.dropClass}`}
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
        <button
          type="button"
          className="nf-twisty"
          onClick={() => t.toggle(p.id)}
          aria-label={open ? `${p.title} zuklappen` : `${p.title} aufklappen`}
          style={{ visibility: p.hasChildren ? 'visible' : 'hidden' }}
        >
          {open ? '▾' : '▸'}
        </button>
        <Link href={pagePath(t.space.key, p)} className="nf-tree-link" draggable={false}>
          {p.title || 'Ohne Titel'}
        </Link>
        {p.restricted && (
          <span className="nf-lock" title="Eigene Rechte" aria-label="eingeschränkt">
            🔒
          </span>
        )}
        {editable && (
          <span className="nf-actions">
            <IconButton label="Neue Unterseite" onClick={() => t.setCreatingUnder(p.id)}>
              +
            </IconButton>
            <IconButton label="Umbenennen" disabled={t.renamePending} onClick={() => t.setRenaming(p.id)}>
              ✎
            </IconButton>
            {!isHome && (
              <>
                <IconButton
                  label="Nach oben"
                  disabled={!prev || t.busy}
                  onClick={() => prev && t.move(item, { parentId: p.parentId, beforeId: prev.page.id })}
                >
                  ↑
                </IconButton>
                <IconButton
                  label="Nach unten"
                  disabled={!next || t.busy}
                  onClick={() => next && t.move(item, { parentId: p.parentId, afterId: next.page.id })}
                >
                  ↓
                </IconButton>
                <IconButton
                  label="Einrücken (unter die vorige Seite)"
                  disabled={!prev || t.busy}
                  onClick={() => prev && t.move(item, { parentId: prev.page.id })}
                >
                  →
                </IconButton>
                <IconButton
                  label="Ausrücken (hinter die Elternseite)"
                  disabled={!outdent || orphan || t.busy}
                  onClick={() => outdent && t.move(item, { parentId: outdent.page.parentId, afterId: outdent.page.id })}
                >
                  ←
                </IconButton>
                <IconButton label="In den Papierkorb" disabled={t.busy} onClick={() => t.trash(item)}>
                  🗑
                </IconButton>
              </>
            )}
          </span>
        )}
      </div>
      {t.renaming === p.id && (
        <TitleForm
          initial={p.title}
          label="Neuer Titel"
          submitText="Umbenennen"
          busy={t.renamePending}
          onCancel={() => t.setRenaming(null)}
          onSubmit={(title) => (title === p.title ? t.setRenaming(null) : t.rename(p.id, title))}
        />
      )}
      {t.creatingUnder === p.id && (
        <TitleForm
          label="Titel der neuen Seite"
          submitText="Anlegen"
          busy={t.createPending}
          onCancel={() => t.setCreatingUnder(null)}
          onSubmit={(title) => t.create(p.id, title)}
        />
      )}
      {open && <ChildLevel parent={item} />}
    </li>
  );
}

/** Titel eingeben: neue Seite oder umbenennen */
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
        placeholder="Titel"
        value={title}
        maxLength={255}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      <button type="submit" disabled={busy}>
        {submitText}
      </button>
      <button type="button" onClick={onCancel}>
        Abbrechen
      </button>
    </form>
  );
}

function IconButton(props: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="nf-icon-button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
