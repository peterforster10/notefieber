// Interner Aufruf an den Collab-Server (CLAUDE.md, Abschnitt 6; ARCHITECTURE_REVIEW.md, A-07):
// Änderungen am Yjs-Dokument von der Serverseite, über Hocuspocus openDirectConnection, damit offene
// Browser sie sofort sehen und der Collab-Server sie wie jede Änderung speichert (app.store_ydoc).
// Als Erstes: Umbenennen aus der Seitenleiste (E04-08). Später Version wiederherstellen,
// Nacharbeiten nach dem Import, Vorlagen.
//
// Eigener HTTP-Server auf eigenem Port (COLLAB_INTERNAL_PORT), nicht über den Ingress erreichbar,
// dazu ein geteiltes Geheimnis (COLLAB_INTERNAL_SECRET). Die Rechte prüft die API vorher; hier nur,
// dass die Seite im genannten Mandanten liegt und nicht im Papierkorb.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { TITLE_TEXT, documentName, setTitle } from '@notefieber/editor-schema';
import { INTERNAL_SECRET_HEADER, idSchema, internalTitleSchema } from '@notefieber/shared';
import type { CollabContext } from './auth.ts';
import { withContext } from '@notefieber/shared/db';
import type { Collab } from './server.ts';

export interface InternalConfig {
  host: string;
  port: number;
  secret: string;
}

const TITLE_PATH = /^\/internal\/v1\/pages\/([^/]+)\/title$/;

function secretMatches(given: string | string[] | undefined, secret: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: http.IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('zu groß');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res: http.ServerResponse, status: number, body?: object) {
  res.writeHead(status, body ? { 'content-type': 'application/json' } : {});
  res.end(body ? JSON.stringify(body) : undefined);
}

/** Titel einer Seite setzen, wie es ein Browser im Editor täte (Y.Text "title") */
export async function renamePage(
  collab: Collab,
  db: pg.Pool,
  tenantId: string,
  userId: string,
  pageId: string,
  title: string,
) {
  const page = await withContext(db, { tenantId }, async (c) => {
    const r = await c.query<{ space_id: string; trashed: boolean }>(
      'SELECT space_id, deleted_at IS NOT NULL AS trashed FROM pages WHERE id = $1',
      [pageId],
    );
    return r.rows[0];
  });
  if (!page) return 'not-found' as const;
  if (page.trashed) return 'trashed' as const;
  // Kontext wie bei einer schreibenden Verbindung dieser Person, ohne Sitzung: Das Neu-Prüfen nach
  // Rechteänderungen übergeht direkte Verbindungen, onChange zählt die Person zu den Bearbeitenden
  const context: CollabContext = { tenantId, userId, sessionId: '', pageId, spaceId: page.space_id, readOnly: false };
  const conn = await collab.server.hocuspocus.openDirectConnection(documentName(pageId), context);
  try {
    await conn.transact((doc) => setTitle(doc.getText(TITLE_TEXT), title.trim()));
  } finally {
    // Speichert sofort (app.store_ydoc), danach steht der neue Titel auch in pages.title.
    // Fehler dabei fängt Hocuspocus ab; das Ergebnis steht in context.storeResult (server.ts).
    await conn.disconnect();
  }
  // Inzwischen im Papierkorb: nichts gespeichert, nicht als Erfolg melden (REVIEW_M1.md, R-22)
  if (context.storeResult === 'trashed') return 'trashed' as const;
  if (context.storeResult !== 'stored') throw new Error(`Titel der Seite ${pageId} nicht gespeichert`);
  return 'ok' as const;
}

export function startInternal(collab: Collab, db: pg.Pool, config: InternalConfig) {
  const server = http.createServer((req, res) => {
    void (async () => {
      if (!secretMatches(req.headers[INTERNAL_SECRET_HEADER], config.secret))
        return send(res, 401, { error: 'unauthorized' });
      const match = TITLE_PATH.exec(req.url ?? '');
      if (!match || req.method !== 'POST') return send(res, 404, { error: 'not_found' });
      const pageId = idSchema.safeParse(match[1]);
      const body = internalTitleSchema.safeParse(await readJson(req).catch(() => undefined));
      if (!pageId.success || !body.success) return send(res, 400, { error: 'invalid_request' });
      const result = await renamePage(collab, db, body.data.tenantId, body.data.userId, pageId.data, body.data.title);
      if (result === 'not-found') return send(res, 404, { error: 'not_found' });
      if (result === 'trashed') return send(res, 409, { error: 'trashed' });
      send(res, 204);
    })().catch((err: unknown) => {
      console.error('Collab-Server: interner Aufruf fehlgeschlagen:', err instanceof Error ? err.message : err);
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });
  return new Promise<http.Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve(server));
  });
}
