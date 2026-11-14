// Einladungen über die API und die Entscheidung beim Login (resolveAccount), gegen eine echte
// Datenbank mit den Testdaten aus seed.sql (siehe testing.ts). Statt Zitadel liefern die Tests
// die Identität aus dem Login selbst.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { resolveAccount } from '../auth/accounts.ts';
import type { Identity } from '../auth/claims.ts';
import { startTestApp, type TestApp } from '../testing.ts';

const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';
const a = () => app as TestApp;
const run = Date.now().toString(36);
let peter = '';
let max = '';
let workspaceId = '';
let tenantId = '';

before(async () => {
  if (!app) return;
  peter = await app.sessionFor('peter.forster@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
  tenantId = await app.tenantId();
  const ws = (await app.call(peter, 'GET', '/workspaces')).body as { id: string; slug: string }[];
  workspaceId = ws.find((w) => w.slug === 'alpenwerk')!.id;
});
after(() => app?.close());

const identity = (over: Partial<Identity>): Identity => ({
  subject: `sub-${run}-${Math.random().toString(36).slice(2)}`,
  orgId: 'org-alpenwerk',
  email: undefined,
  emailVerified: true,
  displayName: 'Neue Person',
  ...over,
});
const tokenOf = (link: string) => new URL(link).pathname.split('/').pop()!;
async function invite(email: string, role = 'member') {
  const r = await a().call(peter, 'POST', `/workspaces/${workspaceId}/invites`, { email, role });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.id as string, token: tokenOf(r.body.link) };
}

test('nur Admins des Workspaces laden ein und sehen Einladungen', { skip }, async () => {
  const r = await a().call(max, 'POST', `/workspaces/${workspaceId}/invites`, { email: `x-${run}@alpenwerk.example` });
  assert.equal(r.status, 403);
  assert.equal((await a().call(max, 'GET', `/workspaces/${workspaceId}/invites`)).status, 403);
  assert.equal((await a().call(null, 'GET', `/workspaces/${workspaceId}/invites`)).status, 401);
});

test('Einladung anlegen, vor dem Login ansehen, auflisten, zurücknehmen', { skip }, async () => {
  const email = `neu-${run}@alpenwerk.example`;
  const r = await a().call(peter, 'POST', `/workspaces/${workspaceId}/invites`, { email, role: 'guest' });
  assert.equal(r.status, 201);
  assert.match(r.body.link, /^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
  const token = tokenOf(r.body.link);

  const pub = await a().call(null, 'GET', `/invites/${token}`);
  assert.equal(pub.status, 200);
  assert.deepEqual(
    { email: pub.body.email, role: pub.body.role, workspace: pub.body.workspaceName, by: pub.body.invitedBy },
    { email, role: 'guest', workspace: 'Alpenwerk', by: 'Peter Forster' },
  );
  assert.equal((await a().call(null, 'GET', `/invites/${'x'.repeat(43)}`)).status, 404);

  const list = (await a().call(peter, 'GET', `/workspaces/${workspaceId}/invites`)).body as {
    id: string;
    status: string;
  }[];
  assert.equal(list.find((i) => i.id === r.body.id)?.status, 'open');

  assert.equal((await a().call(max, 'DELETE', `/invites/${r.body.id}`)).status, 404, 'Max nimmt Einladung zurück');
  assert.equal((await a().call(peter, 'DELETE', `/invites/${r.body.id}`)).status, 204);
  assert.equal((await a().call(null, 'GET', `/invites/${token}`)).status, 404, 'zurückgenommene Einladung gilt');
  const res = await resolveAccount(a().db, { tenantId, identity: identity({ email }), inviteToken: token });
  assert.deepEqual(res, { error: 'invite_invalid' });
});

test('wer schon Mitglied ist, wird nicht eingeladen', { skip }, async () => {
  const r = await a().call(peter, 'POST', `/workspaces/${workspaceId}/invites`, {
    email: 'Lukas.Gruber@alpenwerk.example',
  });
  assert.equal(r.status, 409);
});

test('Login mit Einladung: nur mit derselben, bestätigten E-Mail', { skip }, async () => {
  const email = `nina-${run}@alpenwerk.example`;
  const { token } = await invite(email);
  const nina = identity({ email: email.toUpperCase(), displayName: 'Nina Neu' });

  // Ohne Einladung kein Zugang, mit fremder oder unbestätigter E-Mail auch nicht
  assert.deepEqual(await resolveAccount(a().db, { tenantId, identity: nina }), { error: 'no_account' });
  assert.deepEqual(
    await resolveAccount(a().db, {
      tenantId,
      identity: { ...nina, email: 'andere@alpenwerk.example' },
      inviteToken: token,
    }),
    { error: 'invite_email_mismatch' },
  );
  assert.deepEqual(
    await resolveAccount(a().db, { tenantId, identity: { ...nina, emailVerified: false }, inviteToken: token }),
    { error: 'invite_email_mismatch' },
  );

  const ok = await resolveAccount(a().db, { tenantId, identity: nina, inviteToken: token });
  assert.ok('userId' in ok && ok.acceptedInvite, JSON.stringify(ok));
  // Einladung nur einmal, danach kommt Nina über ihr Login hinein
  assert.deepEqual(await resolveAccount(a().db, { tenantId, identity: nina, inviteToken: token }), {
    error: 'invite_invalid',
  });
  assert.deepEqual(await resolveAccount(a().db, { tenantId, identity: nina }), {
    userId: (ok as { userId: string }).userId,
    acceptedInvite: false,
  });

  // Nina ist jetzt Mitglied und sieht die Spaces, die alle im Workspace lesen
  const cookie = await a().sessionFor(email, 'alpenwerk', nina.subject);
  const spaces = (await a().call(cookie, 'GET', '/spaces')).body.map((s: { key: string }) => s.key);
  assert.ok(spaces.includes('ENTW') && !spaces.includes('PERS'), spaces.join(','));
});

test('Einladung an eine andere Adresse einer Person, die es schon gibt (REVIEW.md, R-04)', { skip }, async () => {
  // Lukas hat ein Login (seed.sql); die Einladung geht an eine zweite, bestätigte Adresse,
  // z. B. nach einer Änderung im Login-Dienst. Er bleibt dieselbe Person, statt dass der
  // Login an der Eindeutigkeit des Logins scheitert.
  const lukas = identity({ subject: 'user-lukas-gruber', displayName: 'Lukas Gruber' });
  const known = await resolveAccount(a().db, { tenantId, identity: lukas });
  assert.ok('userId' in known, JSON.stringify(known));

  const email = `l.gruber-${run}@alpenwerk.example`;
  const { token } = await invite(email);
  const res = await resolveAccount(a().db, { tenantId, identity: { ...lukas, email }, inviteToken: token });
  assert.deepEqual(res, { userId: known.userId, acceptedInvite: true });
});

test('Login mit gültigem Einladungslink findet den Mandanten aus der Einladung', { skip }, async () => {
  const { token } = await invite(`link-${run}@alpenwerk.example`);
  const res = await fetch(`${a().base}/auth/login?invite=${token}`, { redirect: 'manual' });
  // Im Test gibt es keinen erreichbaren Login-Dienst (http ist nicht erlaubt): Die API kommt
  // bis zur Weiterleitung, also sind Einladung und Mandant gefunden (sonst invite_invalid
  // bzw. unknown_tenant)
  assert.equal(res.headers.get('location'), 'http://localhost:3000/?loginError=unavailable');
});

test('Login mit ungültigem Einladungslink führt zur Fehlermeldung', { skip }, async () => {
  const res = await fetch(`${a().base}/auth/login?invite=${'y'.repeat(43)}`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), 'http://localhost:3000/?loginError=invite_invalid');
});
