// Collab-Server (Hocuspocus): Yjs-Sync, Cursor, Anwesenheit. Ein Dokument pro Seite,
// Name page:<uuid> (CLAUDE.md, Abschnitte 6 und 7). Verbindet sich als wiki_worker.
// Anmeldung über das Sitzungs-Cookie (auth.ts), Laden und Speichern in store.ts, die Hooks in
// server.ts, Rechteänderungen und Abmelden per LISTEN in events.ts. Noch nicht hier (M1, Stück 3):
// interner Aufruf für Änderungen von der Serverseite.
import pg from 'pg';
import { assertDbRole } from '@notefieber/shared';
import { collabConfig } from './config.ts';
import { createCollab } from './server.ts';

const config = collabConfig();

const db = new pg.Pool({ connectionString: config.COLLAB_DATABASE_URL, application_name: 'notefieber-collab', max: 5 });
try {
  const login = await assertDbRole(db, 'wiki_worker');
  console.log(`Datenbank: verbunden als ${login} (wiki_worker)`);
} catch (err) {
  console.error(`Datenbank: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const collab = createCollab(config, db);
await collab.start();
console.log(
  `Collab-Server: ${collab.server.webSocketURL} (Origin ${new URL(config.PUBLIC_URL).origin}, LISTEN nf_events, nf_sessions)`,
);

// Beim Beenden erst alle offenen Dokumente speichern (Hocuspocus destroy), dann LISTEN und Datenbank
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Collab-Server: ${signal}, speichere und beende`);
  await collab.stop();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
