// Sitzungen: zufälliges Token im Cookie nf_session, in der Datenbank nur sein SHA-256-Hash
// (Tabelle sessions, app.create_session / resolve_session / end_session). Jede Anfrage mit
// Cookie schlägt die Sitzung nach; Abmelden und Deaktivieren wirken damit sofort.
import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type pg from 'pg';
import { parseCookies } from '../http/cookies.ts';

export const SESSION_COOKIE = 'nf_session';

export interface Auth {
  sessionId: string;
  tenantId: string;
  userId: string;
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || undefined;
}

/** Setzt res.locals.auth, wenn das Cookie zu einer gültigen Sitzung gehört. */
export function loadSession(db: pg.Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = sessionToken(req);
    if (token) {
      const { rows } = await db.query<{ session_id: string; tenant_id: string; user_id: string }>(
        'SELECT session_id, tenant_id, user_id FROM app.resolve_session($1)',
        [hashToken(token)],
      );
      const s = rows[0];
      if (s) res.locals.auth = { sessionId: s.session_id, tenantId: s.tenant_id, userId: s.user_id } satisfies Auth;
    }
    next();
  };
}

export function getAuth(res: Response): Auth | undefined {
  return res.locals.auth as Auth | undefined;
}

/** Nur für angemeldete Personen, sonst 401. */
export function requireAuth(_req: Request, res: Response, next: NextFunction) {
  if (!getAuth(res)) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}
