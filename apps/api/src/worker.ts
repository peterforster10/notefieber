// Worker: Suchindex, Versionen, Verlinkungen, Import, Export, Outbox (CLAUDE.md, Abschnitt 6).
// Gleiches Paket und Image wie die API, eigenes Deployment und eigene Datenbankrolle
// (wiki_worker). Grundgerüst: verbinden, Rolle prüfen, regelmäßig ein Lebenszeichen.
// Die Aufgaben selbst (pg-boss) folgen mit den Funktionen, die sie brauchen.
import { workerConfig } from './config.ts';
import { connect } from './db.ts';

const config = workerConfig();
const db = await connect(config.WORKER_DATABASE_URL, 'wiki_worker', 'notefieber-worker');

async function tick() {
  const { rows } = await db.query<{ now: string }>('SELECT now()::text AS now');
  console.log(`Worker: bereit (${rows[0]?.now})`);
}

await tick();
const timer = setInterval(() => {
  tick().catch((err: unknown) => console.error('Worker:', err));
}, config.WORKER_INTERVAL_SECONDS * 1000);

function shutdown(signal: string) {
  console.log(`Worker: ${signal}, beende`);
  clearInterval(timer);
  void db.end().then(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
