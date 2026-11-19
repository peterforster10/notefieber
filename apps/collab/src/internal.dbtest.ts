// Interner Aufruf an den Collab-Server (E04-08, Umbenennen aus der Seitenleiste): nur mit Geheimnis,
// ändert das Yjs-Dokument über openDirectConnection, offene Browser sehen es sofort, gespeichert
// ist es, sobald die Antwort da ist. Gegen die Wegwerf-Datenbank wie collab.dbtest.ts.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { TITLE_TEXT } from '@notefieber/editor-schema';
import { INTERNAL_SECRET_HEADER, internalTitlePath } from '@notefieber/shared';
import { startInternal } from './internal.ts';
import { eventually, startCollab } from './testing.ts';
import type { Person } from './testing.ts';

const SECRET = 'geheim-nur-fuer-den-test-'.repeat(2);
const c = await startCollab();
const skip = c ? false : 'COLLAB_TEST_DATABASE_URL und API_TEST_DATABASE_URL fehlen';
const internal = c
  ? await startInternal(c.collab, c.workerPool, { host: '127.0.0.1', port: 0, secret: SECRET })
  : undefined;
const base = internal ? `http://127.0.0.1:${(internal.address() as AddressInfo).port}` : '';

let lukas: Person;
before(async () => {
  if (c) lukas = await c.person('lukas.gruber@alpenwerk.example');
});
after(async () => {
  internal?.close();
  await c?.close();
});

const rename = (pageId: string, body: object, secret = SECRET) =>
  fetch(base + internalTitlePath(pageId), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { [INTERNAL_SECRET_HEADER]: secret } : {}) },
    body: JSON.stringify(body),
  });

test('ohne oder mit falschem Geheimnis: 401, nichts geändert', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Intern: Geheimnis');
  const body = { tenantId: c!.tenantId, userId: lukas.userId, title: 'Gehackt' };
  assert.equal((await rename(page, body, '')).status, 401); // ohne Header
  assert.equal((await rename(page, body, 'falsch')).status, 401);
  assert.equal((await rename(page, body, SECRET.slice(0, -1) + 'x')).status, 401);
  const [row] = await c!.query<{ title: string }>('SELECT title FROM pages WHERE id = $1', [page]);
  assert.equal(row?.title, 'Intern: Geheimnis');
});

test('umbenennen: offene Browser sehen es sofort, gespeichert mit der Person als Bearbeitende', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Intern: Vorher');
  const l = c!.connect(page, { cookie: lukas.cookie });
  try {
    await l.synced;
    const r = await rename(page, { tenantId: c!.tenantId, userId: lukas.userId, title: '  Intern: Nachher  ' });
    assert.equal(r.status, 204);
    // Gespeichert, sobald die Antwort da ist (Collab-Server speichert beim Schließen der direkten Verbindung)
    const [row] = await c!.query<{ title: string; editors: string[]; by: string; stale: boolean }>(
      `SELECT p.title, c.editors_since_version AS editors, p.updated_by AS by, c.derived_stale AS stale
       FROM pages p JOIN page_contents c ON c.page_id = p.id WHERE p.id = $1`,
      [page],
    );
    assert.deepEqual(row, { title: 'Intern: Nachher', editors: [lukas.userId], by: lukas.userId, stale: true });
    await eventually(() => l.doc.getText(TITLE_TEXT).toString() === 'Intern: Nachher', 1000);
  } finally {
    l.close();
  }
});

test('umbenennen ohne offenen Browser: Dokument geladen, geändert, gespeichert', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Intern: Geschlossen');
  const r = await rename(page, { tenantId: c!.tenantId, userId: lukas.userId, title: 'Intern: Geschlossen neu' });
  assert.equal(r.status, 204);
  const [row] = await c!.query<{ title: string }>('SELECT title FROM pages WHERE id = $1', [page]);
  assert.equal(row?.title, 'Intern: Geschlossen neu');
  // Später geöffnet: der neue Titel steht im Yjs-Dokument
  const l = c!.connect(page, { cookie: lukas.cookie });
  try {
    await l.synced;
    assert.equal(l.doc.getText(TITLE_TEXT).toString(), 'Intern: Geschlossen neu');
  } finally {
    l.close();
  }
});

test('fremder Mandant: 404; Papierkorb: 409; ungültige Angaben: 400', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Intern: Grenzen');
  const other = '01a1e091-0000-7000-8000-000000000000';
  assert.equal((await rename(page, { tenantId: other, userId: lukas.userId, title: 'x' })).status, 404);
  assert.equal((await rename('kein-uuid', { tenantId: c!.tenantId, userId: lukas.userId, title: 'x' })).status, 400);
  assert.equal((await rename(page, { tenantId: c!.tenantId, title: 'x' })).status, 400);
  await c!.trashPage(lukas, page);
  assert.equal((await rename(page, { tenantId: c!.tenantId, userId: lukas.userId, title: 'x' })).status, 409);
});
