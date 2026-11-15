// Der Hocuspocus-Server mit den Hooks für NoteFieber. Ein Dokument pro Seite, Name page:<uuid>
// (CLAUDE.md, Abschnitte 6 und 7). Getrennt vom Einstiegspunkt collab.ts, damit die Tests ihn
// mit eigener Datenbank und eigenem Port starten können.
import type pg from 'pg';
import { Server } from '@hocuspocus/server';
import { authenticate } from './auth.ts';
import type { CollabContext } from './auth.ts';
import type { CollabConfig } from './config.ts';
import { loadDocument, storeDocument } from './store.ts';
import type { DocumentInfo } from './store.ts';

interface OpenDocument extends DocumentInfo {
  /** Wer seit dem letzten Speichern geschrieben hat (für editors_since_version und updated_by) */
  editors: Set<string>;
}

export function createCollabServer(
  config: Pick<
    CollabConfig,
    'COLLAB_HOST' | 'COLLAB_PORT' | 'PUBLIC_URL' | 'COLLAB_DEBOUNCE_MS' | 'COLLAB_MAX_DEBOUNCE_MS'
  >,
  db: pg.Pool,
) {
  const publicOrigin = new URL(config.PUBLIC_URL).origin;
  // Offene Dokumente mit Mandant und Space; den Space braucht später das Trennen bei Rechteänderungen
  const open = new Map<string, OpenDocument>();

  return new Server<CollabContext>({
    name: 'notefieber-collab',
    port: config.COLLAB_PORT,
    address: config.COLLAB_HOST,
    quiet: true,
    stopOnSignals: false,
    debounce: config.COLLAB_DEBOUNCE_MS,
    maxDebounce: config.COLLAB_MAX_DEBOUNCE_MS,

    async onAuthenticate({ requestHeaders, documentName, connectionConfig }) {
      const context = await authenticate(db, publicOrigin, requestHeaders, documentName);
      connectionConfig.readOnly = context.readOnly;
      return context;
    },

    async onLoadDocument({ context, document, documentName }) {
      const info: OpenDocument = {
        tenantId: context.tenantId,
        spaceId: context.spaceId,
        pageId: context.pageId,
        editors: new Set(),
      };
      await loadDocument(db, info, document);
      open.set(documentName, info);
      return document;
    },

    // Nur schreibende Verbindungen kommen hier an: Updates lesender Verbindungen verwirft
    // Hocuspocus, bevor sie das Dokument erreichen (connectionConfig.readOnly).
    async onChange({ documentName, context }) {
      if (context?.userId && !context.readOnly) open.get(documentName)?.editors.add(context.userId);
    },

    async onStoreDocument({ documentName, document }) {
      const info = open.get(documentName);
      if (!info) return;
      const editors = [...info.editors];
      info.editors.clear();
      try {
        await storeDocument(db, info, document, editors);
      } catch (err) {
        for (const e of editors) info.editors.add(e);
        throw err;
      }
    },

    async afterUnloadDocument({ documentName }) {
      open.delete(documentName);
    },
  });
}
