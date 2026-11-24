// Spaces und Seitenbaum über die API, gegen eine echte Datenbank mit den Testdaten aus
// seed.sql (siehe testing.ts). Prüft vor allem, was Personen sehen und tun dürfen.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { withContext } from '../db.ts';
import { startTestApp, type TestApp } from '../testing.ts';

const app = await startTestApp();
const skip = app ? false : 'API_TEST_DATABASE_URL fehlt (siehe docs/LOCAL_SETUP.md, Abschnitt 7)';
let peter = '';
let lukas = '';
let max = '';
let elena = '';

before(async () => {
  if (!app) return;
  peter = await app.sessionFor('peter.forster@alpenwerk.example');
  lukas = await app.sessionFor('lukas.gruber@alpenwerk.example');
  max = await app.sessionFor('max.mustermann@alpenwerk.example');
  elena = await app.sessionFor('elena.novak@agentur-nord.example');
});
after(() => app?.close());

const a = () => app as TestApp;
type Page = {
  id: string;
  parentId: string | null;
  title: string;
  restricted: boolean;
  role: string | null;
  hasChildren: boolean;
};
const titles = (pages: Page[]) => pages.map((p) => p.title);

/** Eine Ebene des Seitenbaums (ohne parent: oberste Ebene) */
const level = async (cookie: string, key: string, parent?: string) => {
  const r = await a().call(cookie, 'GET', `/spaces/${key}/pages${parent ? `?parent=${parent}` : ''}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as Page[];
};

/** Ganzer Baum, Ebene für Ebene geladen wie in der Seitenleiste; under = angezeigt unter */
const walk = async (cookie: string, key: string) => {
  const all: (Page & { under: string | null })[] = [];
  const queue: (string | null)[] = [null];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const p of await level(cookie, key, parent ?? undefined)) {
      all.push({ ...p, under: parent });
      if (p.hasChildren) queue.push(p.id);
    }
  }
  return all;
};

/** Als Person direkt in der Datenbank handeln (Funktionen ohne eigene Route, z. B. Rechte) */
const asUser = async (cookie: string, sql: string, params: unknown[]) => {
  const me = (await a().call(cookie, 'GET', '/auth/me')).body as { id: string; tenant: { id: string } };
  await withContext(a().db, { tenantId: me.tenant.id, userId: me.id }, (tx) => tx.query(sql, params));
  return me.id;
};

test('ohne Sitzung kein Zugriff', { skip }, async () => {
  assert.equal((await a().call(null, 'GET', '/spaces')).status, 401);
  assert.equal((await a().call('nf_session=erfunden', 'GET', '/spaces')).status, 401);
});

test('jede Person sieht nur ihre Spaces', { skip }, async () => {
  const keys = async (c: string) => (await a().call(c, 'GET', '/spaces')).body.map((s: { key: string }) => s.key);
  assert.deepEqual((await keys(peter)).filter((k: string) => ['ALT', 'ENTW', 'PERS', 'VERT'].includes(k)).sort(), [
    'ALT',
    'ENTW',
    'PERS',
    'VERT',
  ]);
  assert.ok(!(await keys(max)).includes('PERS'), 'Max sieht den privaten Space PERS');
  // Elena (Gast) sieht VERT nur wegen einer freigegebenen Seite, sonst nichts
  assert.deepEqual(await keys(elena), ['VERT']);
  assert.equal((await a().call(max, 'GET', '/spaces/PERS')).status, 404);
});

test('der Seitenbaum zeigt eingeschränkte Seiten nur den Berechtigten', { skip }, async () => {
  const tree = (c: string) => walk(c, 'ENTW');
  const l = await tree(lukas);
  const plan = l.find((p) => p.title === 'Personalplanung 2027');
  assert.ok(plan?.restricted, 'Lukas sieht die Personalplanung nicht oder nicht als eingeschränkt');
  assert.ok(!titles(await tree(max)).includes('Personalplanung 2027'), 'Max sieht die Personalplanung');
  assert.ok(!titles(await tree(max)).includes('Alte Notizen'), 'Seite im Papierkorb im Baum');
});

test('Leser legen keine Seiten an', { skip }, async () => {
  const entw = (await a().call(max, 'GET', '/spaces/ENTW')).body;
  const r = await a().call(max, 'POST', '/spaces/ENTW/pages', { parentId: entw.homePageId, title: 'Von Max' });
  assert.equal(r.status, 403);
});

test('Space anlegen, Seiten anlegen, verschieben, Papierkorb', { skip }, async () => {
  const key = `T${Date.now().toString(36).toUpperCase()}`;
  let r = await a().call(peter, 'POST', '/spaces', { key, name: 'Test über die API' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.role, 'admin');
  const home = r.body.homePageId as string;
  assert.equal((await a().call(peter, 'POST', '/spaces', { key, name: 'Doppelt' })).status, 409);

  const create = async (title: string, parentId = home, afterId?: string) => {
    const res = await a().call(peter, 'POST', `/spaces/${key}/pages`, { parentId, title, afterId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id as string;
  };
  const children = async (parentId: string) => titles(await level(peter, key, parentId));

  const pa = await create('A');
  const pb = await create('B');
  const pc = await create('C', home, pa);
  assert.deepEqual(await children(home), ['A', 'C', 'B']);

  r = await a().call(peter, 'POST', `/pages/${pb}/move`, { parentId: home, beforeId: pa });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.deepEqual(await children(home), ['B', 'A', 'C']);

  r = await a().call(peter, 'POST', `/pages/${pc}/move`, { parentId: pa });
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.deepEqual(await children(pa), ['C']);
  const page = (await a().call(peter, 'GET', `/pages/${pc}`)).body;
  assert.deepEqual(
    page.breadcrumb.map((c: { title: string }) => c.title),
    ['Test über die API', 'A'],
  );

  r = await a().call(peter, 'POST', `/pages/${pa}/move`, { parentId: pc });
  assert.equal(r.status, 409, 'Seite unter die eigene Unterseite verschoben');
  assert.equal(r.body.code, 'move_into_self', 'Code für die Übersetzung in der Oberfläche');

  // Max liest mit (Standard: alle im Workspace lesen), darf aber nichts ändern
  assert.deepEqual(titles(await level(max, key)), ['Test über die API']);
  assert.equal((await a().call(max, 'POST', `/pages/${pb}/move`, { parentId: pa })).status, 403);
  assert.equal((await a().call(max, 'DELETE', `/pages/${pb}`)).status, 403);

  r = await a().call(peter, 'DELETE', `/pages/${pa}`);
  assert.deepEqual(r.body, { count: 2 });
  assert.deepEqual(await children(home), ['B']);
  const trash = (await a().call(peter, 'GET', `/spaces/${key}/trash`)).body;
  assert.deepEqual(
    trash.map((p: { title: string }) => p.title),
    ['A'],
  );
  r = await a().call(peter, 'POST', `/pages/${pa}/restore`);
  assert.deepEqual(r.body, { count: 2 });
  assert.deepEqual(await children(home), ['B', 'A']);

  r = await a().call(peter, 'DELETE', `/pages/${home}`);
  assert.equal(r.status, 409, 'Startseite gelöscht');
  assert.equal(r.body.code, 'home_page_not_deletable');
});

test('Eingaben werden geprüft', { skip }, async () => {
  // Schlüssel in Adressen klein (/spaces/entw), gespeichert als ENTW
  const entw = await a().call(peter, 'GET', '/spaces/entw');
  assert.equal(entw.status, 200);
  assert.equal(entw.body.key, 'ENTW');
  assert.equal((await a().call(peter, 'GET', '/spaces/entw/pages')).status, 200);
  assert.equal((await a().call(peter, 'GET', '/spaces/entw/pages?parent=keine-uuid')).status, 400);
  assert.equal((await a().call(peter, 'GET', '/spaces/1abc')).status, 400);
  assert.equal((await a().call(peter, 'GET', '/spaces/GIBTSNICHT')).status, 404);
  assert.equal((await a().call(peter, 'GET', '/pages/keine-uuid')).status, 400);
  const r = await a().call(peter, 'POST', '/spaces/ENTW/pages', { parentId: null, title: '' });
  assert.equal(r.status, 400);
});

test(
  'der Baum lädt ebenenweise, Seiten unter unsichtbaren stehen unter der nächsten sichtbaren',
  { skip },
  async () => {
    const key = `B${Date.now().toString(36).toUpperCase()}`;
    const home = (await a().call(peter, 'POST', '/spaces', { key, name: 'Baum' })).body.homePageId as string;
    const create = async (title: string, parentId: string) =>
      (await a().call(peter, 'POST', `/spaces/${key}/pages`, { parentId, title })).body.id as string;
    const geheim = await create('Geheim', home);
    const darin = await create('Darin', geheim);
    const fuerMax = await create('Für Max', darin);
    // Geheim nur für Peter; „Für Max“ darunter mit eigenen Rechten, Max darf bearbeiten
    const maxId = (await a().call(max, 'GET', '/auth/me')).body.id as string;
    await asUser(
      peter,
      `SELECT app.set_page_inheritance($1, false, app.current_user_id()),
            app.set_grant(NULL, $1, 'workspace', NULL, NULL, NULL, app.current_user_id())`,
      [geheim],
    );
    await asUser(
      peter,
      `SELECT app.set_page_inheritance($1, false, app.current_user_id()),
            app.set_grant(NULL, $1, 'user', $2, NULL, 'editor', app.current_user_id())`,
      [fuerMax, maxId],
    );

    // Peter: jede Ebene einzeln, has_children nur, wo etwas darunter liegt
    assert.deepEqual(titles(await level(peter, key)), ['Baum']);
    const top = await level(peter, key, home);
    assert.deepEqual(titles(top), ['Geheim']);
    assert.ok(top[0]!.hasChildren && top[0]!.restricted);
    const unten = await level(peter, key, darin);
    assert.deepEqual(titles(unten), ['Für Max']);
    assert.equal(unten[0]!.hasChildren, false);

    // Max: „Für Max“ direkt unter der Startseite, als editor; parentId bleibt die echte Elternseite
    const m = await walk(max, key);
    assert.deepEqual(
      m.map((p) => [p.title, p.under]),
      [
        ['Baum', null],
        ['Für Max', home],
      ],
    );
    assert.equal(m[1]!.role, 'editor');
    assert.equal(m[1]!.parentId, darin);
    // Ebene unter einer unsichtbaren Seite: leer, nicht 404 (verrät nichts)
    assert.deepEqual(await level(max, key, geheim), []);
  },
);

test('Space umbenennen und archivieren', { skip }, async () => {
  const key = `S${Date.now().toString(36).toUpperCase()}`;
  let r = await a().call(peter, 'POST', '/spaces', { key, name: 'Vorher', description: 'Alt' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.canManage, true);
  assert.equal(r.body.description, 'Alt');

  r = await a().call(peter, 'PATCH', `/spaces/${key}`, { name: '  Nachher ', description: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.name, 'Nachher');
  assert.equal(r.body.description, null, 'leere Beschreibung nicht als NULL gespeichert');
  assert.equal((await a().call(peter, 'PATCH', `/spaces/${key}`, { name: '' })).status, 400);

  // Max liest mit (alle im Workspace), verwaltet aber nicht
  r = await a().call(max, 'GET', `/spaces/${key}`);
  assert.equal(r.body.role, 'viewer');
  assert.equal(r.body.canManage, false);
  assert.equal((await a().call(max, 'PATCH', `/spaces/${key}`, { name: 'Von Max' })).status, 403);
  assert.equal((await a().call(max, 'POST', `/spaces/${key}/archive`, { archived: true })).status, 403);

  // Archiviert: für alle nur lesbar, Peter kann zurückholen
  r = await a().call(peter, 'POST', `/spaces/${key}/archive`, { archived: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.archived, true);
  assert.equal(r.body.role, 'viewer');
  assert.equal(r.body.canManage, true);
  assert.ok(
    (await walk(peter, key)).every((p) => p.role === 'viewer'),
    'archivierter Space bearbeitbar',
  );
  assert.equal((await a().call(peter, 'PATCH', `/spaces/${key}`, { name: 'Archiviert' })).status, 403);
  r = await a().call(peter, 'POST', `/spaces/${key}/archive`, { archived: false });
  assert.equal(r.body.archived, false);
  assert.equal(r.body.role, 'admin');
});

type Hit = { id: string; title: string; spaceKey: string };
const search = async (cookie: string, q: string, space?: string) => {
  const params = new URLSearchParams({ q, ...(space ? { space } : {}) });
  const r = await a().call(cookie, 'GET', `/pages/search?${params}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as Hit[];
};

test(
  'Titelsuche für Seitenlinks: nur lesbare Seiten, ohne Papierkorb, Archiv und fremde Mandanten',
  { skip },
  async () => {
    assert.deepEqual(
      (await search(lukas, 'personalplan')).map((h) => [h.title, h.spaceKey]),
      [['Personalplanung 2027', 'ENTW']],
    );
    assert.deepEqual(await search(max, 'personalplan'), [], 'Max findet die eingeschränkte Seite');
    assert.deepEqual(await search(peter, 'Alte Notizen'), [], 'Seite im Papierkorb gefunden');
    assert.deepEqual(await search(peter, 'Telefonliste'), [], 'Seite im archivierten Space gefunden');
    assert.deepEqual(await search(peter, 'Handbuch'), [], 'Seite aus Nordlicht gefunden');
    // LIKE-Zeichen sind nur Text
    assert.deepEqual(await search(peter, '%'), []);
    // Ohne Suchtext: zuletzt geänderte Seiten des Spaces, höchstens 10
    const recent = await search(peter, '', 'entw');
    assert.ok(recent.length > 0 && recent.length <= 10);
    assert.ok(recent.every((h) => h.spaceKey === 'ENTW'));
    assert.deepEqual(await search(peter, ''), []);
    assert.equal((await a().call(peter, 'GET', '/pages/search?space=x')).status, 400);
    assert.equal((await a().call(null, 'GET', '/pages/search?q=a')).status, 401);
  },
);

test('Titel zu Seitenlinks: nur lesbare Seiten, Papierkorb gekennzeichnet, höchstens 100', { skip }, async () => {
  const [plan] = await search(lukas, 'Personalplanung 2027');
  const [release] = await search(peter, 'Release-Prozess');
  assert.ok(plan && release);
  const lookup = async (cookie: string, ids: string[]) => {
    const r = await a().call(cookie, 'POST', '/pages/lookup', { ids });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return (r.body as { title: string; trashed: boolean }[]).map((p) => p.title).sort();
  };
  const unknown = '019a5b3c-0000-7000-8000-0000000000ff';
  assert.deepEqual(await lookup(lukas, [plan.id, release.id, unknown]), ['Personalplanung 2027', 'Release-Prozess']);
  assert.deepEqual(await lookup(max, [plan.id, release.id]), ['Release-Prozess'], 'Max sieht den Titel');

  // Papierkorb: für Lesende weiter lesbar, aber gekennzeichnet
  const notes = (await a().call(peter, 'GET', '/spaces/ENTW/trash')).body as { id: string; title: string }[];
  const trashed = notes.find((n) => n.title === 'Alte Notizen');
  assert.ok(trashed);
  const r = await a().call(peter, 'POST', '/pages/lookup', { ids: [trashed.id] });
  assert.deepEqual(r.body, [{ id: trashed.id, title: 'Alte Notizen', spaceKey: 'ENTW', trashed: true }]);

  assert.equal((await a().call(peter, 'POST', '/pages/lookup', { ids: [] })).status, 400);
  assert.equal((await a().call(peter, 'POST', '/pages/lookup', { ids: Array(101).fill(unknown) })).status, 400);
  assert.equal((await a().call(peter, 'POST', '/pages/lookup', { ids: ['kaputt'] })).status, 400);
});
