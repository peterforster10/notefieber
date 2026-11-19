// Rechte gelten auch für offene Editoren (E04-05 bis E04-07): Rechteänderungen, Papierkorb und
// Abmelden erreichen den Collab-Server per LISTEN/NOTIFY, er prüft neu und schließt nur die
// Verbindungen, deren Zugang sich geändert hat; der Browser meldet sich neu an. Gegen die
// Wegwerf-Datenbank wie collab.dbtest.ts.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { TITLE_TEXT } from '@notefieber/editor-schema';
import { DEBOUNCE_MS, startCollab } from './testing.ts';
import type { AuthResult, Client, Person } from './testing.ts';

const c = await startCollab();
const skip = c ? false : 'COLLAB_TEST_DATABASE_URL und API_TEST_DATABASE_URL fehlen';

let peter: Person;
let lukas: Person;
let max: Person;
before(async () => {
  if (!c) return;
  peter = await c.person('peter.forster@alpenwerk.example');
  lukas = await c.person('lukas.gruber@alpenwerk.example');
  max = await c.person('max.mustermann@alpenwerk.example');
});
after(() => c?.close());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Nächste Anmeldung oder 'keine' nach `ms` */
const nextAuthWithin = (client: Client, ms: number) =>
  Promise.race([client.nextAuth(), wait(ms).then((): AuthResult | 'keine' => 'keine')]);

async function setGrant(page: string, type: string, user: string | null, group: string | null, role: string | null) {
  await c!.asPerson(peter, 'SELECT app.set_grant(NULL, $1, $2, $3, $4, $5, $6)', [
    page,
    type,
    user,
    group,
    role,
    peter.userId,
  ]);
}

test(
  'Rechte entzogen: nur Betroffene werden neu angemeldet, lesend oder abgelehnt, in unter 5 s',
  { skip },
  async () => {
    const page = await c!.createPage(lukas, 'ENTW', 'Collab: Rechte entziehen');
    const l = c!.connect(page, { cookie: lukas.cookie });
    const m = c!.connect(page, { cookie: max.cookie });
    try {
      assert.deepEqual(await l.result, { scope: 'read-write' });
      assert.deepEqual(await m.result, { scope: 'readonly' });
      await Promise.all([l.synced, m.synced]);

      // Eigene Rechte für die Seite: Die bisherigen werden kopiert, für Lukas und Max ändert sich
      // nichts, also auch kein Neuverbinden (page.permissions_changed wird trotzdem geprüft)
      await c!.asPerson(peter, 'SELECT app.set_page_inheritance($1, false, $2)', [page, peter.userId]);
      const [lNone, mNone] = await Promise.all([nextAuthWithin(l, 1500), nextAuthWithin(m, 1500)]);
      assert.equal(lNone, 'keine', 'Lukas ohne Änderung neu angemeldet');
      assert.equal(mNone, 'keine', 'Max ohne Änderung neu angemeldet');

      // Lukas nur noch lesend, alle anderen Rechte außer Peters weg (Max verliert den Zugang)
      const started = Date.now();
      const lNext = l.nextAuth();
      const mNext = m.nextAuth();
      await setGrant(page, 'user', lukas.userId, null, 'viewer');
      const others = await c!.query<{ subject_type: string; user_id: string | null; group_id: string | null }>(
        `SELECT subject_type, user_id, group_id FROM grants WHERE page_id = $1
       AND NOT (subject_type = 'user' AND user_id IN ($2, $3))`,
        [page, peter.userId, lukas.userId],
      );
      for (const g of others) await setGrant(page, g.subject_type, g.user_id, g.group_id, null);
      assert.deepEqual(await lNext, { scope: 'readonly' }, 'Lukas nicht lesend neu angemeldet');
      assert.deepEqual(await mNext, { denied: 'forbidden' }, 'Max nicht abgelehnt');
      assert.ok(Date.now() - started < 5000, `nach ${Date.now() - started} ms statt unter 5 s`);

      // Lukas tippt trotzdem (manipulierter Browser): wird nicht gespeichert
      l.doc.getText(TITLE_TEXT).insert(0, 'NACH DEM ENTZUG ');
      await wait(DEBOUNCE_MS * 8);
      const [row] = await c!.query<{ title: string }>('SELECT title FROM pages WHERE id = $1', [page]);
      assert.equal(row?.title, 'Collab: Rechte entziehen');

      // Und ganz weg
      const lGone = l.nextAuth();
      await setGrant(page, 'user', lukas.userId, null, null);
      assert.deepEqual(await lGone, { denied: 'forbidden' });
    } finally {
      l.close();
      m.close();
    }
  },
);

test('Papierkorb: Bearbeitende werden lesend, nach dem Wiederherstellen wieder schreibend', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Collab: Papierkorb live');
  const l = c!.connect(page, { cookie: lukas.cookie });
  try {
    assert.deepEqual(await l.result, { scope: 'read-write' });
    await l.synced;
    const trashed = l.nextAuth();
    await c!.trashPage(lukas, page);
    assert.deepEqual(await trashed, { scope: 'readonly' });

    const restored = l.nextAuth();
    await c!.asPerson(lukas, 'SELECT app.restore_page($1, $2)', [page, lukas.userId]);
    assert.deepEqual(await restored, { scope: 'read-write' });
  } finally {
    l.close();
  }
});

test('Abmelden in einem anderen Tab schließt den Editor (abgelehnt: unauthenticated)', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Collab: Abmelden');
  const me = await c!.person('max.mustermann@alpenwerk.example');
  const m = c!.connect(page, { cookie: me.cookie });
  try {
    assert.deepEqual(await m.result, { scope: 'readonly' });
    await m.synced;
    const started = Date.now();
    const next = m.nextAuth();
    await c!.asPerson(me, 'SELECT app.end_session($1)', [me.tokenHash]);
    assert.deepEqual(await next, { denied: 'unauthenticated' });
    assert.ok(Date.now() - started < 5000, `nach ${Date.now() - started} ms statt unter 5 s`);
  } finally {
    m.close();
  }
});

test('Regelmäßige Prüfung: abgelaufene Sitzung ohne Meldung wird trotzdem geschlossen', { skip }, async () => {
  const page = await c!.createPage(lukas, 'ENTW', 'Collab: Sitzung abgelaufen');
  const me = await c!.person('lukas.gruber@alpenwerk.example');
  const l = c!.connect(page, { cookie: me.cookie });
  try {
    assert.deepEqual(await l.result, { scope: 'read-write' });
    await l.synced;
    // Wie eine abgelaufene, aufgeräumte Sitzung: ohne NOTIFY
    await c!.query('DELETE FROM sessions WHERE token_hash = $1', [me.tokenHash]);
    assert.equal(await nextAuthWithin(l, 1000), 'keine', 'ohne Meldung schon neu angemeldet');
    const next = l.nextAuth();
    assert.equal(await c!.collab.recheckAll(), 1);
    assert.deepEqual(await next, { denied: 'unauthenticated' });
  } finally {
    l.close();
  }
});

test(
  'LISTEN-Verbindung abgerissen: nach dem Neuverbinden werden alle offenen Verbindungen geprüft',
  { skip },
  async () => {
    const page = await c!.createPage(lukas, 'ENTW', 'Collab: LISTEN abgerissen');
    const me = await c!.person('lukas.gruber@alpenwerk.example');
    const l = c!.connect(page, { cookie: me.cookie });
    try {
      assert.deepEqual(await l.result, { scope: 'read-write' });
      await l.synced;
      const next = l.nextAuth();
      // Was während des Abrisses geschieht, meldet niemand: Sitzung weg, ohne NOTIFY
      await c!.query('DELETE FROM sessions WHERE token_hash = $1', [me.tokenHash]);
      // Die LISTEN-Verbindung des Servers beenden (gleiche Login-Rolle darf das)
      const killed = await c!.query<{ ok: boolean }>(
        `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
       WHERE application_name = 'notefieber-collab-listen' AND usename = current_user`,
      );
      assert.ok(killed.length >= 1 && killed.every((k) => k.ok), 'LISTEN-Verbindung nicht gefunden');
      assert.deepEqual(await next, { denied: 'unauthenticated' });
    } finally {
      l.close();
    }
  },
);
