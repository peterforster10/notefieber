// Datenbankzugriff. Jede Anfrage einer Person läuft in einer Transaktion, die zuerst
// Mandant und Person setzt (app.tenant_id, app.user_id); darauf bauen Row Level Security
// und die Funktionen in app auf (CLAUDE.md, Abschnitt 13).
import pg from 'pg';
import { assertDbRole, type AppDbRole } from '@notefieber/shared';

export async function connect(url: string, role: AppDbRole, applicationName: string): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString: url, application_name: applicationName, max: 10 });
  try {
    const login = await assertDbRole(pool, role);
    console.log(`Datenbank: verbunden als ${login} (${role})`);
    return pool;
  } catch (err) {
    console.error(`Datenbank: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export interface RequestContext {
  tenantId: string;
  /** Angemeldete Person; leer nur beim Worker (wiki_worker). */
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
