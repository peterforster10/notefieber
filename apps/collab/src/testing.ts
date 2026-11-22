// Hilfen für die Tests des Collab-Servers gegen eine Wegwerf-Datenbank (*.dbtest.ts, pnpm test:db),
// dieselbe wie für die API-Tests (database/scripts/setup_test_db.sh, mit seed.sql). Braucht zwei
// Verbindungen: COLLAB_TEST_DATABASE_URL (wiki_collab, in wiki_worker) für den Server und
// API_TEST_DATABASE_URL (wiki_api, in wiki_app) für Sitzungen und Seiten, so wie die API sie
// anlegt. Nie gegen die Datenbank, mit der man arbeitet.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { documentName } from '@notefieber/editor-schema';
import { assertDbRole } from '@notefieber/shared';
import { SESSION_COOKIE, hashToken } from '@notefieber/shared/session';
import { createCollab } from './server.ts';

export const PUBLIC_URL = 'http://localhost:3000';
export const DEBOUNCE_MS = 100;

/** Kontext setzen wie die API (app.tenant_id, app.user_id), eine Transaktion */
async function asApp<T>(db: pg.Pool, tenantId: string, userId: string, fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [
      tenantId,
      userId,
    ]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export interface Person {
  userId: string;
  cookie: string;
  /** SHA-256 des Tokens, wie in sessions.token_hash (für app.end_session) */
  tokenHash: string;
}

export type AuthResult = { scope?: string; denied?: string };

export interface Client {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  /** 'readonly' | 'read-write' nach der (ersten) Anmeldung, sonst der Grund der Ablehnung */
  result: Promise<AuthResult>;
  /** Ergebnis der nächsten Anmeldung, z. B. nachdem der Server die Verbindung geschlossen hat */
  nextAuth(): Promise<AuthResult>;
  synced: Promise<void>;
  close(): void;
}

/** Zum Server in Tests und im Lasttest: Entprellung, Standard wie in den Tests 100 ms bzw. 500 ms */
export interface StartOptions {
  debounceMs?: number;
  maxDebounceMs?: number;
}

export async function startCollab(opts: StartOptions = {}) {
  const workerUrl = process.env.COLLAB_TEST_DATABASE_URL;
  const appUrl = process.env.API_TEST_DATABASE_URL;
  if (!workerUrl || !appUrl) return undefined;

  const worker = new pg.Pool({ connectionString: workerUrl, max: 5 });
  const app = new pg.Pool({ connectionString: appUrl, max: 3 });
  await assertDbRole(worker, 'wiki_worker');
  await assertDbRole(app, 'wiki_app');

  const collab = createCollab(
    {
      COLLAB_HOST: '127.0.0.1',
      COLLAB_PORT: 0,
      PUBLIC_URL,
      COLLAB_DEBOUNCE_MS: opts.debounceMs ?? DEBOUNCE_MS,
      COLLAB_MAX_DEBOUNCE_MS: opts.maxDebounceMs ?? DEBOUNCE_MS * 5,
      COLLAB_DATABASE_URL: workerUrl,
      COLLAB_RECHECK_SECONDS: 3600, // in den Tests gezielt über collab.recheckAll()
    },
    worker,
  );
  await collab.start();
  const url = `ws://127.0.0.1:${collab.server.address.port}`;

  const { rows } = await app.query<{ tenant_id: string }>("SELECT tenant_id FROM app.resolve_tenant('alpenwerk')");
  const tenantId = rows[0]?.tenant_id;
  if (!tenantId) throw new Error('Mandant alpenwerk fehlt (seed.sql eingespielt?)');

  /** Person aus seed.sql anmelden: Sitzung wie beim Login, Cookie für den Handshake */
  async function person(email: string): Promise<Person> {
    const subject = `user-${email.split('@')[0]!.replaceAll('.', '-')}`;
    const userId = await asApp(app, tenantId!, '', async (c) => {
      const r = await c.query<{ id: string }>('SELECT user_id AS id FROM app.resolve_login($1)', [subject]);
      return r.rows[0]?.id;
    });
    if (!userId) throw new Error(`Testperson ${email} fehlt`);
    const token = randomBytes(32).toString('base64url');
    await asApp(app, tenantId!, userId, (c) =>
      c.query("SELECT app.create_session($1, $2, now() + interval '1 hour', 'collab-test')", [
        userId,
        hashToken(token),
      ]),
    );
    return { userId, cookie: `${SESSION_COOKIE}=${token}`, tokenHash: hashToken(token) };
  }

  /** Neue Seite unter der Startseite eines Spaces, angelegt wie über die API */
  async function createPage(by: Person, spaceKey: string, title: string): Promise<string> {
    return asApp(app, tenantId!, by.userId, async (c) => {
      const s = await c.query<{ id: string; home_page_id: string }>(
        'SELECT id, home_page_id FROM spaces WHERE key = $1',
        [spaceKey],
      );
      const space = s.rows[0];
      if (!space) throw new Error(`Space ${spaceKey} fehlt`);
      const r = await c.query<{ id: string }>('SELECT app.create_page($1, $2, $3, $4) AS id', [
        space.id,
        space.home_page_id,
        title,
        by.userId,
      ]);
      return r.rows[0]!.id;
    });
  }

  /** Seite über die API-Rolle in den Papierkorb legen */
  async function trashPage(by: Person, pageId: string) {
    await asApp(app, tenantId!, by.userId, (c) => c.query('SELECT app.trash_page($1, $2)', [pageId, by.userId]));
  }

  /** Beliebige Abfrage der API-Rolle im Namen einer Person (z. B. app.set_grant) */
  async function asPerson<T extends pg.QueryResultRow>(by: Person, sql: string, params: unknown[] = []) {
    return asApp(app, tenantId!, by.userId, async (c) => (await c.query<T>(sql, params)).rows);
  }

  /** Seiten-ID über den Titel (als Collab-Server, sieht alles im Mandanten) */
  async function pageByTitle(title: string): Promise<string> {
    const r = await query<{ id: string }>('SELECT id FROM pages WHERE title = $1', [title]);
    if (!r[0]) throw new Error(`Seite ${title} fehlt`);
    return r[0].id;
  }

  /** Abfrage als wiki_worker im Mandanten alpenwerk */
  async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const c = await worker.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const r = await c.query<T>(sql, params);
      await c.query('COMMIT');
      return r.rows;
    } finally {
      c.release();
    }
  }

  /**
   * Verbindung wie im Browser: Cookie und Origin beim Handshake. `state`: Stand, den der Browser
   * schon vor dem Verbinden hat (lokale Kopie in IndexedDB, offener Tab nach einem Neustart).
   */
  function connect(
    pageId: string,
    opts: { cookie?: string; origin?: string; name?: string; state?: Uint8Array } = {},
  ): Client {
    const headers: Record<string, string> = { origin: opts.origin ?? PUBLIC_URL };
    if (opts.cookie) headers.cookie = opts.cookie;
    class HeaderWebSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers });
      }
    }
    const doc = new Y.Doc();
    if (opts.state) Y.applyUpdate(doc, opts.state);
    // Jede Anmeldung (auch nach einem Neuverbinden) landet hier; result ist die erste
    const results: AuthResult[] = [];
    const waiting: ((r: AuthResult) => void)[] = [];
    const report = (r: AuthResult) => {
      results.push(r);
      for (const w of waiting.splice(0)) w(r);
    };
    const result = new Promise<AuthResult>((r) => (results.length ? r(results[0]!) : waiting.push(r)));
    const nextAuth = () => new Promise<AuthResult>((r) => waiting.push(r));
    let resolveSynced!: () => void;
    const synced = new Promise<void>((r) => (resolveSynced = r));
    // Eigene Verbindung pro Client (wie ein Browser-Tab), mit den Headern von oben
    const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: HeaderWebSocket });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: opts.name ?? documentName(pageId),
      document: doc,
      token: '',
      onAuthenticated: ({ scope }) => report({ scope }),
      onAuthenticationFailed: ({ reason }) => report({ denied: reason }),
      onSynced: () => resolveSynced(),
    });
    provider.attach();
    return {
      provider,
      doc,
      result,
      nextAuth,
      synced,
      close: () => {
        provider.destroy();
        socket.destroy();
        doc.destroy();
      },
    };
  }

  return {
    tenantId,
    person,
    createPage,
    trashPage,
    asPerson,
    pageByTitle,
    query,
    connect,
    collab,
    /** Verbindung des Servers (wiki_worker), z. B. für den internen Aufruf */
    workerPool: worker,
    async close() {
      await collab.stop();
      await worker.end();
      await app.end();
    },
  };
}

/** Wartet, bis die Bedingung gilt (oder wirft nach `ms`) */
export async function eventually<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Bedingung nach ${ms} ms nicht erfüllt`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
