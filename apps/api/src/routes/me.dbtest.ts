// Eigenes Profil über die API (PATCH /me), gegen die Wegwerf-Datenbank mit den Testdaten. In M2
// nur die Sprache der Oberfläche (E15); Name, Bild und Zeitzone kommen mit dem Profil (E02).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp, type TestApp } from '../testing.ts';

const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';
const a = () => app as TestApp;
let lukas = '';
let max = '';

before(async () => {
  if (!app) return;
  lukas = await app.sessionFor('lukas.gruber@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
});
after(async () => {
  if (!app) return;
  // Testdaten wie vorher (Standardwert aus dem Schema)
  await a().call(lukas, 'PATCH', '/me', { locale: 'de' });
  await app.close();
});

const localeOf = async (cookie: string) => {
  const r = await a().call(cookie, 'GET', '/auth/me');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as { locale: string }).locale;
};

test('Sprache: jede Person ändert nur die eigene', { skip }, async () => {
  assert.equal(await localeOf(lukas), 'de');
  const r = await a().call(lukas, 'PATCH', '/me', { locale: 'en' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body as { locale: string }).locale, 'en');
  assert.equal(await localeOf(lukas), 'en');
  assert.equal(await localeOf(max), 'de', 'andere Person geändert');
});

test('Sprache: nur unterstützte Sprachen, nur angemeldet, nur bekannte Felder', { skip }, async () => {
  for (const body of [{ locale: 'fr' }, { locale: '' }, { locale: 'de-AT' }, {}, { locale: 'de', role: 'org_admin' }]) {
    const r = await a().call(lukas, 'PATCH', '/me', body);
    assert.equal(r.status, 400, `${JSON.stringify(body)}: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await a().call(null, 'PATCH', '/me', { locale: 'en' })).status, 401);
});
