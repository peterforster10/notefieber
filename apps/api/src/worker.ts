// Worker: Suchindex, Versionen, Verlinkungen, Import, Export, Outbox (CLAUDE.md, Abschnitt 6).
// Gleiches Paket und Image wie die API, eigenes Deployment und eigene Datenbankrolle
// (wiki_worker). Bisher eine Aufgabe: abgeleiteter Inhalt aus dem Yjs-Zustand (jobs/derive.ts),
// dazu regelmäßig ein Lebenszeichen. Weitere Aufgaben (pg-boss) folgen mit M2.
import { workerConfig } from './config.ts';
import { connect } from './db.ts';
import { deriveOnce } from './jobs/derive.ts';

const config = workerConfig();
const db = await connect(config.WORKER_DATABASE_URL, 'wiki_worker', 'notefieber-worker');

let stopping = false;
let deriveTimer: NodeJS.Timeout | undefined;

// Ableiten: ein Durchlauf nach dem anderen, nie zwei gleichzeitig. War eine Liste voll, gleich weiter.
async function deriveLoop() {
  let more = false;
  try {
    const s = await deriveOnce(db, { restSeconds: config.WORKER_DERIVE_REST_SECONDS, batch: 50 });
    if (s.derived || s.initial || s.failed) {
      console.log(`Worker: abgeleitet ${s.derived}, erster Yjs-Zustand ${s.initial}, Fehler ${s.failed}`);
    }
    more = s.more;
  } catch (err) {
    console.error('Worker: Ableiten fehlgeschlagen:', err instanceof Error ? err.message : err);
  }
  if (!stopping) deriveTimer = setTimeout(deriveLoop, more ? 0 : config.WORKER_DERIVE_INTERVAL_SECONDS * 1000);
}

async function tick() {
  const { rows } = await db.query<{ now: string }>('SELECT now()::text AS now');
  console.log(`Worker: bereit (${rows[0]?.now})`);
}

await tick();
const timer = setInterval(() => {
  tick().catch((err: unknown) => console.error('Worker:', err));
}, config.WORKER_INTERVAL_SECONDS * 1000);
void deriveLoop();

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Worker: ${signal}, beende`);
  clearInterval(timer);
  clearTimeout(deriveTimer);
  void db.end().then(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
