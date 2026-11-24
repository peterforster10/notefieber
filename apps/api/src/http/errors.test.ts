import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { DB_RULES, toHttpError } from './errors.ts';

const schemaDir = new URL('../../../../database/scripts/schema/', import.meta.url);
const schema = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(new URL(f, schemaDir), 'utf8'))
  .join('\n');

const pgError = (code: string, message: string) => Object.assign(new Error(message), { code, severity: 'ERROR' });

test('jede Meldung aus DB_RULES steht genau so im Schema', () => {
  for (const message of Object.keys(DB_RULES)) {
    assert.ok(schema.includes(`'${message}'`), `nicht im Schema (geändert?): ${message}`);
  }
});

test('Codes sind kurz und stabil (Schlüssel in apps/web/messages)', () => {
  for (const code of Object.values(DB_RULES)) assert.match(code, /^[a-z][a-z_]{2,40}$/);
});

test('bekannte Regel: Code dazu, Meldung ohne Funktionsnamen', () => {
  const http = toHttpError(pgError('P0001', 'trash_page: Die Startseite eines Spaces kann nicht gelöscht werden'));
  assert.deepEqual(http, {
    status: 409,
    body: {
      error: 'rejected',
      code: 'home_page_not_deletable',
      message: 'Die Startseite eines Spaces kann nicht gelöscht werden',
    },
  });
  const forbidden = toHttpError(pgError('42501', 'Unter dieser Seite liegen Seiten, die du nicht bearbeiten darfst'));
  assert.equal(forbidden?.status, 403);
  assert.equal(forbidden?.body.error, 'forbidden');
  assert.equal(forbidden?.body.code, 'subpages_not_editable');
});

test('unbekannte Regel: nur die Art, kein Code', () => {
  const http = toHttpError(pgError('P0001', 'set_grant: Seite nicht gefunden'));
  assert.deepEqual(http, { status: 409, body: { error: 'rejected', message: 'Seite nicht gefunden' } });
  assert.equal(toHttpError(pgError('23505', 'duplicate key'))?.body.error, 'conflict');
  assert.equal(toHttpError(new z.ZodError([]))?.status, 400);
  assert.equal(toHttpError(new Error('anderes')), undefined);
});
