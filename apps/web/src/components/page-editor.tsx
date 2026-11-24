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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { de, en } from '@blocknote/core/locales';
import { withCollaboration } from '@blocknote/core/yjs';
import { syntaxHighlighter } from '@blocknote/code-block';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { apiError, type ApiErrorBody } from '@/lib/api';
import { useErrorText } from '@/lib/errors';
import type { Locale } from '@/i18n/locales';
import { clearLocalCopy, closeLocalCopy, openLocalCopy } from '@/lib/local-copies';
import { colorFor } from '@/lib/person-color';
import { forgetNewPage, isNewPage } from '@/lib/new-page';
import { CONTENT_FRAGMENT, TITLE_MAX_LENGTH, TITLE_TEXT, documentName, setTitle } from '@notefieber/editor-schema';
import { EditorMenus } from './editor/menus';
import { usePresence, type PersonState } from './presence';
import { browserSchema, setEditorTexts, setPageLinkNavigator, type EditorTexts } from './editor/schema';

/** Wörterbücher von BlockNote (Menüs, Platzhalter, Tabellen …) pro Sprache der Oberfläche */
const DICTIONARIES = { de, en } satisfies Record<Locale, unknown>;

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

/** Text zur Ablehnung des Collab-Servers; `before`: der Editor war schon offen (Recht entzogen, abgemeldet) */
function deniedText(t: ReturnType<typeof useTranslations<'editor'>>, reason: string, before: boolean): string {
  if (reason === 'forbidden') return before ? t('forbiddenNow') : t('forbidden');
  if (reason === 'unauthenticated') return t('unauthenticated');
  return t('connectFailed');
}

/** Bild an die Seite hochladen (E07, E11); die Adresse kommt in den Bild-Block */
async function uploadImage(pageId: string, file: File): Promise<string> {
  const res = await fetch(`/api/v1/pages/${pageId}/files`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
    body: file,
  });
  const data = (await res.json().catch(() => undefined)) as (ApiErrorBody & { url?: string }) | undefined;
  if (!res.ok || !data?.url) throw apiError(res.status, data);
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
  /** Über dem Titel, z. B. der Hinweis „Eingeschränkt“ */
  beforeTitle?: React.ReactNode;
  /** Unter dem Titel, z. B. Rolle und Papierkorb */
  afterTitle?: React.ReactNode;
  /** Wer die Seite gerade offen hat (Awareness); leer, solange keine Verbindung besteht */
  onPresence?: (people: PersonState[]) => void;
  /**
   * Der Collab-Server hat die Verbindung neu angemeldet oder abgelehnt (Rechte geändert, Papierkorb,
   * abgemeldet): Seitendaten der API neu laden, damit Rolle und Papierkorb wieder stimmen.
   */
  onAccessChange?: () => void;
  /** Seite aus dem Papierkorb holen (nur für Bearbeitende angeboten, E04-07) */
  onRestore?: () => Promise<unknown>;
}) {
  const { pageId, onAccessChange } = props;
  const t = useTranslations('editor');
  const common = useTranslations('common');
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
        <h1 className="nf-title">
          {denied === 'forbidden' && conn ? t('noAccess') : props.fallbackTitle || common('untitled')}
        </h1>
        <p role="alert" className="nf-alert">
          {deniedText(t, denied, !!conn)}
        </p>
        {denied === 'unauthenticated' && (
          <button type="button" className="nf-button" onClick={() => window.location.reload()}>
            {t('signInAgain')}
          </button>
        )}
      </>
    );
  }
  if (!conn) {
    return (
      <>
        {props.beforeTitle}
        <h1 className="nf-title">{props.fallbackTitle || common('untitled')}</h1>
        {props.afterTitle}
        <p className="nf-muted" role="status">
          {status === 'disconnected' ? t('collabUnreachable') : t('connecting')}
        </p>
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
      beforeTitle={props.beforeTitle}
      afterTitle={props.afterTitle}
      onPresence={props.onPresence}
      notice={
        // Erst nach dem ersten Abgleich sichtbar: alles außer verbunden heißt jetzt Funkloch
        status !== 'connected' ? (
          t('offline')
        ) : props.trashed ? (
          <TrashNotice canRestore={props.mayEdit} onRestore={props.onRestore} />
        ) : scope === 'readonly' && props.mayEdit ? (
          t('readOnly')
        ) : undefined
      }
    />
  );
}

/** Seite im Papierkorb (E04-07): nur lesbar; wer bearbeiten darf, holt sie hier zurück */
function TrashNotice({ canRestore, onRestore }: { canRestore: boolean; onRestore?: () => Promise<unknown> }) {
  const t = useTranslations('editor');
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      {t('trashed')}
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
                .catch((err: unknown) => setError(errorText(err)))
                .finally(() => setBusy(false));
            }}
          >
            {t('restore')}
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
  beforeTitle,
  afterTitle,
  onPresence,
}: {
  pageId: string;
  spaceKey: string;
  conn: Connection;
  user: EditorUser;
  editable: boolean;
  notice?: React.ReactNode;
  onTitleChange?: (title: string) => void;
  beforeTitle?: React.ReactNode;
  afterTitle?: React.ReactNode;
  onPresence?: (people: PersonState[]) => void;
}) {
  const { doc, provider } = conn;
  const color = colorFor(user.id);
  const locale = useLocale();
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const callout = useTranslations('callout');
  // Vor dem Editor setzen: Blöcke und Inline-Inhalte lesen die Texte beim Rendern (editor/schema.tsx)
  const texts = useMemo<EditorTexts>(
    () => ({
      untitled: common('untitled'),
      calloutKind: t('calloutKind'),
      callout: {
        info: callout('info'),
        note: callout('note'),
        success: callout('success'),
        warning: callout('warning'),
        error: callout('error'),
      },
      pageUnavailable: t('pageUnavailable'),
      pageUnavailableHint: t('pageUnavailableHint'),
      pageInTrash: (title) => t('pageInTrash', { title }),
      mentionUnknown: t('mentionUnknown'),
      mentionHidden: t('mentionHidden'),
      deactivated: (name) => t('deactivated', { name }),
      toc: t('toc'),
      tocTitle: t('tocTitle'),
      tocEmpty: t('tocEmpty'),
    }),
    [t, common, callout],
  );
  setEditorTexts(texts);
  // Neue Sprache: neuer Editor mit dem anderen Wörterbuch; der Inhalt liegt in Yjs, es geht nichts verloren
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: browserSchema,
      dictionary: DICTIONARIES[locale],
      extensions: [syntaxHighlighter],
      // Das Eingabefeld des Inhalts braucht einen Namen für Screenreader (WCAG 4.1.2)
      domAttributes: { editor: { 'aria-label': t('contentLabel') } },
      uploadFile: (file: File) => uploadImage(pageId, file),
      collaboration: {
        provider: { awareness: provider.awareness ?? undefined },
        fragment: doc.getXmlFragment(CONTENT_FRAGMENT),
        user: { name: user.name, color },
        showCursorLabels: 'activity',
      },
    }),
    [doc, provider, pageId, locale],
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

  // Gerade über „+“ angelegt: Cursor in den leeren Titel (lib/new-page.ts), nur beim ersten Öffnen
  const [titleFirst] = useState(() => isNewPage(pageId));
  useEffect(() => {
    if (titleFirst) forgetNewPage(pageId);
  }, [titleFirst, pageId]);

  // Liste der Anwesenden an den Kopfbereich; beim Verlassen (andere Seite, kein Zugriff mehr) leeren
  const people = usePresence(provider, user.id);
  const presenceChanged = useRef(onPresence);
  useEffect(() => {
    presenceChanged.current = onPresence;
  }, [onPresence]);
  useEffect(() => presenceChanged.current?.(people), [people]);
  useEffect(() => () => presenceChanged.current?.([]), []);

  // Enter im Titel: oben im Inhalt eine neue, leere Zeile und den Cursor hinein (wie in Confluence
  // und Notion). Ist die erste Zeile schon ein leerer Absatz (neue Seite), nur dorthin springen,
  // statt leere Zeilen zu stapeln.
  const startWriting = useCallback(() => {
    const first = editor.document[0];
    const emptyParagraph = first?.type === 'paragraph' && Array.isArray(first.content) && first.content.length === 0;
    const target = emptyParagraph
      ? first
      : first
        ? editor.insertBlocks([{ type: 'paragraph' }], first, 'before')[0]
        : undefined;
    editor.focus();
    if (target) editor.setTextCursorPosition(target, 'start');
  }, [editor]);

  return (
    <div className="nf-editor">
      {beforeTitle}
      <TitleField
        text={doc.getText(TITLE_TEXT)}
        editable={editable}
        autoFocus={titleFirst}
        onChange={onTitleChange}
        onEnter={startWriting}
      />
      {afterTitle}
      {notice && (
        <p className="nf-notice" role="status">
          {notice}
        </p>
      )}
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
  autoFocus,
  onChange,
  onEnter,
}: {
  text: Y.Text;
  editable: boolean;
  /** Cursor gleich in den Titel (neue Seite über „+“) */
  autoFocus?: boolean;
  onChange?: (title: string) => void;
  /** Enter im Titel: weiter in den Inhalt */
  onEnter?: () => void;
}) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const title = useYText(text);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange?.(title);
  }, [title, onChange]);

  if (!editable) return <h1 className="nf-title">{title || common('untitled')}</h1>;
  return (
    <h1 className="nf-title">
      <input
        aria-label={t('titleLabel')}
        className="nf-title-input"
        autoFocus={autoFocus}
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        placeholder={common('untitled')}
        onChange={(e) => setTitle(text, e.target.value)}
        onKeyDown={(e) => {
          // Nicht während einer Eingabe mit IME (z. B. Japanisch), dort bestätigt Enter die Auswahl
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || !onEnter) return;
          e.preventDefault();
          onEnter();
        }}
      />
    </h1>
  );
}
