// Worker: abgeleiteter Inhalt gegen die Wegwerf-Datenbank mit den Testdaten (siehe testing.ts).
// Braucht WORKER_TEST_DATABASE_URL (wiki_jobs, in wiki_worker) und API_TEST_DATABASE_URL (Seiten
// und Personen wie über die API). Speichern wie der Collab-Server: app.store_ydoc direkt.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { deriveContent, initialYDocState } from '@notefieber/editor-schema/server';
import { assertDbRole } from '@notefieber/shared';
import { withContext } from '../db.ts';
import { startTestApp, type TestApp } from '../testing.ts';
import { derivePage, deriveOnce } from './derive.ts';

const app = await startTestApp();
const workerUrl = process.env.WORKER_TEST_DATABASE_URL;
const skip = app && workerUrl ? false : 'API_TEST_DATABASE_URL und WORKER_TEST_DATABASE_URL fehlen';
const a = () => app as TestApp;

let worker: pg.Pool;
let tenantId = '';
let lukas = '';
let lukasId = '';

before(async () => {
  if (skip) return;
  worker = new pg.Pool({ connectionString: workerUrl, max: 3 });
  await assertDbRole(worker, 'wiki_worker');
  tenantId = await a().tenantId();
  lukas = await a().sessionFor('lukas.gruber@alpenwerk.example');
  lukasId = (await a().call(lukas, 'GET', '/auth/me')).body.id;
});
after(async () => {
  await worker?.end();
  await app?.close();
});

/** Abfrage als Worker im Mandanten alpenwerk */
async function q<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  return withContext(worker, { tenantId }, async (c) => (await c.query<T>(sql, params)).rows);
}

async function newPage(title: string) {
  const space = (await a().call(lukas, 'GET', '/spaces/ENTW')).body;
  const r = await a().call(lukas, 'POST', '/spaces/ENTW/pages', { parentId: space.homePageId, title });
  assert.equal(r.status, 201);
  return r.body.id as string;
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] });

/** Speichern wie der Collab-Server (onStoreDocument) */
async function storeYdoc(page: string, title: string, texts: string[]) {
  const state = initialYDocState(texts.map(paragraph), title);
  await q('SELECT app.store_ydoc($1, $2, $3, $4::uuid[])', [page, Buffer.from(state), title, [lukasId]]);
}

test('Testdaten: Seiten nur mit BlockNote-JSON bekommen einen Yjs-Zustand mit gleichem Inhalt', { skip }, async () => {
  await deriveOnce(worker, { restSeconds: 0, batch: 1000 });
  const [row] = await q<{ ydoc: Buffer; plain_text: string; empty: boolean; stale: boolean }>(
    `SELECT c.ydoc, c.plain_text, c.ydoc = '\\x0000'::bytea AS empty, c.derived_stale AS stale
     FROM page_contents c JOIN pages p ON p.id = c.page_id WHERE p.title = 'Datenmodell'`,
  );
  assert.ok(row);
  assert.equal(row.empty, false, 'kein Yjs-Zustand gebaut');
  const derived = deriveContent(row.ydoc);
  assert.equal(derived.title, 'Datenmodell');
  assert.equal(derived.plainText, row.plain_text, 'Yjs-Zustand passt nicht zum Klartext der Testdaten');
  const left = await q(`SELECT 1 FROM app.pages_to_derive('0 seconds', 1000) WHERE tenant_id = $1 AND needs_ydoc`, [
    tenantId,
  ]);
  assert.equal(left.length, 0, 'Seiten ohne Yjs-Zustand übrig');
});

test('ruht die Seite, leitet der Worker ab: JSON, Klartext, Suchindex, genau ein page.updated', { skip }, async () => {
  const page = await newPage('Worker: Ableiten');
  await storeYdoc(page, 'Worker: Ableiten', ['Erster Absatz', 'Zweiter Absatz mit Suchwort Zitronenfalter']);

  // Noch keine Ruhe: nichts passiert
  await deriveOnce(worker, { restSeconds: 3600, batch: 1000 });
  const [before] = await q<{ stale: boolean }>('SELECT derived_stale AS stale FROM page_contents WHERE page_id = $1', [
    page,
  ]);
  assert.equal(before?.stale, true, 'vor Ablauf der Ruhezeit abgeleitet');

  await deriveOnce(worker, { restSeconds: 0, batch: 1000 });
  const [row] = await q<{ stale: boolean; plain_text: string; content_json: { content: { text: string }[] }[] }>(
    'SELECT derived_stale AS stale, plain_text, content_json FROM page_contents WHERE page_id = $1',
    [page],
  );
  assert.ok(row);
  assert.equal(row.stale, false);
  assert.equal(row.plain_text, 'Erster Absatz\nZweiter Absatz mit Suchwort Zitronenfalter');
  assert.deepEqual(
    row.content_json.map((b) => b.content[0]?.text),
    ['Erster Absatz', 'Zweiter Absatz mit Suchwort Zitronenfalter'],
  );
  const hits = await q(
    `SELECT 1 FROM page_search WHERE page_id = $1 AND tsv @@ to_tsquery('german', 'zitronenfalter')`,
    [page],
  );
  assert.equal(hits.length, 1, 'Suchindex nicht gepflegt');
  const events = await q(`SELECT 1 FROM outbox WHERE event_type = 'page.updated' AND payload->>'id' = $1`, [page]);
  assert.equal(events.length, 1, 'page.updated nicht genau einmal');

  // Ein weiterer Durchlauf ändert nichts mehr
  await deriveOnce(worker, { restSeconds: 0, batch: 1000 });
  const again = await q(`SELECT 1 FROM outbox WHERE event_type = 'page.updated' AND payload->>'id' = $1`, [page]);
  assert.equal(again.length, 1, 'page.updated doppelt');
});

test('zwischen Lesen und Speichern weiterbearbeitet: bleibt veraltet, nichts überschrieben', { skip }, async () => {
  const page = await newPage('Worker: Rennen');
  await storeYdoc(page, 'Worker: Rennen', ['Alter Stand']);
  const [{ seen } = { seen: '' }] = await q<{ seen: string }>(
    'SELECT updated_at::text AS seen FROM page_contents WHERE page_id = $1',
    [page],
  );
  await storeYdoc(page, 'Worker: Rennen', ['Neuer Stand']);

  assert.equal(await derivePage(worker, tenantId, page, seen), 'changed');
  const [row] = await q<{ stale: boolean; plain_text: string }>(
    'SELECT derived_stale AS stale, plain_text FROM page_contents WHERE page_id = $1',
    [page],
  );
  assert.deepEqual(row, { stale: true, plain_text: '' });

  await deriveOnce(worker, { restSeconds: 0, batch: 1000 });
  const [after] = await q<{ plain_text: string }>('SELECT plain_text FROM page_contents WHERE page_id = $1', [page]);
  assert.equal(after?.plain_text, 'Neuer Stand');
});

test(
  'Seitenlinks im Inhalt: page_links folgt dem Inhalt, fremde und unbekannte Ziele fallen weg',
  { skip },
  async () => {
    const target = await newPage('Worker: Ziel');
    const page = await newPage('Worker: Mit Link');
    const nordlicht = await a().tenantId('nordlicht');
    const [foreign] = await withContext(
      worker,
      { tenantId: nordlicht },
      async (c) => (await c.query<{ id: string }>('SELECT id FROM pages LIMIT 1')).rows,
    );
    assert.ok(foreign, 'keine Seite in nordlicht');
    const link = (pageId: string) => ({ type: 'pageLink', props: { pageId } });
    const store = async (content: unknown[]) => {
      const state = initialYDocState([{ type: 'paragraph', content }], 'Worker: Mit Link');
      await q('SELECT app.store_ydoc($1, $2, $3, $4::uuid[])', [
        page,
        Buffer.from(state),
        'Worker: Mit Link',
        [lukasId],
      ]);
      await deriveOnce(worker, { restSeconds: 0, batch: 1000 });
    };
    const links = async () =>
      (await q<{ to_page_id: string }>('SELECT to_page_id FROM page_links WHERE from_page_id = $1', [page])).map(
        (r) => r.to_page_id,
      );

    await store([link(target), link(foreign.id), link('019a5b3c-0000-7000-8000-0000000000ff'), link(page)]);
    assert.deepEqual(await links(), [target]);

    await store([{ type: 'text', text: 'ohne Link', styles: {} }]);
    assert.deepEqual(await links(), [], 'entfernter Link bleibt in page_links');
  },
);
