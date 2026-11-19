// Anmeldung am Collab-Server (CLAUDE.md, Abschnitt 6; ARCHITECTURE_REVIEW.md, A-06): kein eigenes
// Token, sondern dasselbe Sitzungs-Cookie wie bei der API, beim WebSocket-Handshake mitgeschickt.
//   1. Origin muss das Frontend sein (PUBLIC_URL)
//   2. Sitzung über app.resolve_session (Hash des Cookie-Tokens)
//   3. Zugang über app.page_rank(seite, person) (access.ts), dieselbe Regel wie beim Neu-Prüfen
// Viewer und Commenter bekommen eine lesende Verbindung, Editoren und Admins eine schreibende.
// Seiten im Papierkorb nur lesend (E04-07); app.store_ydoc lehnt sie ohnehin ab.
import type pg from 'pg';
import { pageIdFromDocument } from '@notefieber/editor-schema';
import { hashToken, sessionTokenFromCookies } from '@notefieber/shared/session';
import { pageAccess } from './access.ts';
import { withTenant } from './db.ts';

export interface CollabContext {
  tenantId: string;
  userId: string;
  sessionId: string;
  pageId: string;
  spaceId: string;
  readOnly: boolean;
}

/** Gründe für eine Ablehnung; der Browser bekommt sie als reason (onAuthenticationFailed) */
export type RejectReason = 'invalid-document' | 'forbidden-origin' | 'unauthenticated' | 'forbidden';

/**
 * Erwartete Ablehnung, kein Fehler: ohne message, weil Hocuspocus Fehler mit message samt Stack
 * protokolliert (jedes abgelaufene Cookie, jeder Rechteentzug). Der Browser bekommt reason.
 */
export class Rejected extends Error {
  readonly reason: RejectReason;
  constructor(reason: RejectReason) {
    super();
    this.name = 'Rejected';
    this.reason = reason;
  }
}

export async function authenticate(
  db: pg.Pool,
  publicOrigin: string,
  headers: Headers,
  documentName: string,
): Promise<CollabContext> {
  const pageId = pageIdFromDocument(documentName);
  if (!pageId) throw new Rejected('invalid-document');
  if (headers.get('origin') !== publicOrigin) throw new Rejected('forbidden-origin');

  const token = sessionTokenFromCookies(headers.get('cookie'));
  if (!token) throw new Rejected('unauthenticated');
  const { rows } = await db.query<{ session_id: string; tenant_id: string; user_id: string }>(
    'SELECT session_id, tenant_id, user_id FROM app.resolve_session($1)',
    [hashToken(token)],
  );
  const session = rows[0];
  if (!session) throw new Rejected('unauthenticated');

  const { access, spaceId } = await withTenant(db, session.tenant_id, (client) =>
    pageAccess(client, pageId, session.user_id),
  );
  if (access === 'none' || !spaceId) throw new Rejected('forbidden');

  return {
    tenantId: session.tenant_id,
    userId: session.user_id,
    sessionId: session.session_id,
    pageId,
    spaceId,
    readOnly: access !== 'write',
  };
}
