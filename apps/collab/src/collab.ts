// Collab-Server (Hocuspocus): Yjs-Sync, Cursor, Anwesenheit. Ein Dokument pro Seite,
// Name page:<uuid> (CLAUDE.md, Abschnitte 6 und 7). Verbindet sich als wiki_worker.
// Anmeldung über das Sitzungs-Cookie (auth.ts), Laden und Speichern in store.ts, die Hooks in
// server.ts, Rechteänderungen und Abmelden per LISTEN in events.ts, Änderungen von der Serverseite
// (interner Aufruf der API) in internal.ts.
import pg from 'pg';
import { assertDbRole } from '@notefieber/shared';
import { collabConfig } from './config.ts';
import { startInternal } from './internal.ts';
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

// Interner Aufruf der API (Umbenennen aus der Seitenleiste), nur mit Geheimnis
const internal = config.COLLAB_INTERNAL_SECRET
  ? await startInternal(collab, db, {
      host: config.COLLAB_INTERNAL_HOST,
      port: config.COLLAB_INTERNAL_PORT,
      secret: config.COLLAB_INTERNAL_SECRET,
    })
  : undefined;
console.log(
  internal
    ? `Collab-Server: interner Aufruf auf http://${config.COLLAB_INTERNAL_HOST}:${config.COLLAB_INTERNAL_PORT}`
    : 'Collab-Server: interner Aufruf aus (COLLAB_INTERNAL_SECRET fehlt), Umbenennen aus der Seitenleiste geht nicht',
);

// Beim Beenden erst alle offenen Dokumente speichern (Hocuspocus destroy), dann LISTEN und Datenbank
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Collab-Server: ${signal}, speichere und beende`);
  internal?.close();
  await collab.stop();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
