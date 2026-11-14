// Prüft den Login von Ende zu Ende gegen die lokale Umgebung (docs/LOCAL_SETUP.md, Abschnitt 7):
// Frontend (Proxy /api) → API → Zitadel → Rücksprung zur API → Sitzung → /me → Abmelden,
// dazu Fehlerfälle (fremde Organisation, unbekannter Mandant, kein Login-Cookie, fremdes
// returnTo, Logout von fremder Adresse) und die erste Anmeldung über eine Einladung.
// Ändert in der Datenbank: Sitzungen der Testpersonen; beim ersten Lauf lädt Peter Nina Neu
// (nur in Zitadel, nicht in seed.sql) in den Workspace Alpenwerk ein, Nina nimmt an und ist
// danach Mitglied. Spätere Läufe prüfen dann nur noch Ninas normalen Login.
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

async function login(email, tenant, returnTo = '/spaces', invite = undefined) {
  jar.clear();
  const start = invite ? `invite=${invite}` : `tenant=${tenant}`;
  let r = await get(`${WEB}/api/v1/auth/login?${start}&returnTo=${encodeURIComponent(returnTo)}`);
  const authorize = r.headers.get('location');
  // Lehnt die API schon beim Start ab (z. B. benutzte Einladung), leitet sie direkt zurück
  if (r.status !== 302 || !authorize?.startsWith(ZITADEL)) {
    return { error: `Login-Start: ${r.status} ${authorize}`, status: r.status, location: authorize };
  }
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
check(new URL(out.logoutUrl).searchParams.has('id_token_hint'), 'Logout mit id_token_hint (ID-Token aus dem Login)');
const endSession = await fetch(out.logoutUrl, { redirect: 'manual' });
// Mit id_token_hint beendet Zitadel seine Sitzung sofort und leitet direkt zurück; ohne
// käme die Kontenauswahl unter /ui/v2/login/logout (REVIEW.md, R-18)
check(
  [302, 303].includes(endSession.status) && endSession.headers.get('location') === `${WEB}/`,
  `Zitadel meldet ohne Kontenauswahl ab: ${endSession.status} → ${endSession.headers.get('location')?.slice(0, 60)}`,
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
// 8. Erste Anmeldung über eine Einladung: Peter lädt Nina ein (sie gibt es nur in Zitadel)
await login('peter.forster@alpenwerk.example', 'alpenwerk');
const peterCookie = cookieHeader();
const workspaces = await (await fetch(`${WEB}/api/v1/workspaces`, { headers: { cookie: peterCookie } })).json();
const wsId = workspaces.find((w) => w.slug === 'alpenwerk')?.id;
const inv = await fetch(`${WEB}/api/v1/workspaces/${wsId}/invites`, {
  method: 'POST',
  headers: { cookie: peterCookie, origin: WEB, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'nina.neu@alpenwerk.example' }),
});
if (inv.status === 409) {
  // Nina ist seit einem früheren Lauf Mitglied: normaler Login ohne Einladung
  const n = await login('nina.neu@alpenwerk.example', 'alpenwerk');
  check(n.location === `${WEB}/spaces`, `Nina (seit früherem Lauf Mitglied) meldet sich an: ${n.location}`);
} else {
  check(inv.status === 201, `Peter lädt Nina ein: ${inv.status}`);
  const token = new URL((await inv.json()).link).pathname.split('/').pop();
  const before = await login('nina.neu@alpenwerk.example', 'alpenwerk');
  check(before.location === `${WEB}/?loginError=no_account`, `Nina ohne Einladung: ${before.location}`);
  const lukas = await login('lukas.gruber@alpenwerk.example', null, '/', token);
  check(lukas.location === `${WEB}/?loginError=invite_email_mismatch`, `Lukas mit Ninas Einladung: ${lukas.location}`);
  const nina = await login('nina.neu@alpenwerk.example', null, '/spaces', token);
  check(nina.location === `${WEB}/spaces`, `Nina mit Einladung: ${nina.status} ${nina.location}`);
  const me = await (await get(`${WEB}/api/v1/auth/me`)).json();
  check(me.email === 'nina.neu@alpenwerk.example', `/me danach: ${me.displayName}`);
  const again = await login('nina.neu@alpenwerk.example', null, '/', token);
  check(again.location === `${WEB}/?loginError=invite_invalid`, `Einladung nur einmal: ${again.location}`);
}

console.log(failed ? `\n${failed} FEHLER` : '\nAlle Prüfungen bestanden.');
process.exit(failed ? 1 : 0);
