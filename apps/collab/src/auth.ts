// Anmeldung am Collab-Server (CLAUDE.md, Abschnitt 6; ARCHITECTURE_REVIEW.md, A-06): kein eigenes
// Token, sondern dasselbe Sitzungs-Cookie wie bei der API, beim WebSocket-Handshake mitgeschickt.
//   1. Origin muss das Frontend sein (PUBLIC_URL)
//   2. Sitzung über app.resolve_session (Hash des Cookie-Tokens)
//   3. Rolle über app.page_rank(seite, person), dieselbe Funktion wie in allen Lesepfaden
// Viewer und Commenter bekommen eine lesende Verbindung, Editoren und Admins eine schreibende.
// Seiten im Papierkorb nur lesend (E04-07); app.store_ydoc lehnt sie ohnehin ab.
import type pg from 'pg';
import { pageIdFromDocument } from '@notefieber/editor-schema';
import { roleRank } from '@notefieber/shared';
import { hashToken, sessionTokenFromCookies } from '@notefieber/shared/session';
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

export class Rejected extends Error {
  readonly reason: RejectReason;
  constructor(reason: RejectReason) {
    super(`Collab-Server: abgelehnt (${reason})`);
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

  const page = await withTenant(db, session.tenant_id, async (client) => {
    const r = await client.query<{ space_id: string; trashed: boolean; rank: number }>(
      `SELECT space_id, deleted_at IS NOT NULL AS trashed, app.page_rank(id, $2) AS rank
       FROM pages WHERE id = $1`,
      [pageId, session.user_id],
    );
    return r.rows[0];
  });
  // Seite aus einem anderen Mandanten oder ohne Leserecht: dieselbe Antwort, verrät nichts
  if (!page || page.rank < roleRank('viewer')) throw new Rejected('forbidden');

  return {
    tenantId: session.tenant_id,
    userId: session.user_id,
    sessionId: session.session_id,
    pageId,
    spaceId: page.space_id,
    readOnly: page.trashed || page.rank < roleRank('editor'),
  };
}
