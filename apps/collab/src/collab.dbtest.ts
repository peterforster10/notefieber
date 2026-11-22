// Collab-Server gegen die Wegwerf-Datenbank (E04-01, E04-03, Titel aus E04-08). Ohne
// COLLAB_TEST_DATABASE_URL und API_TEST_DATABASE_URL übersprungen (docs/LOCAL_SETUP.md, Abschnitt 7).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as Y from 'yjs';
import { CONTENT_FRAGMENT, TITLE_TEXT, documentName } from '@notefieber/editor-schema';
import { DEBOUNCE_MS, eventually, startCollab } from './testing.ts';
import type { Person } from './testing.ts';

const collab = await startCollab();
const skip = collab ? false : 'COLLAB_TEST_DATABASE_URL und API_TEST_DATABASE_URL fehlen';

let lukas: Person;
let max: Person;
before(async () => {
  if (!collab) return;
  lukas = await collab.person('lukas.gruber@alpenwerk.example');
  max = await collab.person('max.mustermann@alpenwerk.example');
});
after(() => collab?.close());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('abgelehnt: ohne Sitzung, fremder Origin, ungültiger Name, ohne Leserecht', { skip }, async () => {
  const c = collab!;
  const page = await c.createPage(lukas, 'ENTW', 'Collab: Ablehnung');
  const secret = await c.pageByTitle('Personalplanung 2027');
  const cases = [
    { opts: {}, page, reason: 'unauthenticated' },
    { opts: { cookie: 'nf_session=falsch' }, page, reason: 'unauthenticated' },
    { opts: { cookie: lukas.cookie, origin: 'https://boese.example' }, page, reason: 'forbidden-origin' },
    { opts: { cookie: lukas.cookie, name: 'page:kein-uuid' }, page, reason: 'invalid-document' },
    { opts: { cookie: max.cookie }, page: secret, reason: 'forbidden' },
  ];
  for (const { opts, page: id, reason } of cases) {
    const client = c.connect(id, opts);
    try {
      assert.deepEqual(await client.result, { denied: reason }, JSON.stringify(opts));
    } finally {
      client.close();
    }
  }
});

test(
  'gemeinsam: Lukas schreibt, Max liest live und kann nichts ändern, gespeichert wird nur Lukas',
  { skip },
  async () => {
    const c = collab!;
    const page = await c.createPage(lukas, 'ENTW', 'Collab: Gemeinsam');
    const l = c.connect(page, { cookie: lukas.cookie });
    const m = c.connect(page, { cookie: max.cookie });
    try {
      assert.deepEqual(await l.result, { scope: 'read-write' });
      assert.deepEqual(await m.result, { scope: 'readonly' });
      await Promise.all([l.synced, m.synced]);

      // Titel kommt aus pages.title ins Yjs-Dokument (sonst leerte das erste Speichern ihn)
      assert.equal(l.doc.getText(TITLE_TEXT).toString(), 'Collab: Gemeinsam');
      assert.equal(m.doc.getText(TITLE_TEXT).toString(), 'Collab: Gemeinsam');

      // Lukas tippt, Max sieht es innerhalb einer Sekunde (E04-01, E04-03)
      const started = Date.now();
      l.doc.getText(TITLE_TEXT).insert(l.doc.getText(TITLE_TEXT).length, ' (neu)');
      await eventually(() => m.doc.getText(TITLE_TEXT).toString() === 'Collab: Gemeinsam (neu)', 1000);
      assert.ok(Date.now() - started < 1000);

      // Max schickt trotzdem eine Änderung (manipulierter Browser): kommt nicht an, wird nicht gespeichert
      m.doc.getText(TITLE_TEXT).insert(0, 'GEHACKT ');
      await wait(DEBOUNCE_MS * 8);
      assert.equal(l.doc.getText(TITLE_TEXT).toString(), 'Collab: Gemeinsam (neu)');

      // Gespeichert (spätestens nach maxDebounce): Yjs-Zustand, Titel, Lukas als Bearbeitender
      const [row] = await eventually(async () => {
        const r = await c.query<{ ydoc: Buffer; title: string; stale: boolean; editors: string[]; by: string }>(
          `SELECT c.ydoc, p.title, c.derived_stale AS stale, c.editors_since_version AS editors, p.updated_by AS by
         FROM page_contents c JOIN pages p ON p.id = c.page_id WHERE c.page_id = $1`,
          [page],
        );
        return r[0]?.title === 'Collab: Gemeinsam (neu)' ? r : undefined;
      });
      assert.ok(row);
      assert.equal(row.stale, true, 'abgeleiteter Inhalt nicht als veraltet markiert');
      assert.deepEqual(row.editors, [lukas.userId], 'Max als Bearbeitender gespeichert');
      assert.equal(row.by, lukas.userId);
      const stored = new Y.Doc();
      Y.applyUpdate(stored, row.ydoc);
      assert.equal(stored.getText(TITLE_TEXT).toString(), 'Collab: Gemeinsam (neu)');

      // Speichern legt kein Ereignis an (der Worker meldet page.updated, wenn die Seite ruht)
      const events = await c.query(`SELECT 1 FROM outbox WHERE event_type = 'page.updated' AND payload->>'id' = $1`, [
        page,
      ]);
      assert.equal(events.length, 0);
    } finally {
      l.close();
      m.close();
    }

    // Alle zu, wieder öffnen: der letzte Stand ist da (E04-01)
    const again = c.connect(page, { cookie: max.cookie });
    try {
      await again.synced;
      assert.equal(again.doc.getText(TITLE_TEXT).toString(), 'Collab: Gemeinsam (neu)');
    } finally {
      again.close();
    }
  },
);

test(
  'neue Seite: Titel gleich gesichert, verdoppelt sich beim Wiederöffnen nicht (REVIEW_M1.md, R-19)',
  { skip },
  async () => {
    const c = collab!;
    const title = 'Collab: Wiederöffnen';
    const page = await c.createPage(lukas, 'ENTW', title);
    const name = documentName(page);

    // Lukas öffnet die neue Seite, tippt nichts und schließt sie. Sein Browser behält den Stand
    // (lokale Kopie in IndexedDB), der Server entlädt das Dokument.
    const first = c.connect(page, { cookie: lukas.cookie });
    let local: Uint8Array;
    try {
      await first.synced;
      assert.equal(first.doc.getText(TITLE_TEXT).toString(), title);
      local = Y.encodeStateAsUpdate(first.doc);
    } finally {
      first.close();
    }
    await eventually(() => !c.collab.server.hocuspocus.documents.has(name));

    // Wiederöffnen mit der lokalen Kopie: ein Titel, im Browser und nach dem Speichern
    const again = c.connect(page, { cookie: lukas.cookie, state: local });
    try {
      await again.synced;
      await wait(DEBOUNCE_MS * 8);
      assert.equal(again.doc.getText(TITLE_TEXT).toString(), title);
      const [p] = await c.query<{ title: string }>('SELECT title FROM pages WHERE id = $1', [page]);
      assert.equal(p!.title, title);
    } finally {
      again.close();
    }

    // Grund: Der Anfangszustand mit Titel steht schon nach dem ersten Öffnen in der Datenbank,
    // nicht nur im Speicher des Servers (jedes Laden fügte den Titel sonst neu ein)
    const [row] = await c.query<{ ydoc: Buffer }>('SELECT ydoc FROM page_contents WHERE page_id = $1', [page]);
    const stored = new Y.Doc();
    Y.applyUpdate(stored, row!.ydoc);
    assert.equal(stored.getText(TITLE_TEXT).toString(), title);
  },
);

test('Seite nur mit BlockNote-JSON (Testdaten, Import): Dokument daraus gebaut und gesichert', { skip }, async () => {
  const c = collab!;
  const page = await c.createPage(lukas, 'ENTW', 'Collab: Aus JSON');
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Aus den Testdaten', styles: {} }] }];
  await c.query('UPDATE page_contents SET content_json = $2 WHERE page_id = $1', [page, JSON.stringify(blocks)]);

  const client = c.connect(page, { cookie: lukas.cookie });
  try {
    await client.synced;
    assert.equal(client.doc.getText(TITLE_TEXT).toString(), 'Collab: Aus JSON');
    assert.ok(client.doc.getXmlFragment(CONTENT_FRAGMENT).toString().includes('Aus den Testdaten'));
    const [row] = await c.query<{ empty: boolean; stale: boolean }>(
      `SELECT ydoc = '\\x0000'::bytea AS empty, derived_stale AS stale FROM page_contents WHERE page_id = $1`,
      [page],
    );
    assert.deepEqual(row, { empty: false, stale: false });
  } finally {
    client.close();
  }
});

test('Seite im Papierkorb: auch Bearbeitende nur lesend', { skip }, async () => {
  const c = collab!;
  const page = await c.createPage(lukas, 'ENTW', 'Collab: Papierkorb');
  await c.trashPage(lukas, page);
  const client = c.connect(page, { cookie: lukas.cookie });
  try {
    assert.deepEqual(await client.result, { scope: 'readonly' });
  } finally {
    client.close();
  }
});
