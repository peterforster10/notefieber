import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { safeReturnTo, sameOriginOnly } from './origin.ts';

test('Rücksprung nur auf einen Pfad der eigenen Adresse', () => {
  assert.equal(safeReturnTo('/spaces/ENTW'), '/spaces/ENTW');
  for (const bad of [
    'https://boese.example',
    '//boese.example',
    '/\\boese.example',
    'spaces',
    undefined,
    42,
    '/' + 'a'.repeat(600),
  ]) {
    assert.equal(safeReturnTo(bad), '/', String(bad));
  }
});

function run(method: string, headers: Record<string, string>) {
  let status = 200;
  let passed = false;
  const req = { method, get: (h: string) => headers[h.toLowerCase()] } as unknown as Request;
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  sameOriginOnly('http://localhost:3000')(req, res, (() => (passed = true)) as NextFunction);
  return passed ? 200 : status;
}

test('ändernde Anfragen nur von der eigenen Adresse', () => {
  assert.equal(run('POST', { origin: 'http://localhost:3000' }), 200);
  assert.equal(run('POST', { referer: 'http://localhost:3000/spaces' }), 200);
  assert.equal(run('POST', { origin: 'https://boese.example' }), 403);
  assert.equal(run('POST', {}), 403);
  assert.equal(run('DELETE', { origin: 'http://localhost:3001' }), 403);
  assert.equal(run('GET', { origin: 'https://boese.example' }), 200);
});
