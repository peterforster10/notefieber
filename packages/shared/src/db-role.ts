// Schutz beim Start: Jede App verbindet sich mit einer eigenen Login-Rolle, die Mitglied
// genau ihrer Gruppenrolle ist (API: wiki_app; Collab-Server und Worker: wiki_worker).
// Nie als Eigentümer (wiki_owner umgeht RLS) und nie als Superuser (CLAUDE.md, Abschnitt 11).

export type AppDbRole = 'wiki_app' | 'wiki_worker';

/** Das Nötigste von pg.Pool bzw. pg.Client, damit shared kein pg braucht. */
export interface Queryable {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

interface RoleCheckRow {
  login: string;
  is_superuser: boolean;
  is_owner: boolean;
  in_app: boolean;
  in_worker: boolean;
}

/** Bricht mit einer Fehlermeldung ab, wenn die Verbindung die falsche Rolle hat. */
export async function assertDbRole(db: Queryable, expected: AppDbRole): Promise<string> {
  const { rows } = await db.query(`
    SELECT current_user AS login,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
           pg_has_role(current_user, 'wiki_owner', 'MEMBER') AS is_owner,
           pg_has_role(current_user, 'wiki_app', 'MEMBER') AS in_app,
           pg_has_role(current_user, 'wiki_worker', 'MEMBER') AS in_worker`);
  const r = rows[0] as RoleCheckRow;
  const other: AppDbRole = expected === 'wiki_app' ? 'wiki_worker' : 'wiki_app';
  const inExpected = expected === 'wiki_app' ? r.in_app : r.in_worker;
  const inOther = expected === 'wiki_app' ? r.in_worker : r.in_app;
  if (r.is_superuser || r.is_owner) {
    throw new Error(`Datenbankrolle ${r.login} ist Superuser oder Eigentümer. Die App verbindet sich nie so.`);
  }
  if (!inExpected || inOther) {
    throw new Error(`Datenbankrolle ${r.login} muss Mitglied von ${expected} sein und nicht von ${other}.`);
  }
  return r.login;
}
