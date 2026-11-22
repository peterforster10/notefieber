// Transaktion mit Kontext für API, Worker und Collab-Server (nur auf dem Server, deshalb nicht in
// index.ts). Jede Transaktion setzt zuerst Mandant und Person (app.tenant_id, app.user_id); darauf
// bauen Row Level Security und die Funktionen in app auf (CLAUDE.md, Abschnitt 13). Bei
// wiki_worker (Worker, Collab-Server) nur der Mandant, die Person bleibt leer.
// Nur ein Typ-Import von pg: shared braucht pg zur Laufzeit nicht, die Apps bringen es mit.
import type pg from 'pg';

export interface RequestContext {
  tenantId: string;
  /** Angemeldete Person; leer bei wiki_worker (Worker, Collab-Server) */
  userId?: string;
}

/** Führt fn in einer Transaktion mit gesetztem Mandanten und gesetzter Person aus. */
export async function withContext<T>(
  pool: pg.Pool,
  ctx: RequestContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [
      ctx.tenantId,
      ctx.userId ?? '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
