// Datenbank des Collab-Servers: Login-Rolle in wiki_worker. Unterliegt nur der Mandantentrennung,
// deshalb setzt jede Transaktion den Mandanten (app.tenant_id), nie eine Person.
import type pg from 'pg';

export async function withTenant<T>(db: pg.Pool, tenantId: string, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', '', true)`, [tenantId]);
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
