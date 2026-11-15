// Collab-Server (Hocuspocus): Yjs-Sync, Cursor, Anwesenheit. Ein Dokument pro Seite,
// Name page:<uuid> (CLAUDE.md, Abschnitte 6 und 7). Verbindet sich als wiki_worker.
// Anmeldung über das Sitzungs-Cookie (auth.ts), Laden und Speichern in store.ts, die Hooks in
// server.ts. Noch nicht hier (M1, Stück 2 und 3): Trennen bei Rechteänderungen (LISTEN/NOTIFY),
// Abmelden in anderen Tabs, interner Aufruf für Änderungen von der Serverseite.
import pg from 'pg';
import { assertDbRole } from '@notefieber/shared';
import { collabConfig } from './config.ts';
import { createCollabServer } from './server.ts';

const config = collabConfig();

const db = new pg.Pool({ connectionString: config.COLLAB_DATABASE_URL, application_name: 'notefieber-collab', max: 5 });
try {
  const login = await assertDbRole(db, 'wiki_worker');
  console.log(`Datenbank: verbunden als ${login} (wiki_worker)`);
} catch (err) {
  console.error(`Datenbank: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const server = createCollabServer(config, db);
await server.listen();
console.log(`Collab-Server: ${server.webSocketURL} (Origin ${new URL(config.PUBLIC_URL).origin})`);

// Beim Beenden erst alle offenen Dokumente speichern (Hocuspocus destroy), dann die Datenbank
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Collab-Server: ${signal}, speichere und beende`);
  await server.destroy();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
