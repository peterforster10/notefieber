// Abmelde-Adresse beim Login-Dienst (REVIEW.md, R-18): Mit dem ID-Token aus dem Login als
// id_token_hint beendet Zitadel die eigene Sitzung ohne Kontenauswahl.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endSessionUrl, oidc, uiLocales } from './oidc.ts';

const config = new oidc.Configuration(
  { issuer: 'https://login.example', end_session_endpoint: 'https://login.example/oidc/v1/end_session' },
  'client-1',
);

test('mit ID-Token: id_token_hint, Rücksprung und Client', () => {
  const url = new URL(
    endSessionUrl(config, { clientId: 'client-1', postLogoutRedirectUri: 'https://wiki.example/', idToken: 'eyJ.x.y' }),
  );
  assert.equal(url.origin + url.pathname, 'https://login.example/oidc/v1/end_session');
  assert.equal(url.searchParams.get('id_token_hint'), 'eyJ.x.y');
  assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'https://wiki.example/');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
});

test('ohne ID-Token (ältere Sitzung): ohne Hinweis, sonst gleich', () => {
  const url = new URL(endSessionUrl(config, { clientId: 'client-1', postLogoutRedirectUri: 'https://wiki.example/' }));
  assert.equal(url.searchParams.has('id_token_hint'), false);
  assert.equal(url.searchParams.get('post_logout_redirect_uri'), 'https://wiki.example/');
});

test('Sprache der Anmeldeseite aus dem Cookie der Oberfläche, nur unterstützte', () => {
  assert.equal(uiLocales({ nf_locale: 'en' }), 'en');
  assert.equal(uiLocales({ nf_locale: 'de', nf_session: 'x' }), 'de');
  assert.equal(uiLocales({ nf_locale: 'fr' }), undefined);
  assert.equal(uiLocales({ nf_locale: 'en de' }), undefined);
  assert.equal(uiLocales({}), undefined);
});
