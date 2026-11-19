// Der Hocuspocus-Server mit den Hooks für NoteFieber. Ein Dokument pro Seite, Name page:<uuid>
// (CLAUDE.md, Abschnitte 6 und 7). Getrennt vom Einstiegspunkt collab.ts, damit die Tests ihn
// mit eigener Datenbank und eigenem Port starten können.
//
// Rechte gelten auch für offene Editoren (E04-05 bis E04-07): Bei Rechteänderungen, Papierkorb
// und Austritten (Ereignisse aus der Outbox per LISTEN, events.ts) prüft der Server die offenen
// Verbindungen im betroffenen Space neu, beim Abmelden die Verbindungen dieser Sitzung, und
// zusätzlich regelmäßig alle (abgelaufene Sitzungen, verpasste Meldungen). Hat sich der Zugang
// geändert, schließt er den WebSocket: Der Browser verbindet sich von selbst neu und meldet sich
// neu an, mit neuer Rolle (lesend oder schreibend) oder abgelehnt. Bis dahin ist die Verbindung
// schon lesend, damit nach dem Entzug nichts mehr gespeichert wird.
import type pg from 'pg';
import { Server } from '@hocuspocus/server';
import type { Connection } from '@hocuspocus/server';
import { RECONNECT_EVENTS } from '@notefieber/shared';
import { pageAccess, sessionValid } from './access.ts';
import type { Access } from './access.ts';
import { authenticate } from './auth.ts';
import type { CollabContext } from './auth.ts';
import type { CollabConfig } from './config.ts';
import { withTenant } from './db.ts';
import { listen } from './events.ts';
import type { Listener } from './events.ts';
import { loadDocument, storeDocument } from './store.ts';
import type { DocumentInfo } from './store.ts';

interface OpenDocument extends DocumentInfo {
  /** Wer seit dem letzten Speichern geschrieben hat (für editors_since_version und updated_by) */
  editors: Set<string>;
}

/** Warum der Server eine Verbindung schließt (Close-Grund im WebSocket, nur zur Diagnose) */
export type CloseReason = 'access-changed' | 'access-lost' | 'session-ended';
const CLOSE_CODE = 4000;
const reconnectEvents = new Set<string>(RECONNECT_EVENTS);

export type CollabServerConfig = Pick<
  CollabConfig,
  | 'COLLAB_HOST'
  | 'COLLAB_PORT'
  | 'PUBLIC_URL'
  | 'COLLAB_DEBOUNCE_MS'
  | 'COLLAB_MAX_DEBOUNCE_MS'
  | 'COLLAB_DATABASE_URL'
  | 'COLLAB_RECHECK_SECONDS'
>;

export function createCollab(config: CollabServerConfig, db: pg.Pool) {
  const publicOrigin = new URL(config.PUBLIC_URL).origin;
  // Offene Dokumente mit Mandant und Space (für das Neu-Prüfen nach Ereignissen im Space)
  const open = new Map<string, OpenDocument>();
  // Kennzahlen zum Speichern (Lasttest, später Metrik-Endpunkt nach ARCHITECTURE_REVIEW.md, A-12):
  // Zahl der Speichervorgänge, Fehler, Dauer in ms und Größe des gespeicherten Yjs-Zustands
  const stats = { stores: 0, storeErrors: 0, storeMs: [] as number[], ydocBytes: 0 };

  const server = new Server<CollabContext>({
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
      const started = performance.now();
      try {
        stats.ydocBytes = await storeDocument(db, info, document, editors);
        stats.stores++;
        stats.storeMs.push(performance.now() - started);
        if (stats.storeMs.length > 10_000) stats.storeMs.splice(0, stats.storeMs.length - 10_000);
      } catch (err) {
        stats.storeErrors++;
        for (const e of editors) info.editors.add(e);
        throw err;
      }
    },

    async afterUnloadDocument({ documentName }) {
      open.delete(documentName);
    },
  });

  /** Offene Verbindungen, deren Dokument `match` erfüllt */
  function connections(match: (info: OpenDocument) => boolean): Connection<CollabContext>[] {
    const out: Connection<CollabContext>[] = [];
    for (const [name, doc] of server.hocuspocus.documents) {
      const info = open.get(name);
      if (!info || !match(info)) continue;
      for (const conn of doc.connections.keys()) out.push(conn as Connection<CollabContext>);
    }
    return out;
  }

  function disconnect(conn: Connection<CollabContext>, reason: CloseReason) {
    // Sofort lesend, damit bis zum Schließen nichts mehr ins Dokument kommt (E04-05)
    conn.readOnly = true;
    if (conn.context) conn.context.readOnly = true;
    conn.webSocket.close(CLOSE_CODE, reason);
  }

  async function currentAccess(ctx: CollabContext): Promise<Access> {
    return withTenant(db, ctx.tenantId, async (client) =>
      (await sessionValid(client, ctx.sessionId)) ? (await pageAccess(client, ctx.pageId, ctx.userId)).access : 'none',
    );
  }

  /** Verbindungen neu prüfen und die schließen, deren Zugang sich geändert hat; gibt deren Zahl zurück */
  async function recheck(match: (info: OpenDocument) => boolean): Promise<number> {
    let closed = 0;
    await Promise.all(
      connections(match).map(async (conn) => {
        const ctx = conn.context;
        if (!ctx?.sessionId) return; // z. B. spätere direkte Verbindungen des Servers selbst
        try {
          const access = await currentAccess(ctx);
          if (access === 'none') {
            disconnect(conn, 'access-lost');
            closed++;
          } else if ((access !== 'write') !== conn.readOnly) {
            disconnect(conn, 'access-changed');
            closed++;
          }
        } catch (err) {
          console.error('Collab-Server: Neu-Prüfen fehlgeschlagen:', err instanceof Error ? err.message : err);
        }
      }),
    );
    return closed;
  }

  // Ereignisse kommen oft in Schüben (ein Austritt meldet jeden Space des Workspaces, ein
  // Rechtewechsel mehrere Zeilen): pro Space kurz sammeln, dann einmal prüfen.
  const pending = new Map<string, NodeJS.Timeout>();
  function onSpaceEvent(tenantId: string, spaceId: string) {
    const key = `${tenantId}:${spaceId}`;
    if (pending.has(key)) return;
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        void recheck((i) => i.tenantId === tenantId && i.spaceId === spaceId).then((n) => {
          if (n)
            console.log(`Collab-Server: ${n} Verbindung(en) nach Rechteänderung im Space ${spaceId} neu angemeldet`);
        });
      }, 100),
    );
  }

  function endSession(tenantId: string, sessionId: string): number {
    const conns = connections((i) => i.tenantId === tenantId).filter((c) => c.context?.sessionId === sessionId);
    for (const conn of conns) disconnect(conn, 'session-ended');
    return conns.length;
  }

  const recheckAll = () => recheck(() => true);

  let listener: Listener | undefined;
  let timer: NodeJS.Timeout | undefined;

  return {
    server,
    stats,
    recheck,
    recheckAll,
    endSession,
    /** Lauschen, LISTEN starten, regelmäßig alle prüfen */
    async start() {
      await server.listen();
      listener = listen(config.COLLAB_DATABASE_URL, {
        onEvent: (e) => {
          if (reconnectEvents.has(e.type)) onSpaceEvent(e.tenant, e.space);
        },
        onSessionEnded: (e) => {
          const n = endSession(e.tenant, e.session);
          if (n) console.log(`Collab-Server: ${n} Verbindung(en) nach Abmelden geschlossen`);
        },
        onReconnect: () => void recheckAll(),
      });
      await listener.ready;
      // Abgelaufene Sitzungen und Meldungen, die trotz allem verloren gingen (E04-06: spätestens 5 Minuten)
      timer = setInterval(() => {
        void recheckAll().then((n) => {
          if (n) console.log(`Collab-Server: ${n} Verbindung(en) bei der regelmäßigen Prüfung neu angemeldet`);
        });
      }, config.COLLAB_RECHECK_SECONDS * 1000);
    },
    /** Alle offenen Dokumente speichern (Hocuspocus destroy), dann LISTEN beenden */
    async stop() {
      clearInterval(timer);
      for (const t of pending.values()) clearTimeout(t);
      await server.destroy();
      await listener?.stop();
    },
  };
}

export type Collab = ReturnType<typeof createCollab>;
