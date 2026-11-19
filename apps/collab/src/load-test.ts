// Lasttest des Collab-Servers (ROADMAP M1; ARCHITECTURE_REVIEW.md, A-04; E04-Abnahme: 50 Personen
// bearbeiten eine Seite gleichzeitig ohne Datenverlust). Nur gegen die Wegwerf-Datenbank, wie die
// *.dbtest.ts (docs/LOCAL_SETUP.md, Abschnitt 7):
//
//   API_TEST_DATABASE_URL=… COLLAB_TEST_DATABASE_URL=… pnpm --filter @notefieber/collab load-test
//
// Ablauf: echter Collab-Server mit der Entprellung aus dem Betrieb (2 s, spätestens 10 s), N Clients
// über WebSocket (je eigene Sitzung, wie Browser-Tabs) auf derselben neuen Seite. Jeder tippt alle
// LOAD_INTERVAL_MS ein kurzes, eindeutiges Stück („<client>.<nr>;“) an eine zufällige Grenze im
// gemeinsamen Text und bewegt seinen Cursor (Awareness). Ein Client misst laufend, wie lange eine
// Änderung zu einem anderen braucht. Danach: alle gleich? Jedes Stück genau einmal im gespeicherten
// Yjs-Zustand? Dazu WAL pro Minute (pg_current_wal_lsn) und Dauer jedes Speicherns.
// Server und Clients laufen in einem Prozess; Latenzen enthalten also auch die Arbeit der Clients.
import * as Y from 'yjs';
import { eventually, startCollab } from './testing.ts';
import type { Client } from './testing.ts';

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const CLIENTS = num('LOAD_CLIENTS', 50);
const SECONDS = num('LOAD_SECONDS', 60);
const INTERVAL_MS = num('LOAD_INTERVAL_MS', 300);

const c = await startCollab({ debounceMs: 2000, maxDebounceMs: 10_000 });
if (!c) {
  console.error('COLLAB_TEST_DATABASE_URL und API_TEST_DATABASE_URL fehlen (Wegwerf-Datenbank, nie nf-pg18)');
  process.exit(1);
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const walLsn = async () => (await c.query<{ lsn: string }>('SELECT pg_current_wal_lsn()::text AS lsn'))[0]!.lsn;
const walDiff = async (from: string) =>
  Number((await c.query<{ d: string }>('SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1)::text AS d', [from]))[0]!.d);

// Bearbeitende abwechselnd Lukas und Peter (beide dürfen in ENTW schreiben), je eigene Sitzung
const emails = ['lukas.gruber@alpenwerk.example', 'peter.forster@alpenwerk.example'];
const owner = await c.person(emails[0]!);
const page = await c.createPage(owner, 'ENTW', `Lasttest ${new Date().toISOString()}`);
const people = await Promise.all(Array.from({ length: CLIENTS }, (_, i) => c.person(emails[i % emails.length]!)));

console.log(`Lasttest: ${CLIENTS} Clients, ${SECONDS} s, alle ${INTERVAL_MS} ms ein Stück pro Client, Seite ${page}`);
const connectStart = performance.now();
const clients: Client[] = people.map((p) => c.connect(page, { cookie: p.cookie }));
const scopes = await Promise.all(clients.map((cl) => cl.result));
if (scopes.some((s) => s.scope !== 'read-write')) throw new Error(`Nicht alle schreibend: ${JSON.stringify(scopes)}`);
await Promise.all(clients.map((cl) => cl.synced));
console.log(`Verbunden in ${fmt(performance.now() - connectStart)} ms`);

// Messung der Laufzeit einer Änderung: Client 0 schreibt Zeitstempel, Client 1 liest sie
const latencies: number[] = [];
clients[1]!.doc.getMap<number>('probe').observe((e) => {
  for (const key of e.keysChanged) {
    const sent = e.target.get(key);
    if (typeof sent === 'number') latencies.push(Date.now() - sent);
  }
});

const wal0 = await walLsn();
const stores0 = c.collab.stats.stores;
let sent = 0;
const timers: NodeJS.Timeout[] = [];
const started = Date.now();

clients.forEach((cl, i) => {
  let k = 0;
  const text = cl.doc.getText('load');
  const tick = () => {
    if (Date.now() - started >= SECONDS * 1000) return;
    // Zufällige Grenze zwischen zwei Stücken: nie mitten in ein anderes Stück
    const s = text.toString();
    const bounds = [0];
    for (let j = s.indexOf(';'); j >= 0; j = s.indexOf(';', j + 1)) bounds.push(j + 1);
    const pos = bounds[Math.floor(Math.random() * bounds.length)]!;
    text.insert(pos, `${i}.${k++};`);
    sent++;
    cl.provider.setAwarenessField('cursor', { pos });
    timers.push(setTimeout(tick, INTERVAL_MS * (0.5 + Math.random())));
  };
  timers.push(setTimeout(tick, Math.random() * INTERVAL_MS));
});
const probe = setInterval(() => clients[0]!.doc.getMap<number>('probe').set(`p${Date.now()}`, Date.now()), 1000);

const heartbeat = setInterval(() => {
  const s = c.collab.stats;
  console.log(
    `  ${Math.round((Date.now() - started) / 1000)} s: ${sent} Stücke, ${s.stores - stores0} mal gespeichert, ` +
      `Yjs ${Math.round(s.ydocBytes / 1024)} KB, Laufzeit p95 ${fmt(pct(latencies, 95))} ms`,
  );
}, 10_000);

await new Promise((r) => setTimeout(r, SECONDS * 1000 + INTERVAL_MS * 2));
clearInterval(probe);
clearInterval(heartbeat);
for (const t of timers) clearTimeout(t);
const typingSeconds = (Date.now() - started) / 1000;

// Alle gleich?
const expected = sent;
await eventually(
  () => clients.every((cl) => cl.doc.getText('load').toString() === clients[0]!.doc.getText('load').toString()),
  30_000,
);
const converged = (Date.now() - started) / 1000 - typingSeconds;

// Alle schließen: Der Collab-Server speichert ein letztes Mal, dann aus der Datenbank prüfen
for (const cl of clients) cl.close();
await eventually(async () => {
  const [row] = await c.query<{ ydoc: Buffer }>('SELECT ydoc FROM page_contents WHERE page_id = $1', [page]);
  const d = new Y.Doc();
  Y.applyUpdate(d, row!.ydoc);
  return d.getText('load').toString().split(';').filter(Boolean).length === expected;
}, 30_000).catch(() => undefined);
const [row] = await c.query<{ ydoc: Buffer }>('SELECT ydoc FROM page_contents WHERE page_id = $1', [page]);
const stored = new Y.Doc();
Y.applyUpdate(stored, row!.ydoc);
const pieces = stored.getText('load').toString().split(';').filter(Boolean);
const unique = new Set(pieces);
const wal = await walDiff(wal0);
const s = c.collab.stats;
const storeMs = s.storeMs.slice(-(s.stores - stores0));

console.log('\nErgebnis');
console.log(
  `  Clients ${CLIENTS}, getippt ${fmt(typingSeconds)} s, ${expected} Stücke (${fmt(expected / typingSeconds)} pro s)`,
);
console.log(`  Gleichstand aller Clients ${fmt(converged)} s nach Tippende`);
console.log(`  Gespeichert: ${pieces.length} Stücke, davon ${unique.size} verschieden, erwartet ${expected}`);
console.log(`  Datenverlust: ${expected - unique.size}, doppelt: ${pieces.length - unique.size}`);
console.log(
  `  Laufzeit einer Änderung zu einem anderen Client: p50 ${fmt(pct(latencies, 50))} ms, p95 ${fmt(pct(latencies, 95))} ms, max ${fmt(Math.max(...latencies))} ms (${latencies.length} Proben)`,
);
console.log(
  `  Speichern: ${s.stores - stores0} mal, Fehler ${s.storeErrors}, Dauer p50 ${fmt(pct(storeMs, 50))} ms, p95 ${fmt(pct(storeMs, 95))} ms, max ${fmt(Math.max(...storeMs))} ms`,
);
console.log(`  Yjs-Zustand zuletzt ${Math.round(row!.ydoc.length / 1024)} KB`);
console.log(
  `  WAL ${fmt(wal / 1024 / 1024)} MB gesamt, ${fmt(wal / 1024 / 1024 / (typingSeconds / 60))} MB pro Minute Tippen`,
);
console.log(`  Speicher des Prozesses (Server und Clients): ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);

await c.trashPage(owner, page).catch(() => undefined);
await c.close();
const ok = unique.size === expected && pieces.length === expected && s.storeErrors === 0;
console.log(ok ? '\nOK: kein Datenverlust' : '\nFEHLER: Datenverlust oder Speicherfehler');
process.exit(ok ? 0 : 1);
