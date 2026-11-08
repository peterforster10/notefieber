import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearCookie, parseCookies, serializeCookie, sign, verify } from './cookies.ts';

const SECRET = 'x'.repeat(32);

test('signierte Werte kommen unverändert zurück', () => {
  const value = { state: 'abc', n: 1 };
  assert.deepEqual(verify(SECRET, sign(SECRET, value)), value);
});

test('veränderte oder fremd signierte Werte werden abgelehnt', () => {
  const signed = sign(SECRET, { tenantId: 'a' });
  const [data, mac] = signed.split('.');
  const forged = Buffer.from(JSON.stringify({ tenantId: 'b' })).toString('base64url');
  assert.equal(verify(SECRET, `${forged}.${mac}`), undefined);
  assert.equal(verify('y'.repeat(32), signed), undefined);
  assert.equal(verify(SECRET, `${data}.`), undefined);
  assert.equal(verify(SECRET, 'kaputt'), undefined);
  assert.equal(verify(SECRET, undefined), undefined);
});

test('Cookies lesen', () => {
  assert.deepEqual(parseCookies('a=1; nf_session=xyz;b=%20c'), { a: '1', nf_session: 'xyz', b: ' c' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('ohne-wert; =leer; x=%E0'), {});
});

test('Cookies schreiben: HttpOnly und SameSite immer, Secure nach Einstellung', () => {
  const c = serializeCookie('nf_session', 'abc', { maxAgeSeconds: 60, path: '/', secure: true });
  assert.equal(c, 'nf_session=abc; Path=/; Max-Age=60; SameSite=Lax; HttpOnly; Secure');
  assert.equal(
    clearCookie('nf_login', '/api/v1/auth', false),
    'nf_login=; Path=/api/v1/auth; Max-Age=0; SameSite=Lax; HttpOnly',
  );
});
