// Spaces und Seitenbaum über die API, gegen eine echte Datenbank mit den Testdaten aus
// seed.sql (siehe testing.ts). Prüft vor allem, was Personen sehen und tun dürfen.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp, type TestApp } from '../testing.ts';

const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';
let peter = '';
let lukas = '';
let max = '';
let elena = '';

before(async () => {
  if (!app) return;
  peter = await app.sessionFor('peter.forster@alpenwerk.example');
  lukas = await app.sessionFor('lukas.gruber@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
  elena = await app.sessionFor('elena.novak@agentur-nord.example');
});
after(() => app?.close());

const a = () => app as TestApp;
type Page = { id: string; parentId: string | null; title: string; restricted: boolean; role: string | null };
const titles = (pages: Page[]) => pages.map((p) => p.title);

test('ohne Sitzung kein Zugriff', { skip }, async () => {
  assert.equal((await a().call(null, 'GET', '/spaces')).status, 401);
  assert.equal((await a().call('nf_session=erfunden', 'GET', '/spaces')).status, 401);
});

test('jede Person sieht nur ihre Spaces', { skip }, async () => {
  const keys = async (c: string) => (await a().call(c, 'GET', '/spaces')).body.map((s: { key: string }) => s.key);
  assert.deepEqual((await keys(peter)).filter((k: string) => ['ALT', 'ENTW', 'PERS', 'VERT'].includes(k)).sort(), [
    'ALT',
    'ENTW',
    'PERS',
    'VERT',
  ]);
  assert.ok(!(await keys(max)).includes('PERS'), 'Max sieht den privaten Space PERS');
  // Elena (Gast) sieht VERT nur wegen einer freigegebenen Seite, sonst nichts
  assert.deepEqual(await keys(elena), ['VERT']);
  assert.equal((await a().call(max, 'GET', '/spaces/PERS')).status, 404);
});

test('der Seitenbaum zeigt eingeschränkte Seiten nur den Berechtigten', { skip }, async () => {
  const tree = async (c: string) => (await a().call(c, 'GET', '/spaces/ENTW/pages')).body as Page[];
  const l = await tree(lukas);
  const plan = l.find((p) => p.title === 'Personalplanung 2027');
  assert.ok(plan?.restricted, 'Lukas sieht die Personalplanung nicht oder nicht als eingeschränkt');
  assert.ok(!titles(await tree(max)).includes('Personalplanung 2027'), 'Max sieht die Personalplanung');
  assert.ok(!titles(await tree(max)).includes('Alte Notizen'), 'Seite im Papierkorb im Baum');
});

test('Leser legen keine Seiten an', { skip }, async () => {
  const entw = (await a().call(max, 'GET', '/spaces/ENTW')).body;
  const r = await a().call(max, 'POST', '/spaces/ENTW/pages', { parentId: entw.homePageId, title: 'Von Max' });
  assert.equal(r.status, 403);
});

test('Space anlegen, Seiten anlegen, verschieben, Papierkorb', { skip }, async () => {
  const key = `T${Date.now().toString(36).toUpperCase()}`;
  let r = await a().call(peter, 'POST', '/spaces', { key, name: 'Test über die API' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.role, 'admin');
  const home = r.body.homePageId as string;
  assert.equal((await a().call(peter, 'POST', '/spaces', { key, name: 'Doppelt' })).status, 409);

  const create = async (title: string, parentId = home, afterId?: string) => {
    const res = await a().call(peter, 'POST', `/spaces/${key}/pages`, { parentId, title, afterId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id as string;
  };
  const children = async (parentId: string) =>
    titles(
      ((await a().call(peter, 'GET', `/spaces/${key}/pages`)).body as Page[]).filter((p) => p.parentId === parentId),
    );

  const pa = await create('A');
  const pb = await create('B');
  const pc = await create('C', home, pa);
  assert.deepEqual(await children(home), ['A', 'C', 'B']);

  r = await a().call(peter, 'POST', `/pages/${pb}/move`, { parentId: home, beforeId: pa });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.deepEqual(await children(home), ['B', 'A', 'C']);

  r = await a().call(peter, 'POST', `/pages/${pc}/move`, { parentId: pa });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.deepEqual(await children(pa), ['C']);
  const page = (await a().call(peter, 'GET', `/pages/${pc}`)).body;
  assert.deepEqual(
    page.breadcrumb.map((c: { title: string }) => c.title),
    ['Test über die API', 'A'],
  );

  r = await a().call(peter, 'POST', `/pages/${pa}/move`, { parentId: pc });
  assert.equal(r.status, 409, 'Seite unter die eigene Unterseite verschoben');

  // Max liest mit (Standard: alle im Workspace lesen), darf aber nichts ändern
  assert.equal((await a().call(max, 'GET', `/spaces/${key}/pages`)).status, 200);
  assert.equal((await a().call(max, 'POST', `/pages/${pb}/move`, { parentId: pa })).status, 403);
  assert.equal((await a().call(max, 'DELETE', `/pages/${pb}`)).status, 403);

  r = await a().call(peter, 'DELETE', `/pages/${pa}`);
  assert.deepEqual(r.body, { count: 2 });
  assert.deepEqual(await children(home), ['B']);
  const trash = (await a().call(peter, 'GET', `/spaces/${key}/trash`)).body;
  assert.deepEqual(
    trash.map((p: { title: string }) => p.title),
    ['A'],
  );
  r = await a().call(peter, 'POST', `/pages/${pa}/restore`);
  assert.deepEqual(r.body, { count: 2 });
  assert.deepEqual(await children(home), ['B', 'A']);

  assert.equal((await a().call(peter, 'DELETE', `/pages/${home}`)).status, 409, 'Startseite gelöscht');
});

test('Eingaben werden geprüft', { skip }, async () => {
  // Schlüssel in Adressen klein (/spaces/entw), gespeichert als ENTW
  const entw = await a().call(peter, 'GET', '/spaces/entw');
  assert.equal(entw.status, 200);
  assert.equal(entw.body.key, 'ENTW');
  assert.equal((await a().call(peter, 'GET', '/spaces/entw/pages')).status, 200);
  assert.equal((await a().call(peter, 'GET', '/spaces/1abc')).status, 400);
  assert.equal((await a().call(peter, 'GET', '/spaces/GIBTSNICHT')).status, 404);
  assert.equal((await a().call(peter, 'GET', '/pages/keine-uuid')).status, 400);
  const r = await a().call(peter, 'POST', '/spaces/ENTW/pages', { parentId: null, title: '' });
  assert.equal(r.status, 400);
});
