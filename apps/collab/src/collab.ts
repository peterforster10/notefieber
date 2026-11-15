// Collab-Server (Hocuspocus): Yjs-Sync, Cursor, Anwesenheit. Ein Dokument pro Seite,
// Name page:<uuid> (CLAUDE.md, Abschnitte 6 und 7). Verbindet sich als wiki_worker.
//
// Grundgerüst: Der Server startet und prüft seine Datenbankrolle, lässt aber noch niemanden
// herein. onAuthenticate (Rolle über die API), onLoadDocument und onStoreDocument
// (app.store_ydoc) kommen mit E04; bis dahin wird jede Verbindung abgelehnt.
import pg from 'pg';
import { z } from 'zod';
import { Server } from '@hocuspocus/server';
import { assertDbRole } from '@notefieber/shared';

const config = z
  .object({
    COLLAB_PORT: z.coerce.number().int().min(1).max(65535).default(1234),
    COLLAB_DATABASE_URL: z.string().min(1, 'COLLAB_DATABASE_URL fehlt (Login-Rolle in wiki_worker)'),
  })
  .parse(process.env);

const db = new pg.Pool({ connectionString: config.COLLAB_DATABASE_URL, application_name: 'notefieber-collab', max: 5 });
try {
  const login = await assertDbRole(db, 'wiki_worker');
  console.log(`Datenbank: verbunden als ${login} (wiki_worker)`);
} catch (err) {
  console.error(`Datenbank: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = new Server({
  name: 'notefieber-collab',
  port: config.COLLAB_PORT,
  address: '127.0.0.1',
  quiet: true,
  stopOnSignals: true,
  async onAuthenticate({ documentName }) {
    throw new Error(`Anmeldung am Collab-Server noch nicht gebaut (E04), abgelehnt: ${documentName}`);
  },
  async onDestroy() {
    await db.end();
  },
});

await server.listen();
console.log(`Collab-Server: ${server.webSocketURL} (lehnt bis E04 alle Verbindungen ab)`);
