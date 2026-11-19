// Umbenennen aus der Seitenleiste (E04-08): Die API prüft die Rechte und ruft den Collab-Server
// intern auf. Hier gegen einen Stub des Collab-Servers, der die Aufrufe mitschreibt; den echten
// internen Aufruf prüft apps/collab/src/internal.dbtest.ts.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { INTERNAL_SECRET_HEADER } from '@notefieber/shared';

const SECRET = 'geheim-nur-fuer-den-api-test-'.repeat(2);
interface Call {
  path: string;
  secret: string | undefined;
  body: { tenantId: string; userId: string; title: string };
}
const calls: Call[] = [];
let reply = 204;
const stub = http.createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => {
    calls.push({
      path: req.url ?? '',
      secret: req.headers[INTERNAL_SECRET_HEADER] as string | undefined,
      body: JSON.parse(data),
    });
    res.writeHead(reply).end();
  });
});
stub.listen(0, '127.0.0.1');
await once(stub, 'listening');
process.env.COLLAB_INTERNAL_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
process.env.COLLAB_INTERNAL_SECRET = SECRET;

const { startTestApp } = await import('../testing.ts');
const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';

let lukas = '';
let max = '';
let lukasId = '';
let tenantId = '';
let home = '';
before(async () => {
  if (!app) return;
  lukas = await app.sessionFor('lukas.gruber@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
  lukasId = (await app.call(lukas, 'GET', '/auth/me')).body.id;
  tenantId = await app.tenantId();
  home = (await app.call(lukas, 'GET', '/spaces/ENTW')).body.homePageId;
});
beforeEach(() => {
  calls.length = 0;
  reply = 204;
});
after(async () => {
  stub.close();
  await app?.close();
});

const newPage = async (title: string) =>
  (await app!.call(lukas, 'POST', '/spaces/ENTW/pages', { parentId: home, title })).body.id as string;

test('Bearbeitende: Collab-Server wird mit Geheimnis, Mandant, Person und Titel aufgerufen', { skip }, async () => {
  const page = await newPage('Umbenennen: API');
  const r = await app!.call(lukas, 'POST', `/pages/${page}/title`, { title: '  Neuer Titel  ' });
  assert.equal(r.status, 204);
  assert.deepEqual(calls, [
    {
      path: `/internal/v1/pages/${page}/title`,
      secret: SECRET,
      body: { tenantId, userId: lukasId, title: 'Neuer Titel' },
    },
  ]);
});

test('Lesende: 403; ohne Leserecht: 404; Papierkorb: 409; jeweils ohne Aufruf', { skip }, async () => {
  const page = await newPage('Umbenennen: Rechte');
  assert.equal((await app!.call(max, 'POST', `/pages/${page}/title`, { title: 'x' })).status, 403);

  const tree = (await app!.call(lukas, 'GET', '/spaces/ENTW/pages')).body as { id: string; title: string }[];
  const secret = tree.find((p) => p.title === 'Personalplanung 2027')!.id;
  assert.equal((await app!.call(max, 'POST', `/pages/${secret}/title`, { title: 'x' })).status, 404);

  await app!.call(lukas, 'DELETE', `/pages/${page}`);
  assert.equal((await app!.call(lukas, 'POST', `/pages/${page}/title`, { title: 'x' })).status, 409);
  assert.equal(calls.length, 0, 'Collab-Server trotz fehlender Rechte aufgerufen');
});

test('Collab-Server lehnt ab oder ist gestört: 409 bzw. 503', { skip }, async () => {
  const page = await newPage('Umbenennen: Störung');
  reply = 409;
  assert.equal((await app!.call(lukas, 'POST', `/pages/${page}/title`, { title: 'x' })).status, 409);
  reply = 500;
  assert.equal((await app!.call(lukas, 'POST', `/pages/${page}/title`, { title: 'x' })).status, 503);
});
