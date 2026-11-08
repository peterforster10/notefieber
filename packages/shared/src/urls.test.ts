import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageIdFromSlug, pagePath, pageSlug, shortId, slugify, spacePath, uuidFromShortId } from './urls.ts';

const ID = '01a1bc1b-c003-7b51-b4d7-a9701a1a81d2';

test('kurze ID: immer 22 Zeichen und umkehrbar', () => {
  for (const id of [
    ID,
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '01A1BC1B-C003-7B51-B4D7-A9701A1A81D2',
  ]) {
    const s = shortId(id);
    assert.match(s, /^[0-9A-Za-z]{22}$/);
    assert.equal(uuidFromShortId(s), id.toLowerCase());
  }
  assert.equal(shortId('00000000-0000-0000-0000-000000000000'), '0'.repeat(22));
});

test('kurze ID: Ungültiges wird nicht angenommen', () => {
  assert.throws(() => shortId('keine-uuid'));
  assert.equal(uuidFromShortId('zu-kurz'), undefined);
  assert.equal(uuidFromShortId('z'.repeat(22)), undefined); // größer als 128 Bit
  assert.equal(uuidFromShortId('a'.repeat(21) + '_'), undefined);
});

test('Titel für die Adresse', () => {
  assert.equal(slugify('Gehaltsbänder 2027'), 'gehaltsbaender-2027');
  assert.equal(slugify('Backups und Wiederherstellung'), 'backups-und-wiederherstellung');
  assert.equal(slugify('  Größe & Maß / Café  '), 'groesse-mass-cafe');
  assert.equal(slugify('!!!'), '');
  assert.ok(slugify('a'.repeat(100)).length <= 60);
  assert.equal(slugify(`${'a'.repeat(59)} b`), 'a'.repeat(59));
});

test('Seitenadresse: Titel ist nur Schmuck, die ID zählt', () => {
  const slug = pageSlug('Datenmodell', ID);
  assert.equal(slug, `datenmodell-${shortId(ID)}`);
  assert.equal(pageIdFromSlug(slug), ID);
  assert.equal(pageIdFromSlug(`alter-titel-${shortId(ID)}`), ID);
  assert.equal(pageIdFromSlug(shortId(ID)), ID);
  assert.equal(pageSlug('???', ID), shortId(ID));
  assert.equal(pageIdFromSlug('datenmodell'), undefined);
});

test('Pfade mit kleinem Space-Schlüssel', () => {
  assert.equal(spacePath('ENTW'), '/spaces/entw');
  assert.equal(pagePath('ENTW', { id: ID, title: 'Datenmodell' }), `/spaces/entw/pages/datenmodell-${shortId(ID)}`);
});
