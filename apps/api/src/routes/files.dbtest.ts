// Bilder hochladen und ansehen über die API (E11, E07), gegen die Wegwerf-Datenbank mit den
// Testdaten. Dateien liegen im Test im RAM (memoryStore) statt in Garage.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp, type TestApp } from '../testing.ts';
import { detectImage, fileName } from './files.ts';

const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';
const a = () => app as TestApp;
let lukas = '';
let max = '';
let elena = '';
let eva = '';
let page = '';

// Kleinste gültige Dateianfänge; die API prüft nur die ersten Bytes
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const GIF = new TextEncoder().encode('GIF89a-rest');
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

before(async () => {
  if (!app) return;
  lukas = await app.sessionFor('lukas.gruber@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
  elena = await app.sessionFor('elena.novak@agentur-nord.example');
  eva = await app.sessionFor('eva.fischer@nordlicht.example', 'nordlicht');
  const space = (await app.call(lukas, 'GET', '/spaces/ENTW')).body;
  const r = await app.call(lukas, 'POST', '/spaces/ENTW/pages', { parentId: space.homePageId, title: 'Mit Bildern' });
  assert.equal(r.status, 201);
  page = r.body.id;
});
after(() => app?.close());

const upload = (cookie: string | null, pageId: string, bytes: Uint8Array, name = 'Bild%20%C3%BC.png') =>
  a().fetch(cookie, 'POST', `/pages/${pageId}/files`, {
    body: bytes,
    headers: { 'content-type': 'image/png', 'x-file-name': name },
  });

test('Bildtyp an den ersten Bytes, Dateiname bereinigt', () => {
  assert.equal(detectImage(PNG)?.mime, 'image/png');
  assert.equal(detectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.mime, 'image/jpeg');
  assert.equal(detectImage(GIF)?.mime, 'image/gif');
  assert.equal(detectImage(WEBP)?.mime, 'image/webp');
  assert.equal(detectImage(SVG), undefined);
  assert.equal(detectImage(new Uint8Array()), undefined);
  assert.equal(fileName('Bild%20%C3%BC.png', 'png'), 'Bild ü.png');
  assert.equal(fileName('..%2F..%2Fetc%2Fpasswd', 'png'), 'passwd');
  assert.equal(fileName('%E0%A4%A', 'gif'), 'bild.gif');
  assert.equal(fileName(undefined, 'png'), 'bild.png');
  assert.equal(fileName('a\u0007b', 'png'), 'ab');
  assert.equal(fileName('x'.repeat(300), 'png').length, 255);
});

test('Bearbeitende laden hoch, Lesende sehen es, andere nicht', { skip }, async () => {
  const r = await upload(lukas, page, PNG);
  assert.equal(r.status, 201, await r.clone().text());
  const body = (await r.json()) as { id: string; url: string; name: string; mime: string; size: number };
  assert.equal(body.url, `/api/v1/files/${body.id}`);
  assert.deepEqual([body.name, body.mime, body.size], ['Bild ü.png', 'image/png', PNG.length]);

  const get = await a().fetch(max, 'GET', `/files/${body.id}`);
  assert.equal(get.status, 200, 'Max (Leser) sieht das Bild nicht');
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), PNG);
  assert.equal(get.headers.get('content-type'), 'image/png');
  assert.equal(get.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(get.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.match(get.headers.get('content-disposition') ?? '', /^inline; filename\*=UTF-8''Bild%20%C3%BC\.png$/);

  // Gast ohne Recht auf den Space, fremder Mandant, ohne Anmeldung: wie nicht vorhanden
  assert.equal((await a().fetch(elena, 'GET', `/files/${body.id}`)).status, 404);
  assert.equal((await a().fetch(eva, 'GET', `/files/${body.id}`)).status, 404);
  assert.equal((await a().fetch(null, 'GET', `/files/${body.id}`)).status, 401);
  assert.equal((await a().fetch(lukas, 'GET', '/files/019a5b3c-0000-7000-8000-0000000000ff')).status, 404);
  assert.equal((await a().fetch(lukas, 'GET', '/files/kaputt')).status, 400);
});

test('Lesende, Personen ohne Recht und fremde Mandanten laden nicht hoch', { skip }, async () => {
  const before = a().store.keys().length;
  assert.equal((await upload(max, page, PNG)).status, 403);
  assert.equal((await upload(elena, page, PNG)).status, 404);
  assert.equal((await upload(eva, page, PNG)).status, 404);
  assert.equal((await upload(null, page, PNG)).status, 401);
  // Von fremder Adresse (CSRF): abgelehnt, bevor etwas gespeichert wird
  const foreign = await fetch(`${a().base}/pages/${page}/files`, {
    method: 'POST',
    headers: { origin: 'https://evil.example', cookie: lukas },
    body: PNG,
  });
  assert.equal(foreign.status, 403);
  assert.equal(a().store.keys().length, before, 'abgelehnte Uploads liegen im Speicher');
});

test('Nur Bilder, nicht zu groß, nicht leer, nicht in den Papierkorb', { skip }, async () => {
  assert.equal((await upload(lukas, page, SVG, 'x.svg')).status, 415);
  assert.equal((await upload(lukas, page, new TextEncoder().encode('<html>'), 'x.png')).status, 415);
  assert.equal((await upload(lukas, page, new Uint8Array())).status, 400);
  const big = new Uint8Array(1024 * 1024 + 1);
  big.set(PNG);
  assert.equal((await upload(lukas, page, big)).status, 413);
  assert.equal((await upload(lukas, page, GIF, 'a.gif')).status, 201);

  const space = (await a().call(lukas, 'GET', '/spaces/ENTW')).body;
  const r = await a().call(lukas, 'POST', '/spaces/ENTW/pages', { parentId: space.homePageId, title: 'Gleich weg' });
  assert.equal((await a().call(lukas, 'DELETE', `/pages/${r.body.id}`)).status, 200);
  assert.equal((await upload(lukas, r.body.id, PNG)).status, 409);
});

test('mit FILES_REQUIRE_SCAN nur geprüfte Dateien', { skip }, async () => {
  const strict = (await startTestApp({ env: { FILES_REQUIRE_SCAN: 'true' } }))!;
  try {
    const cookie = await strict.sessionFor('lukas.gruber@alpenwerk.example');
    const r = await strict.fetch(cookie, 'POST', `/pages/${page}/files`, { body: PNG });
    assert.equal(r.status, 201);
    const { id } = (await r.json()) as { id: string };
    const get = await strict.fetch(cookie, 'GET', `/files/${id}`);
    assert.equal(get.status, 409);
    assert.equal(((await get.json()) as { error: string }).error, 'scan_pending');
  } finally {
    await strict.close();
  }
});
