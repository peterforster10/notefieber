'use client';

// Seitenbaum in der Seitenleiste (CLAUDE.md, Abschnitt 9). Die API liefert alle Seiten, die
// die Person sieht, flach und sortiert (position, id); hier wird daraus der Baum. Wie in
// Confluence steht die Startseite nicht im Baum, sondern als eigener Eintrag darüber; der Baum
// beginnt mit ihren Unterseiten. Seiten, deren Elternseite die Person nicht sieht, erscheinen
// ebenfalls oben.
//
// Verschieben geht mit Knöpfen (auch per Tastatur): nach oben, nach unten, einrücken (unter
// die vorige Seite), ausrücken (hinter die Elternseite). Drag & Drop folgt (M2).
//
// Umbenennen (✎) geht über die API, die den Collab-Server bittet, den Titel im Yjs-Dokument zu
// ändern (E04-08): Wer die Seite gerade offen hat, sieht den neuen Titel sofort.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { pagePath, spacePath } from '@notefieber/shared';
import { api, canEdit, queryKeys, type Space, type TreePage } from '@/lib/api';

type MoveBody = { parentId: string | null; afterId?: string; beforeId?: string };

export function PageTree({ space, pages, selectedId }: { space: Space; pages: TreePage[]; selectedId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const homeId = space.homePageId;
  const { byId, children, roots, top } = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const children = new Map<string, TreePage[]>();
    const roots: TreePage[] = []; // Seiten ohne sichtbare Elternseite, ohne die Startseite
    for (const p of pages) {
      if (p.parentId && byId.has(p.parentId)) {
        const list = children.get(p.parentId) ?? [];
        list.push(p);
        children.set(p.parentId, list);
      } else if (p.id !== homeId) {
        roots.push(p);
      }
    }
    // Oberste Ebene im Baum: Unterseiten der Startseite, danach weitere Wurzeln
    const top = [...(homeId ? (children.get(homeId) ?? []) : []), ...roots];
    return { byId, children, roots, top };
  }, [pages, homeId]);
  const home = homeId ? byId.get(homeId) : undefined;

  // Aufgeklappt: Wurzeln und der Weg zur ausgewählten Seite; danach, was die Person ändert
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set(pages.filter((p) => !p.parentId).map((p) => p.id));
    let cur = selectedId ? pages.find((p) => p.id === selectedId) : undefined;
    while (cur?.parentId) {
      open.add(cur.parentId);
      cur = pages.find((p) => p.id === cur!.parentId);
    }
    return open;
  });
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tree(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.trash(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
    ]);
  const onError = (err: Error) => setError(err.message);

  const move = useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveBody }) => api(`/pages/${id}/move`, { method: 'POST', body }),
    onMutate: () => setError(null),
    onSuccess: (_d, v) => {
      if (v.body.parentId) setExpanded((prev) => new Set(prev).add(v.body.parentId!));
      return refresh();
    },
    onError,
  });
  const trash = useMutation({
    mutationFn: (id: string) => api<{ count: number }>(`/pages/${id}`, { method: 'DELETE' }),
    onMutate: () => setError(null),
    onSuccess: async (_d, id) => {
      await refresh();
      if (selectedId && (id === selectedId || isAncestor(byId, id, selectedId))) router.push(spacePath(space.key));
    },
    onError,
  });
  const rename = useMutation({
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
  const create = useMutation({
    mutationFn: (v: { parentId: string | null; title: string }) =>
      api<{ id: string }>(`/spaces/${space.key}/pages`, { method: 'POST', body: v }),
    onMutate: () => setError(null),
    onSuccess: async ({ id }, v) => {
      setCreatingUnder(null);
      if (v.parentId) setExpanded((prev) => new Set(prev).add(v.parentId!));
      await refresh();
      router.push(pagePath(space.key, { id, title: v.title }));
    },
    onError,
  });

  // Geschwister mit derselben Elternseite. Oben im Baum stehen auch Seiten verschiedener
  // unsichtbarer Elternseiten; die sind untereinander keine Geschwister.
  function siblingsOf(p: TreePage): TreePage[] {
    return p.parentId && byId.has(p.parentId)
      ? (children.get(p.parentId) ?? [])
      : roots.filter((r) => r.parentId === p.parentId);
  }

  function renderItem(p: TreePage) {
    const kids = children.get(p.id) ?? [];
    const open = expanded.has(p.id);
    const sibs = siblingsOf(p);
    const i = sibs.findIndex((s) => s.id === p.id);
    const prev = sibs[i - 1];
    const next = sibs[i + 1];
    // Ausrücken nicht aus der Startseite heraus: Daneben gibt es im Baum keine sichtbare Ebene
    const parent = p.parentId && p.parentId !== homeId ? byId.get(p.parentId) : undefined;
    const editable = canEdit(p.role) && !space.archived;
    const isHome = p.id === space.homePageId;
    const busy = move.isPending || trash.isPending;
    // Elternseite unsichtbar: Umsortieren darunter verlangt editor auf ihr, das scheitert immer
    // (REVIEW.md, R-11). Einrücken unter eine sichtbare Seite und Papierkorb gehen weiter.
    const orphan = !!p.parentId && !byId.has(p.parentId);

    return (
      <li key={p.id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={p.id === selectedId}>
        <div className={`nf-tree-row${p.id === selectedId ? ' nf-selected' : ''}`}>
          <button
            type="button"
            className="nf-twisty"
            onClick={() => toggle(p.id)}
            aria-label={open ? `${p.title} zuklappen` : `${p.title} aufklappen`}
            style={{ visibility: kids.length ? 'visible' : 'hidden' }}
          >
            {open ? '▾' : '▸'}
          </button>
          <Link href={pagePath(space.key, p)} className="nf-tree-link">
            {p.title || 'Ohne Titel'}
          </Link>
          {p.restricted && (
            <span className="nf-lock" title="Eigene Rechte" aria-label="eingeschränkt">
              🔒
            </span>
          )}
          {editable && (
            <span className="nf-actions">
              <IconButton label="Neue Unterseite" onClick={() => setCreatingUnder(p.id)}>
                +
              </IconButton>
              <IconButton label="Umbenennen" disabled={rename.isPending} onClick={() => setRenaming(p.id)}>
                ✎
              </IconButton>
              {!isHome && (
                <>
                  <IconButton
                    label="Nach oben"
                    disabled={!prev || busy || orphan}
                    onClick={() => prev && move.mutate({ id: p.id, body: { parentId: p.parentId, beforeId: prev.id } })}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label="Nach unten"
                    disabled={!next || busy || orphan}
                    onClick={() => next && move.mutate({ id: p.id, body: { parentId: p.parentId, afterId: next.id } })}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    label="Einrücken (unter die vorige Seite)"
                    disabled={!prev || busy}
                    onClick={() => prev && move.mutate({ id: p.id, body: { parentId: prev.id } })}
                  >
                    →
                  </IconButton>
                  <IconButton
                    label="Ausrücken (hinter die Elternseite)"
                    disabled={!parent || busy}
                    onClick={() =>
                      parent && move.mutate({ id: p.id, body: { parentId: parent.parentId, afterId: parent.id } })
                    }
                  >
                    ←
                  </IconButton>
                  <IconButton
                    label="In den Papierkorb"
                    disabled={busy}
                    onClick={() => {
                      const n = countSubtree(children, p.id);
                      const msg =
                        n > 1
                          ? `„${p.title}“ und ${n - 1} Unterseite(n) in den Papierkorb?`
                          : `„${p.title}“ in den Papierkorb?`;
                      if (window.confirm(msg)) trash.mutate(p.id);
                    }}
                  >
                    🗑
                  </IconButton>
                </>
              )}
            </span>
          )}
        </div>
        {renaming === p.id && (
          <TitleForm
            initial={p.title}
            label="Neuer Titel"
            submitText="Umbenennen"
            busy={rename.isPending}
            onCancel={() => setRenaming(null)}
            onSubmit={(title) => (title === p.title ? setRenaming(null) : rename.mutate({ id: p.id, title }))}
          />
        )}
        {creatingUnder === p.id && (
          <TitleForm
            label="Titel der neuen Seite"
            submitText="Anlegen"
            busy={create.isPending}
            onCancel={() => setCreatingUnder(null)}
            onSubmit={(title) => create.mutate({ parentId: p.id, title })}
          />
        )}
        {kids.length > 0 && open && <ul role="group">{kids.map(renderItem)}</ul>}
      </li>
    );
  }

  return (
    <nav aria-label="Seitenbaum" className="nf-tree">
      {canEdit(space.role) && !space.archived && (
        <button
          type="button"
          className="nf-sidebar-button"
          onClick={() => setCreatingUnder(space.homePageId ?? 'root')}
        >
          + Neue Seite
        </button>
      )}
      {/* Die Startseite steht nicht im Baum: Das Formular für Seiten unter ihr kommt hierher */}
      {(creatingUnder === 'root' || (creatingUnder !== null && creatingUnder === homeId)) && (
        <TitleForm
          label="Titel der neuen Seite"
          submitText="Anlegen"
          busy={create.isPending}
          onCancel={() => setCreatingUnder(null)}
          onSubmit={(title) => create.mutate({ parentId: creatingUnder === 'root' ? null : creatingUnder, title })}
        />
      )}
      {error && (
        <p role="alert" className="nf-alert nf-alert-dark">
          {error}
        </p>
      )}
      {home && (
        <div className={`nf-tree-row nf-home-row${home.id === selectedId ? ' nf-selected' : ''}`}>
          <span className="nf-home-icon" aria-hidden="true">
            ⌂
          </span>
          <Link href={spacePath(space.key)} className="nf-tree-link">
            Startseite
          </Link>
        </div>
      )}
      <ul role="tree" aria-label={`Seiten in ${space.name}`}>
        {top.map(renderItem)}
      </ul>
    </nav>
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

function IconButton(props: { label: string; disabled?: boolean; onClick: () => void; children: string }) {
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

function countSubtree(children: Map<string, TreePage[]>, id: string): number {
  return 1 + (children.get(id) ?? []).reduce((n, c) => n + countSubtree(children, c.id), 0);
}

function isAncestor(byId: Map<string, TreePage>, ancestorId: string, id: string): boolean {
  let cur = byId.get(id);
  while (cur?.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}
