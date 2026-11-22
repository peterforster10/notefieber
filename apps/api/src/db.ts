// Datenbankzugriff. Jede Anfrage einer Person läuft in einer Transaktion, die zuerst
// Mandant und Person setzt (withContext: app.tenant_id, app.user_id); darauf bauen Row Level
// Security und die Funktionen in app auf (CLAUDE.md, Abschnitt 13).
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

// Transaktion mit Mandant und Person: gemeinsam mit dem Collab-Server (packages/shared/src/db-context.ts)
export { withContext, type RequestContext } from '@notefieber/shared/db';
