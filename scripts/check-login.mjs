// Prüft den Login von Ende zu Ende gegen die lokale Umgebung (docs/LOCAL_SETUP.md, Abschnitt 7):
// Frontend (Proxy /api) → API → Zitadel → Rücksprung zur API → Sitzung → /me → Abmelden,
// dazu Fehlerfälle (fremde Organisation, unbekannter Mandant, kein Login-Cookie, fremdes
// returnTo, Logout von fremder Adresse). Ändert nichts außer Sitzungen der Testpersonen.
//
// Voraussetzung: docker compose läuft, pnpm dev:api und pnpm dev:web laufen.
//   node scripts/check-login.mjs "$(docker compose exec -T zitadel-init cat /zitadel/bootstrap/login-client.pat)"
//
// Die Anmeldung bei Zitadel übernimmt statt der Anmeldeseite die Session-API, so wie es die
// Anmeldeseite selbst tut; dafür braucht es das Token des Dienstkontos login-client.
const WEB = process.env.PUBLIC_URL ?? 'http://localhost:3000';
const ZITADEL = process.env.OIDC_ISSUER ?? 'http://localhost:8080';
const PAT = (process.argv[2] ?? '').trim();
const PASSWORD = process.env.NF_TEST_PASSWORD ?? 'NoteFieber-lokal-1';
if (!PAT) {
  console.error('Aufruf: node scripts/check-login.mjs <PAT von login-client> (siehe Kopf der Datei)');
  process.exit(2);
}
const jar = new Map();
let failed = 0;

function check(cond, msg) {
  console.log(`${cond ? 'OK  ' : 'FEHLER'} ${msg}`);
  if (!cond) failed++;
}
function store(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    if (/Max-Age=0/.test(c)) jar.delete(k);
    else jar.set(k, v);
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function get(url, extra = {}) {
  const res = await fetch(url, { redirect: 'manual', headers: { cookie: cookieHeader(), ...extra } });
  store(res);
  return res;
}
async function zitadel(method, body) {
  const res = await fetch(`${ZITADEL}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PAT}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function login(email, tenant, returnTo = '/spaces') {
  jar.clear();
  let r = await get(`${WEB}/api/v1/auth/login?tenant=${tenant}&returnTo=${encodeURIComponent(returnTo)}`);
  const authorize = r.headers.get('location');
  if (r.status !== 302 || !authorize?.startsWith(ZITADEL)) return { error: `Login-Start: ${r.status} ${authorize}` };
  const scope = new URL(authorize).searchParams.get('scope');
  r = await fetch(authorize, { redirect: 'manual' });
  const loginPage = new URL(r.headers.get('location'), ZITADEL);
  const authRequestId = loginPage.searchParams.get('authRequest');
  const s = await zitadel('zitadel.session.v2.SessionService/CreateSession', {
    checks: { user: { loginName: email }, password: { password: PASSWORD } },
  });
  let cb;
  try {
    cb = await zitadel('zitadel.oidc.v2.OIDCService/CreateCallback', {
      authRequestId,
      session: { sessionId: s.sessionId, sessionToken: s.sessionToken },
    });
  } catch (err) {
    return { scope, zitadelRejected: err.message };
  }
  r = await get(cb.callbackUrl);
  return { scope, callbackUrl: cb.callbackUrl, status: r.status, location: r.headers.get('location') };
}

// 1. ohne Sitzung
let r = await get(`${WEB}/api/v1/auth/me`);
check(r.status === 401, `/me ohne Sitzung: 401 (${r.status})`);

// 2. Login als Peter bei Alpenwerk
const p = await login('peter.forster@alpenwerk.example', 'alpenwerk');
check(p.scope?.includes('urn:zitadel:iam:org:id:org-alpenwerk'), `Scope beschränkt auf die Organisation: ${p.scope}`);
check(
  p.callbackUrl?.startsWith(`${WEB}/api/v1/auth/callback?`),
  `Rücksprung über das Frontend: ${p.callbackUrl?.slice(0, 60)}…`,
);
check(
  p.status === 302 && p.location === `${WEB}/spaces`,
  `nach dem Login zurück zu returnTo: ${p.status} ${p.location}`,
);
check(jar.has('nf_session') && !jar.has('nf_login'), 'Sitzungs-Cookie gesetzt, Login-Cookie gelöscht');

r = await get(`${WEB}/api/v1/auth/me`);
const me = await r.json();
check(
  r.status === 200 &&
    me.email === 'peter.forster@alpenwerk.example' &&
    me.orgRole === 'org_admin' &&
    me.tenant.slug === 'alpenwerk',
  `/me: ${me.displayName}, ${me.orgRole}, ${me.tenant?.slug}`,
);

// 3. Abmelden: ohne eigene Herkunft abgelehnt, mit erlaubt
const oldToken = jar.get('nf_session');
r = await fetch(`${WEB}/api/v1/auth/logout`, {
  method: 'POST',
  headers: { cookie: cookieHeader(), origin: 'https://boese.example' },
});
check(r.status === 403, `Logout von fremder Adresse: 403 (${r.status})`);
r = await fetch(`${WEB}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader(), origin: WEB } });
store(r);
const out = await r.json();
check(
  r.status === 200 && out.logoutUrl.startsWith(`${ZITADEL}/oidc/v1/end_session`),
  `Logout: ${out.logoutUrl.slice(0, 70)}…`,
);
const endSession = await fetch(out.logoutUrl, { redirect: 'manual' });
check(
  [302, 303].includes(endSession.status),
  `Zitadel nimmt die Abmeldung an: ${endSession.status} → ${endSession.headers.get('location')?.slice(0, 60)}`,
);
check(!jar.has('nf_session'), 'Cookie im Browser gelöscht');
r = await fetch(`${WEB}/api/v1/auth/me`, { headers: { cookie: `nf_session=${oldToken}` } });
check(r.status === 401, `alte Sitzung gilt nach dem Logout nicht mehr: ${r.status}`);

// 4. Eva (Nordlicht) versucht Alpenwerk
const e = await login('eva.fischer@nordlicht.example', 'alpenwerk');
check(
  Boolean(e.zitadelRejected) || e.location?.includes('loginError=wrong_organization'),
  `Eva bei Alpenwerk abgelehnt: ${e.zitadelRejected ? 'von Zitadel (Organisation passt nicht zum Scope)' : e.location}`,
);

// 5. unbekannter Mandant
r = await get(`${WEB}/api/v1/auth/login?tenant=gibtsnicht`);
check(
  r.headers.get('location') === `${WEB}/?loginError=unknown_tenant`,
  `unbekannter Mandant: ${r.headers.get('location')}`,
);

// 6. Rücksprung ohne Login-Cookie
jar.clear();
r = await get(`${WEB}/api/v1/auth/callback?code=x&state=y`);
check(
  r.headers.get('location') === `${WEB}/?loginError=expired`,
  `Rücksprung ohne Login-Cookie: ${r.headers.get('location')}`,
);

// 7. returnTo auf eine fremde Seite führt auf /
const q = await login('peter.forster@alpenwerk.example', 'alpenwerk', 'https://boese.example/x');
check(q.location === `${WEB}/`, `fremdes returnTo: ${q.location}`);
console.log(failed ? `\n${failed} FEHLER` : '\nAlle Prüfungen bestanden.');
process.exit(failed ? 1 : 0);
