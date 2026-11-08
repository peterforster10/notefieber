// Login, Rücksprung, Abmelden, angemeldete Person (docs/CONCEPTS.md, Abschnitt 5).
//
//   GET  /api/v1/auth/login?tenant=<kurzname>&returnTo=/…   Weiterleitung zum Login-Dienst
//   GET  /api/v1/auth/login?invite=<token>                  dasselbe mit Einladung (Mandant aus ihr)
//   GET  /api/v1/auth/callback                              Rücksprung, legt die Sitzung an
//   POST /api/v1/auth/logout                                Sitzung beenden, liefert logoutUrl
//   GET  /api/v1/auth/me                                    angemeldete Person
//
// Fehler beim Login führen zurück auf die Startseite mit ?loginError=<code>, weil der
// Browser hier navigiert und kein JSON erwartet.
import express, { type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { slugSchema } from '@notefieber/shared';
import type { ApiConfig } from '../config.ts';
import { withContext } from '../db.ts';
import { clearCookie, parseCookies, serializeCookie, sign, verify } from '../http/cookies.ts';
import { safeReturnTo } from '../http/origin.ts';
import { findInvite, resolveAccount, type AccountError } from './accounts.ts';
import { ClaimError, identityFromClaims } from './claims.ts';
import { type Oidc, oidc, scopesFor } from './oidc.ts';
import { SESSION_COOKIE, getAuth, hashToken, newSessionToken, requireAuth, sessionToken } from './session.ts';

const LOGIN_COOKIE = 'nf_login';
const LOGIN_COOKIE_PATH = '/api/v1/auth';
const LOGIN_MAX_AGE = 10 * 60; // Sekunden zwischen Login-Start und Rücksprung

const loginState = z.object({
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  tenantId: z.uuid(),
  orgId: z.string(),
  returnTo: z.string(),
  /** Token der Einladung, falls der Login über einen Einladungslink begann */
  invite: z.string().optional(),
  exp: z.number(),
});

export type LoginError =
  AccountError | 'unknown_tenant' | 'login_failed' | 'wrong_organization' | 'expired' | 'unavailable';

const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export function authRouter(c: ApiConfig, db: pg.Pool, idp: Oidc) {
  const router = express.Router();
  const home = (error?: LoginError) => {
    const url = new URL('/', c.PUBLIC_URL);
    if (error) url.searchParams.set('loginError', error);
    return url.href;
  };

  router.get('/login', async (req: Request, res: Response) => {
    let tenant: { tenant_id: string; idp_org_id: string | null } | undefined;
    let invite: string | undefined;
    if (req.query.invite !== undefined) {
      // Mit Einladung: Der Mandant kommt aus der Einladung, nicht aus einer Eingabe
      const token = inviteToken.safeParse(req.query.invite);
      const found = token.success ? await findInvite(db, token.data) : undefined;
      if (!found) return res.redirect(home('invite_invalid'));
      invite = token.data;
      tenant = await withContext(db, { tenantId: found.tenant_id }, async (tx) => {
        const r = await tx.query<{ tenant_id: string; idp_org_id: string | null }>(
          'SELECT id AS tenant_id, idp_org_id FROM tenants WHERE id = $1',
          [found.tenant_id],
        );
        return r.rows[0];
      });
    } else {
      const slug = slugSchema.safeParse(req.query.tenant);
      if (!slug.success) return res.redirect(home('unknown_tenant'));
      const { rows } = await db.query<{ tenant_id: string; idp_org_id: string | null }>(
        'SELECT tenant_id, idp_org_id FROM app.resolve_tenant($1)',
        [slug.data],
      );
      tenant = rows[0];
    }
    if (!tenant?.idp_org_id) return res.redirect(home('unknown_tenant'));

    let config: oidc.Configuration;
    try {
      config = await idp.configuration();
    } catch (err) {
      console.error('Login: Login-Dienst nicht erreichbar', err);
      return res.redirect(home('unavailable'));
    }
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: c.OIDC_REDIRECT_URI,
      scope: scopesFor(c, tenant.idp_org_id),
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    const value = sign(c.AUTH_COOKIE_SECRET, {
      state,
      nonce,
      verifier,
      tenantId: tenant.tenant_id,
      orgId: tenant.idp_org_id,
      returnTo: safeReturnTo(req.query.returnTo),
      ...(invite ? { invite } : {}),
      exp: Date.now() + LOGIN_MAX_AGE * 1000,
    } satisfies z.infer<typeof loginState>);
    res.setHeader(
      'Set-Cookie',
      serializeCookie(LOGIN_COOKIE, value, {
        maxAgeSeconds: LOGIN_MAX_AGE,
        path: LOGIN_COOKIE_PATH,
        secure: c.COOKIE_SECURE,
      }),
    );
    res.redirect(url.href);
  });

  router.get('/callback', async (req: Request, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const parsed = loginState.safeParse(verify(c.AUTH_COOKIE_SECRET, cookies[LOGIN_COOKIE]));
    const clearLogin = clearCookie(LOGIN_COOKIE, LOGIN_COOKIE_PATH, c.COOKIE_SECURE);
    if (!parsed.success || parsed.data.exp < Date.now()) {
      res.setHeader('Set-Cookie', clearLogin);
      return res.redirect(home('expired'));
    }
    const login = parsed.data;

    // Die Parameter des Rücksprungs an die registrierte Adresse hängen: Die Anfrage kommt
    // über das Frontend (Proxy) und kennt ihre öffentliche Adresse sonst nicht.
    const currentUrl = new URL(c.OIDC_REDIRECT_URI);
    currentUrl.search = new URL(req.originalUrl, 'http://intern').search;

    let claims: Record<string, unknown>;
    try {
      const tokens = await oidc.authorizationCodeGrant(await idp.configuration(), currentUrl, {
        pkceCodeVerifier: login.verifier,
        expectedState: login.state,
        expectedNonce: login.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims() ?? {};
    } catch (err) {
      console.warn('Login: Rücksprung abgelehnt', err instanceof Error ? err.message : err);
      res.setHeader('Set-Cookie', clearLogin);
      return res.redirect(home('login_failed'));
    }

    let identity;
    try {
      identity = identityFromClaims(claims, {
        subject: c.OIDC_CLAIM_SUBJECT,
        org: c.OIDC_CLAIM_ORG,
        email: c.OIDC_CLAIM_EMAIL,
        emailVerified: c.OIDC_CLAIM_EMAIL_VERIFIED,
        name: c.OIDC_CLAIM_NAME,
      });
    } catch (err) {
      if (!(err instanceof ClaimError)) throw err;
      console.warn('Login:', err.message);
      res.setHeader('Set-Cookie', clearLogin);
      return res.redirect(home('login_failed'));
    }
    // Die Person muss zur Organisation des Mandanten gehören, bei dem der Login begann
    if (identity.orgId !== login.orgId) {
      res.setHeader('Set-Cookie', clearLogin);
      return res.redirect(home('wrong_organization'));
    }

    // Person im Wiki finden; neue Personen kommen nur über eine Einladung (auth/accounts.ts)
    const account = await resolveAccount(db, { tenantId: login.tenantId, identity, inviteToken: login.invite });
    if ('error' in account) {
      res.setHeader('Set-Cookie', clearLogin);
      return res.redirect(home(account.error));
    }
    const user = { id: account.userId };

    const token = newSessionToken();
    const expires = new Date(Date.now() + c.SESSION_HOURS * 3600 * 1000);
    await withContext(db, { tenantId: login.tenantId, userId: user.id }, (tx) =>
      tx.query('SELECT app.create_session($1, $2, $3, $4)', [
        user.id,
        hashToken(token),
        expires,
        req.get('user-agent') ?? null,
      ]),
    );
    res.setHeader('Set-Cookie', [
      clearLogin,
      serializeCookie(SESSION_COOKIE, token, {
        maxAgeSeconds: c.SESSION_HOURS * 3600,
        path: '/',
        secure: c.COOKIE_SECURE,
      }),
    ]);
    res.redirect(new URL(login.returnTo, c.PUBLIC_URL).href);
  });

  router.post('/logout', async (req: Request, res: Response) => {
    const token = sessionToken(req);
    if (token) await db.query('SELECT app.end_session($1)', [hashToken(token)]);
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE, '/', c.COOKIE_SECURE));
    // Auch beim Login-Dienst abmelden; das Frontend leitet dorthin weiter.
    let logoutUrl = home();
    try {
      logoutUrl = oidc.buildEndSessionUrl(await idp.configuration(), {
        client_id: c.OIDC_CLIENT_ID,
        post_logout_redirect_uri: home(),
      }).href;
    } catch {
      // Login-Dienst nicht erreichbar: lokal abgemeldet ist man trotzdem
    }
    res.json({ logoutUrl });
  });

  router.get('/me', requireAuth, async (_req: Request, res: Response) => {
    const auth = getAuth(res)!;
    const me = await withContext(db, { tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        email: string;
        display_name: string;
        role: string;
        locale: string;
        tenant_slug: string;
        tenant_name: string;
      }>(
        `SELECT u.id, u.email, u.display_name, u.role, u.locale, t.slug AS tenant_slug, t.name AS tenant_name
         FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
        [auth.userId],
      );
      return rows[0];
    });
    if (!me) return res.status(401).json({ error: 'unauthenticated' });
    res.json({
      id: me.id,
      email: me.email,
      displayName: me.display_name,
      orgRole: me.role,
      locale: me.locale,
      tenant: { id: auth.tenantId, slug: me.tenant_slug, name: me.tenant_name },
    });
  });

  return router;
}
