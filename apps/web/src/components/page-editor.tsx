'use client';

// Editor einer Seite: BlockNote im Browser, verbunden mit dem Collab-Server (Hocuspocus) über
// das Yjs-Dokument page:<uuid> (CLAUDE.md, Abschnitte 6 und 7). Angemeldet wird über das
// Sitzungs-Cookie, das der Browser beim WebSocket-Handshake mitschickt; die Rolle entscheidet der
// Collab-Server (lesend oder schreibend). Titel im Y.Text "title", Inhalt im Y.XmlFragment
// "content", beides aus packages/editor-schema, damit Worker und Import dasselbe sehen.
// Blöcke (M2, E07): Schema aus editor/schema.tsx (gemeinsames Schema, Callout und Seitenlink mit
// React-Darstellung), Menüs aus editor/menus.tsx, Bilder über die API (POST /pages/:id/files),
// Code mit Hervorhebung (@blocknote/code-block, nur Darstellung).
// Nur im Browser geladen (next/dynamic mit ssr: false, siehe space-view.tsx).
import '@blocknote/mantine/style.css';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { de } from '@blocknote/core/locales';
import { withCollaboration } from '@blocknote/core/yjs';
import { syntaxHighlighter } from '@blocknote/code-block';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { ApiError } from '@/lib/api';
import { clearLocalCopy, closeLocalCopy, openLocalCopy } from '@/lib/local-copies';
import { CONTENT_FRAGMENT, TITLE_MAX_LENGTH, TITLE_TEXT, documentName, setTitle } from '@notefieber/editor-schema';
import { EditorMenus } from './editor/menus';
import { browserSchema, setPageLinkNavigator } from './editor/schema';

export interface EditorUser {
  id: string;
  name: string;
}

type Status = 'connecting' | 'connected' | 'disconnected';
type Scope = 'readonly' | 'read-write';

interface Connection {
  doc: Y.Doc;
  provider: HocuspocusProvider;
}

/**
 * Adresse des Collab-Servers. Im Cluster dieselbe Adresse wie das Frontend unter /collab
 * (Ingress), deshalb zur Laufzeit aus der Adresse der Seite; lokal läuft er auf eigenem Port
 * (NEXT_PUBLIC_COLLAB_URL, z. B. ws://localhost:1234). Das Cookie gilt für den Host, nicht den Port.
 */
function collabUrl(): string {
  const configured = process.env.NEXT_PUBLIC_COLLAB_URL;
  if (configured) return configured;
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/collab`;
}

/** Farbe pro Person, stabil über Sitzungen hinweg (aus der ID) */
const COLORS = ['#1F5FD6', '#C2410C', '#1E5135', '#7C3AED', '#B45309', '#0E7490', '#BE185D', '#4D7C0F'];
export function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/** Text zur Ablehnung des Collab-Servers; `before`: der Editor war schon offen (Recht entzogen, abgemeldet) */
function deniedText(reason: string, before: boolean): string {
  if (reason === 'forbidden') return before ? 'Kein Zugriff mehr auf diese Seite.' : 'Kein Zugriff auf diese Seite.';
  if (reason === 'unauthenticated') return 'Abgemeldet. Bitte neu anmelden.';
  return 'Der Editor konnte nicht verbunden werden.';
}

/** Bild an die Seite hochladen (E07, E11); die Adresse kommt in den Bild-Block */
async function uploadImage(pageId: string, file: File): Promise<string> {
  const res = await fetch(`/api/v1/pages/${pageId}/files`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });
  const data = (await res.json().catch(() => undefined)) as { url?: string; message?: string } | undefined;
  if (!res.ok || !data?.url) throw new ApiError(res.status, data?.message ?? `Fehler ${res.status}`);
  return data.url;
}

export function PageEditor(props: {
  pageId: string;
  /** Space der Seite: die Seitensuche hinter „[“ zeigt seine Seiten zuerst */
  spaceKey: string;
  user: EditorUser;
  /** Darf die Person laut API bearbeiten (Rolle editor oder admin)? Der Collab-Server entscheidet zusätzlich. */
  mayEdit: boolean;
  trashed: boolean;
  fallbackTitle: string;
  /** Titel im Yjs-Dokument geändert (von wem auch immer) */
  onTitleChange?: (title: string) => void;
  /** Zusätzliches im Kopfbereich neben dem Titel, z. B. das Schloss */
  titleAddon?: React.ReactNode;
  /**
   * Der Collab-Server hat die Verbindung neu angemeldet oder abgelehnt (Rechte geändert, Papierkorb,
   * abgemeldet): Seitendaten der API neu laden, damit Rolle und Papierkorb wieder stimmen.
   */
  onAccessChange?: () => void;
  /** Seite aus dem Papierkorb holen (nur für Bearbeitende angeboten, E04-07) */
  onRestore?: () => Promise<unknown>;
}) {
  const { pageId, onAccessChange } = props;
  const router = useRouter();
  useEffect(() => setPageLinkNavigator((href) => router.push(href)), [router]);
  const userId = props.user.id;
  const [conn, setConn] = useState<Connection>();
  const [status, setStatus] = useState<Status>('connecting');
  const [scope, setScope] = useState<Scope>();
  const [denied, setDenied] = useState<string>();
  const accessChanged = useRef(onAccessChange);
  useEffect(() => {
    accessChanged.current = onAccessChange;
  }, [onAccessChange]);

  // Eine Verbindung pro Seite (die Komponente hat die Seiten-ID als key, wird also pro Seite neu
  // aufgebaut); beim Verlassen wieder abbauen. Der Editor erscheint erst nach dem ersten Abgleich,
  // sonst legte BlockNote in ein noch leeres Dokument einen eigenen Anfangsblock.
  // Daneben die lokale Kopie in IndexedDB (lib/local-copies.ts, E04-04): Was bei einem Funkloch
  // noch nicht übertragen war, übersteht ein Neuladen und geht beim nächsten Verbinden hinaus.
  useEffect(() => {
    let alive = true;
    let authentications = 0;
    const doc = new Y.Doc();
    const local = openLocalCopy(userId, pageId, doc);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: documentName(pageId),
      document: doc,
      token: '', // angemeldet wird über das Cookie, nicht über ein Token
      onStatus: ({ status: s }) => alive && setStatus(s as Status),
      onAuthenticated: ({ scope: s }) => {
        if (!alive) return;
        setDenied(undefined);
        setScope(s as Scope);
        // Jede Anmeldung nach der ersten heißt: Der Server hat die Verbindung geschlossen, weil sich
        // der Zugang geändert hat (oder das Netz war weg); Rolle und Papierkorb neu laden
        if (authentications++ > 0) accessChanged.current?.();
      },
      onAuthenticationFailed: ({ reason }) => {
        if (!alive) return;
        setDenied(reason);
        accessChanged.current?.();
        // Kein Leserecht mehr: auch die lokale Kopie weg. Abgemeldet: Das Löschen übernimmt der
        // Tab, in dem abgemeldet wurde (clearAllLocalCopies), hier nur die Verbindung schließen.
        if (reason === 'forbidden') void clearLocalCopy(local);
        else closeLocalCopy(local);
      },
      onSynced: () => alive && setConn((c) => c ?? { doc, provider }),
    });
    return () => {
      alive = false;
      provider.destroy();
      closeLocalCopy(local);
      doc.destroy();
    };
  }, [pageId, userId]);

  if (denied) {
    // Kein Zugriff (mehr) oder abgemeldet: nichts vom Inhalt zeigen, auch nicht den Titel aus Yjs
    // (E04-05, E04-06). Der Titel aus der API ist der zuletzt gesehene.
    return (
      <>
        <h1>{denied === 'forbidden' && conn ? 'Kein Zugriff' : props.fallbackTitle || 'Ohne Titel'}</h1>
        <p role="alert" className="nf-alert">
          {deniedText(denied, !!conn)}
        </p>
        {denied === 'unauthenticated' && (
          <button type="button" onClick={() => window.location.reload()}>
            Neu anmelden
          </button>
        )}
      </>
    );
  }
  if (!conn) {
    return (
      <>
        <h1>{props.fallbackTitle || 'Ohne Titel'}</h1>
        <p className="nf-muted">{status === 'disconnected' ? 'Collab-Server nicht erreichbar …' : 'Verbinde …'}</p>
      </>
    );
  }

  const editable = scope === 'read-write' && props.mayEdit && !props.trashed;
  return (
    <CollabEditor
      key={pageId}
      pageId={pageId}
      spaceKey={props.spaceKey}
      conn={conn}
      user={props.user}
      editable={editable}
      onTitleChange={props.onTitleChange}
      titleAddon={props.titleAddon}
      notice={
        // Erst nach dem ersten Abgleich sichtbar: alles außer verbunden heißt jetzt Funkloch
        status !== 'connected' ? (
          'Offline. Änderungen werden übertragen, sobald die Verbindung zurück ist.'
        ) : props.trashed ? (
          <TrashNotice canRestore={props.mayEdit} onRestore={props.onRestore} />
        ) : scope === 'readonly' && props.mayEdit ? (
          'Nur lesend verbunden.'
        ) : undefined
      }
    />
  );
}

/** Seite im Papierkorb (E04-07): nur lesbar; wer bearbeiten darf, holt sie hier zurück */
function TrashNotice({ canRestore, onRestore }: { canRestore: boolean; onRestore?: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      Diese Seite liegt im Papierkorb und kann nicht bearbeitet werden.
      {canRestore && onRestore && (
        <>
          {' '}
          <button
            type="button"
            className="nf-link-button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(undefined);
              onRestore()
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false));
            }}
          >
            Wiederherstellen
          </button>
        </>
      )}
      {error && <span role="alert"> {error}</span>}
    </>
  );
}

function CollabEditor({
  pageId,
  spaceKey,
  conn,
  user,
  editable,
  notice,
  onTitleChange,
  titleAddon,
}: {
  pageId: string;
  spaceKey: string;
  conn: Connection;
  user: EditorUser;
  editable: boolean;
  notice?: React.ReactNode;
  onTitleChange?: (title: string) => void;
  titleAddon?: React.ReactNode;
}) {
  const { doc, provider } = conn;
  const color = colorFor(user.id);
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: browserSchema,
      dictionary: de,
      extensions: [syntaxHighlighter],
      uploadFile: (file: File) => uploadImage(pageId, file),
      collaboration: {
        provider: { awareness: provider.awareness ?? undefined },
        fragment: doc.getXmlFragment(CONTENT_FRAGMENT),
        user: { name: user.name, color },
        showCursorLabels: 'activity',
      },
    }),
    [doc, provider, pageId],
  );

  // Anwesenheit: wer die Seite offen hat, auch Lesende (E04-02). Die eigene ID für die Liste.
  // Neu setzen, sobald sie fehlt: Beim Neuanmelden nach einer Rechteänderung und beim Wechsel
  // zwischen lesend und schreibend räumen Provider bzw. BlockNote den eigenen Zustand teils ab.
  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const person = { id: user.id, name: user.name, color };
    const ensure = () => {
      const own = awareness.getLocalState() as { person?: { id?: string } } | null;
      if (own?.person?.id !== person.id) awareness.setLocalStateField('person', person);
    };
    ensure();
    awareness.on('change', ensure);
    provider.on('synced', ensure);
    return () => {
      awareness.off('change', ensure);
      provider.off('synced', ensure);
    };
  }, [provider, user.id, user.name, color]);

  return (
    <div className="nf-editor">
      <div className="nf-editor-head">
        <TitleField text={doc.getText(TITLE_TEXT)} editable={editable} onChange={onTitleChange} />
        {titleAddon}
        <Presence provider={provider} selfId={user.id} />
      </div>
      {notice && <p className="nf-notice">{notice}</p>}
      <BlockNoteView editor={editor} editable={editable} theme="light" slashMenu={false} filePanel={false}>
        <EditorMenus editor={editor} spaceKey={spaceKey} />
      </BlockNoteView>
    </div>
  );
}

function useYText(text: Y.Text): string {
  return useSyncExternalStore(
    (cb) => {
      text.observe(cb);
      return () => text.unobserve(cb);
    },
    () => text.toString(),
  );
}

function TitleField({
  text,
  editable,
  onChange,
}: {
  text: Y.Text;
  editable: boolean;
  onChange?: (title: string) => void;
}) {
  const title = useYText(text);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange?.(title);
  }, [title, onChange]);

  if (!editable) return <h1 className="nf-title">{title || 'Ohne Titel'}</h1>;
  return (
    <h1 className="nf-title">
      <input
        aria-label="Titel"
        className="nf-title-input"
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        placeholder="Ohne Titel"
        onChange={(e) => setTitle(text, e.target.value)}
      />
    </h1>
  );
}

interface PersonState {
  id: string;
  name: string;
  color: string;
}

/** Avatare aller, die die Seite offen haben (Awareness, nie gespeichert) */
function Presence({ provider, selfId }: { provider: HocuspocusProvider; selfId: string }) {
  const awareness = provider.awareness;
  const [people, setPeople] = useState<PersonState[]>([]);
  useEffect(() => {
    if (!awareness) return;
    const update = () => {
      const byId = new Map<string, PersonState>();
      for (const state of awareness.getStates().values()) {
        const p = (state as { person?: PersonState }).person;
        if (p?.id) byId.set(p.id, p); // eine Person mit zwei Tabs nur einmal
      }
      setPeople([...byId.values()].sort((a, b) => (a.id === selfId ? -1 : b.id === selfId ? 1 : 0)));
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [awareness, selfId]);

  const shown = useMemo(() => people.slice(0, 6), [people]);
  if (people.length === 0) return null;
  return (
    <ul className="nf-presence" aria-label="Gerade auf dieser Seite">
      {shown.map((p) => (
        <li key={p.id} title={p.id === selfId ? `${p.name} (du)` : p.name} style={{ background: p.color }}>
          {initials(p.name)}
        </li>
      ))}
      {people.length > shown.length && <li className="nf-presence-more">+{people.length - shown.length}</li>}
    </ul>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() || '?';
}
