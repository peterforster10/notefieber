// Zugang einer Person zu einer Seite, wie ihn der Collab-Server braucht: schreiben, lesen oder gar
// nicht. Dieselbe Regel beim Verbinden (auth.ts) und beim Neu-Prüfen offener Verbindungen
// (server.ts), damit beide nie auseinanderlaufen: Rolle aus app.page_rank (dieselbe Funktion wie in
// allen Lesepfaden), editor oder admin schreibt, viewer und commenter lesen, Seiten im Papierkorb
// sind nur lesbar (E04-07). Archivierte Spaces deckelt page_rank selbst auf viewer.
import type pg from 'pg';
import { roleRank } from '@notefieber/shared';

export type Access = 'write' | 'read' | 'none';

export interface PageAccess {
  access: Access;
  spaceId?: string;
}

/** Im Mandanten-Kontext (withContext mit tenantId) aufrufen */
export async function pageAccess(client: pg.PoolClient, pageId: string, userId: string): Promise<PageAccess> {
  const r = await client.query<{ space_id: string; trashed: boolean; rank: number }>(
    `SELECT space_id, deleted_at IS NOT NULL AS trashed, app.page_rank(id, $2) AS rank
     FROM pages WHERE id = $1`,
    [pageId, userId],
  );
  const page = r.rows[0];
  // Seite aus einem anderen Mandanten oder ohne Leserecht: dieselbe Antwort, verrät nichts
  if (!page || page.rank < roleRank('viewer')) return { access: 'none' };
  const write = !page.trashed && page.rank >= roleRank('editor');
  return { access: write ? 'write' : 'read', spaceId: page.space_id };
}

/** Gilt die Sitzung noch (nicht abgemeldet, nicht abgelaufen, Person nicht deaktiviert)? */
export async function sessionValid(client: pg.PoolClient, sessionId: string): Promise<boolean> {
  // Deaktivieren löscht alle Sitzungen der Person (app.set_user_active), Abmelden die eine
  const r = await client.query('SELECT 1 FROM sessions WHERE id = $1 AND expires_at > now()', [sessionId]);
  return r.rowCount === 1;
}
