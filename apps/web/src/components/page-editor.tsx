'use client';

// Editor einer Seite: BlockNote im Browser, verbunden mit dem Collab-Server (Hocuspocus) über
// das Yjs-Dokument page:<uuid> (CLAUDE.md, Abschnitte 6 und 7). Angemeldet wird über das
// Sitzungs-Cookie, das der Browser beim WebSocket-Handshake mitschickt; die Rolle entscheidet der
// Collab-Server (lesend oder schreibend). Titel im Y.Text "title", Inhalt im Y.XmlFragment
// "content", beides aus packages/editor-schema, damit Worker und Import dasselbe sehen.
// Nur im Browser geladen (next/dynamic mit ssr: false, siehe space-view.tsx).
import '@blocknote/mantine/style.css';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { de } from '@blocknote/core/locales';
import { withCollaboration } from '@blocknote/core/yjs';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { CONTENT_FRAGMENT, TITLE_MAX_LENGTH, TITLE_TEXT, documentName, schema } from '@notefieber/editor-schema';

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

const DENIED: Record<string, string> = {
  forbidden: 'Kein Zugriff auf diese Seite.',
  unauthenticated: 'Abgemeldet. Bitte neu anmelden.',
};

export function PageEditor(props: {
  pageId: string;
  user: EditorUser;
  /** Darf die Person laut API bearbeiten (Rolle editor oder admin)? Der Collab-Server entscheidet zusätzlich. */
  mayEdit: boolean;
  trashed: boolean;
  fallbackTitle: string;
  /** Titel im Yjs-Dokument geändert (von wem auch immer) */
  onTitleChange?: (title: string) => void;
  /** Zusätzliches im Kopfbereich neben dem Titel, z. B. das Schloss */
  titleAddon?: React.ReactNode;
}) {
  const { pageId } = props;
  const [conn, setConn] = useState<Connection>();
  const [status, setStatus] = useState<Status>('connecting');
  const [scope, setScope] = useState<Scope>();
  const [denied, setDenied] = useState<string>();

  // Eine Verbindung pro Seite (die Komponente hat die Seiten-ID als key, wird also pro Seite neu
  // aufgebaut); beim Verlassen wieder abbauen. Der Editor erscheint erst nach dem ersten Abgleich,
  // sonst legte BlockNote in ein noch leeres Dokument einen eigenen Anfangsblock.
  useEffect(() => {
    let alive = true;
    const doc = new Y.Doc();
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
      },
      onAuthenticationFailed: ({ reason }) => alive && setDenied(reason),
      onSynced: () => alive && setConn((c) => c ?? { doc, provider }),
    });
    return () => {
      alive = false;
      provider.destroy();
      doc.destroy();
    };
  }, [pageId]);

  if (denied) {
    // Kein Zugriff (mehr): nichts vom Inhalt zeigen (E04-05)
    return (
      <>
        <h1>{props.fallbackTitle || 'Ohne Titel'}</h1>
        <p role="alert" className="nf-alert">
          {DENIED[denied] ?? 'Der Editor konnte nicht verbunden werden.'}
        </p>
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
      conn={conn}
      user={props.user}
      editable={editable}
      onTitleChange={props.onTitleChange}
      titleAddon={props.titleAddon}
      notice={
        // Erst nach dem ersten Abgleich sichtbar: alles außer verbunden heißt jetzt Funkloch
        status !== 'connected'
          ? 'Offline. Änderungen werden übertragen, sobald die Verbindung zurück ist.'
          : props.trashed
            ? 'Diese Seite liegt im Papierkorb und kann nicht bearbeitet werden.'
            : scope === 'readonly' && props.mayEdit
              ? 'Nur lesend verbunden.'
              : undefined
      }
    />
  );
}

function CollabEditor({
  conn,
  user,
  editable,
  notice,
  onTitleChange,
  titleAddon,
}: {
  conn: Connection;
  user: EditorUser;
  editable: boolean;
  notice?: string;
  onTitleChange?: (title: string) => void;
  titleAddon?: React.ReactNode;
}) {
  const { doc, provider } = conn;
  const color = colorFor(user.id);
  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      dictionary: de,
      collaboration: {
        provider: { awareness: provider.awareness ?? undefined },
        fragment: doc.getXmlFragment(CONTENT_FRAGMENT),
        user: { name: user.name, color },
        showCursorLabels: 'activity',
      },
    }),
    [doc, provider],
  );

  // Anwesenheit: wer die Seite offen hat, auch Lesende (E04-02). Die eigene ID für die Liste.
  useEffect(() => {
    provider.awareness?.setLocalStateField('person', { id: user.id, name: user.name, color });
  }, [provider, user.id, user.name, color]);

  return (
    <div className="nf-editor">
      <div className="nf-editor-head">
        <TitleField text={doc.getText(TITLE_TEXT)} editable={editable} onChange={onTitleChange} />
        {titleAddon}
        <Presence provider={provider} selfId={user.id} />
      </div>
      {notice && <p className="nf-notice">{notice}</p>}
      <BlockNoteView editor={editor} editable={editable} theme="light" />
    </div>
  );
}

/** Kleinste Änderung von a nach b, damit gleichzeitiges Tippen im Titel zusammenpasst */
function applyDiff(text: Y.Text, next: string) {
  const prev = text.toString();
  if (prev === next) return;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  text.doc?.transact(() => {
    if (endPrev > start) text.delete(start, endPrev - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  });
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
        onChange={(e) => applyDiff(text, e.target.value.slice(0, TITLE_MAX_LENGTH))}
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
