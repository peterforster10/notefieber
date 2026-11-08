import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaimError, identityFromClaims } from './claims.ts';

const ZITADEL = {
  subject: 'sub',
  org: 'urn:zitadel:iam:user:resourceowner:id',
  email: 'email',
  emailVerified: 'email_verified',
  name: 'name',
};

// Gekürzt wie das ID-Token von Lukas aus der lokalen Zitadel-Instanz (docs/LOCAL_SETUP.md)
const lukas = {
  sub: 'user-lukas-gruber',
  email: 'lukas.gruber@alpenwerk.example',
  email_verified: true,
  name: 'Lukas Gruber',
  'urn:zitadel:iam:user:resourceowner:id': 'org-alpenwerk',
};

test('Person und Organisation aus einem Zitadel-Token', () => {
  assert.deepEqual(identityFromClaims(lukas, ZITADEL), {
    subject: 'user-lukas-gruber',
    orgId: 'org-alpenwerk',
    email: 'lukas.gruber@alpenwerk.example',
    emailVerified: true,
    displayName: 'Lukas Gruber',
  });
});

test('ohne Person oder Organisation kein Login', () => {
  assert.throws(() => identityFromClaims({ ...lukas, sub: '' }, ZITADEL), ClaimError);
  const { 'urn:zitadel:iam:user:resourceowner:id': _org, ...withoutOrg } = lukas;
  assert.throws(() => identityFromClaims(withoutOrg, ZITADEL), ClaimError);
});

test('E-Mail gilt nur als bestätigt, wenn der Claim genau true ist', () => {
  assert.equal(identityFromClaims({ ...lukas, email_verified: 'true' }, ZITADEL).emailVerified, false);
});

test('andere Claim-Namen für einen anderen Login-Dienst', () => {
  const names = { ...ZITADEL, org: 'tid' };
  assert.equal(identityFromClaims({ sub: 'x', tid: 'tenant-1' }, names).orgId, 'tenant-1');
});
