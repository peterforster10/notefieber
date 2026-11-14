// Hilfen für die API-Tests gegen eine echte Datenbank (*.dbtest.ts, pnpm test:db).
// Braucht API_TEST_DATABASE_URL: eine Wegwerf-Datenbank mit Migrationen, Login-Rollen und
// Testdaten (seed.sql), Verbindung als wiki_api. Die Tests legen Spaces und Seiten an, die
// sich nicht löschen lassen; nie gegen die Datenbank, mit der man arbeitet.
// Angemeldet wird direkt über app.create_session, ohne Zitadel.
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { assertDbRole } from '@notefieber/shared';
import { createApp } from './app.ts';
import { createOidc } from './auth/oidc.ts';
import { SESSION_COOKIE, hashToken, newSessionToken } from './auth/session.ts';
import { apiConfig } from './config.ts';
import { withContext } from './db.ts';

export const PUBLIC_URL = 'http://localhost:3000';

export interface TestApp {
  /** Verbindung als wiki_api, z. B. für Bausteine wie resolveAccount */
  db: pg.Pool;
  /** Adresse der API im Test, z. B. http://127.0.0.1:51234/api/v1 */
  base: string;
  /** ID eines Mandanten aus seed.sql */
  tenantId(slug?: string): Promise<string>;
  /**
   * Cookie-Header für eine Person, gefunden über ihr Login (app.resolve_login). Ohne
   * `subject` gilt die Regel aus seed.sql: peter.forster@… hat das Login user-peter-forster.
   */
  sessionFor(email: string, tenant?: string, subject?: string): Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON der API, in Tests bewusst lose getypt
  call(cookie: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function startTestApp(): Promise<TestApp | undefined> {
  const url = process.env.API_TEST_DATABASE_URL;
  if (!url) return undefined;
  Object.assign(process.env, {
    API_DATABASE_URL: url,
    PUBLIC_URL,
    OIDC_ISSUER: 'http://localhost:8080', // wird in diesen Tests nicht angesprochen
    OIDC_CLIENT_ID: 'test',
    OIDC_CLIENT_SECRET: 'test',
    AUTH_COOKIE_SECRET: 'test-'.repeat(8),
    COOKIE_SECURE: 'false',
  });
  const config = apiConfig();
  const db = new pg.Pool({ connectionString: url, max: 5 });
  await assertDbRole(db, 'wiki_app');
  const server = createApp(config, db, createOidc(config)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const tenantId = async (slug = 'alpenwerk') => {
    const { rows } = await db.query<{ tenant_id: string }>('SELECT tenant_id FROM app.resolve_tenant($1)', [slug]);
    if (!rows[0]) throw new Error(`Mandant ${slug} fehlt (seed.sql eingespielt?)`);
    return rows[0].tenant_id;
  };

  return {
    db,
    base,
    tenantId,
    async sessionFor(email, tenant = 'alpenwerk', subject = `user-${email.split('@')[0]!.replaceAll('.', '-')}`) {
      const tid = await tenantId(tenant);
      // Ohne Person im Kontext sieht wiki_app keine Personen, deshalb über das Login
      const userId = await withContext(db, { tenantId: tid }, async (tx) => {
        const r = await tx.query<{ id: string }>('SELECT user_id AS id FROM app.resolve_login($1)', [subject]);
        return r.rows[0]?.id;
      });
      if (!userId) throw new Error(`Testperson ${email} fehlt`);
      const token = newSessionToken();
      await withContext(db, { tenantId: tid, userId }, (tx) =>
        tx.query("SELECT app.create_session($1, $2, now() + interval '1 hour', 'api-test')", [
          userId,
          hashToken(token),
        ]),
      );
      return `${SESSION_COOKIE}=${token}`;
    },
    async call(cookie, method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: {
          origin: PUBLIC_URL,
          ...(cookie ? { cookie } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : undefined };
    },
    async close() {
      server.close();
      await db.end();
    },
  };
}
