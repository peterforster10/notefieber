// Start des Collab-Servers ohne Datenbank (REVIEW_M1.md, R-23): Steht LISTEN nicht, bricht start()
// nach dem Zeitlimit ab und nimmt keine Verbindungen an. Ohne Datenbank, läuft mit `pnpm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { createCollab } from './server.ts';

test('ohne Datenbank: start() bricht nach dem Zeitlimit ab, kein WebSocket-Server', async () => {
  // Port 1 nimmt keine Verbindungen an: jeder Versuch scheitert sofort
  const url = 'postgres://niemand:nichts@127.0.0.1:1/wiki';
  const db = new pg.Pool({ connectionString: url });
  const collab = createCollab(
    {
      COLLAB_HOST: '127.0.0.1',
      COLLAB_PORT: 0,
      PUBLIC_URL: 'http://localhost:3000',
      COLLAB_DEBOUNCE_MS: 100,
      COLLAB_MAX_DEBOUNCE_MS: 500,
      COLLAB_DATABASE_URL: url,
      COLLAB_RECHECK_SECONDS: 3600,
    },
    db,
  );
  const started = Date.now();
  await assert.rejects(collab.start(300), /LISTEN nach/);
  assert.ok(Date.now() - started < 3000, 'wartet zu lange');
  assert.equal(collab.server.httpServer.listening, false);
  await db.end();
});
