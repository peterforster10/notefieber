// Personen für Erwähnungen über die API, gegen die Wegwerf-Datenbank mit den Testdaten.
// Prüft vor allem, wen eine Person finden und beim Namen sehen darf.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp, type TestApp } from '../testing.ts';

const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';
const a = () => app as TestApp;
let lukas = '';
let max = '';
let elena = '';
let eva = '';

before(async () => {
  if (!app) return;
  lukas = await app.sessionFor('lukas.gruber@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
  elena = await app.sessionFor('elena.novak@agentur-nord.example');
  eva = await app.sessionFor('eva.fischer@nordlicht.example', 'nordlicht');
});
after(() => app?.close());

type Person = { id: string; displayName: string };
const search = async (cookie: string, q: string, space?: string) => {
  const params = new URLSearchParams({ q, ...(space ? { space } : {}) });
  const r = await a().call(cookie, 'GET', `/people/search?${params}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as Person[]).map((p) => p.displayName);
};

test('Personensuche: Mitglieder des Workspaces, nie fremde Mandanten', { skip }, async () => {
  assert.deepEqual(await search(lukas, 'sophie'), ['Sophie Bauer']);
  assert.deepEqual(await search(lukas, 'agentur-nord'), ['Elena Novak'], 'Suche nach E-Mail');
  const all = await search(lukas, '', 'entw');
  for (const name of ['Peter Forster', 'Lukas Gruber', 'Max Mustermann', 'Elena Novak']) {
    assert.ok(all.includes(name), `${name} fehlt`);
  }
  assert.ok(!all.includes('Eva Fischer'), 'Person aus Nordlicht gefunden');
  assert.deepEqual(await search(lukas, 'Eva'), []);
  assert.deepEqual(await search(eva, 'Lukas'), []);
  // Namen, die mit dem Suchtext beginnen, zuerst; LIKE-Zeichen sind nur Text
  assert.equal((await search(lukas, 'ma'))[0], 'Markus Wagner');
  assert.deepEqual(await search(lukas, '%'), []);
});

test('Gäste finden nur sich selbst; unsichtbare Spaces gibt es nicht', { skip }, async () => {
  assert.deepEqual(await search(elena, ''), ['Elena Novak']);
  assert.deepEqual(await search(elena, 'Peter'), []);
  assert.equal((await a().call(max, 'GET', '/people/search?q=&space=PERS')).status, 404);
  assert.equal((await a().call(max, 'GET', '/people/search?space=x')).status, 400);
  assert.equal((await a().call(null, 'GET', '/people/search?q=a')).status, 401);
});

test('Namen zu Erwähnungen: nur sichtbare Personen, höchstens 100', { skip }, async () => {
  const peter = (await a().call(lukas, 'GET', '/people/search?q=Peter')).body[0] as Person;
  const self = (await a().call(elena, 'GET', '/auth/me')).body as { id: string };
  const unknown = '019a5b3c-0000-7000-8000-0000000000ff';
  const lookup = async (cookie: string, ids: string[]) => {
    const r = await a().call(cookie, 'POST', '/people/lookup', { ids });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return (r.body as { displayName: string; deactivated: boolean }[]).map((p) => p.displayName).sort();
  };
  assert.deepEqual(await lookup(lukas, [peter.id, self.id, unknown]), ['Elena Novak', 'Peter Forster']);
  assert.deepEqual(await lookup(elena, [peter.id, self.id]), ['Elena Novak'], 'Gast sieht andere Namen');
  assert.deepEqual(await lookup(eva, [peter.id]), [], 'fremder Mandant sieht Namen');
  assert.equal((await a().call(lukas, 'POST', '/people/lookup', { ids: [] })).status, 400);
  assert.equal((await a().call(lukas, 'POST', '/people/lookup', { ids: Array(101).fill(unknown) })).status, 400);
});
