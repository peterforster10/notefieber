-- Funktionstest für schema.sql. Läuft als wiki_app (bzw. wiki_worker), damit RLS greift.
-- Aufruf auf einer Datenbank mit eingespieltem Schema, als wiki_owner:
--   psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f schema_test.sql
-- Alles läuft in einer Transaktion, die am Ende zurückgerollt wird: wiederholbar, und die
-- Datenbank bleibt leer. Deshalb prüft Test 33 den Trigger admin_remains mit
-- SET CONSTRAINTS ALL IMMEDIATE statt beim Commit.
-- Gleichzeitige Sitzungen (Sperren im Seitenbaum) prüft schema_concurrency_test.sh.
\set QUIET on
\pset tuples_only on
BEGIN;
SET client_min_messages = notice;
SET plpgsql.check_asserts = on;   -- sonst würden ASSERTs je nach Konfiguration still übersprungen
SET ROLE wiki_app;

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
GRANT SELECT, INSERT ON ids TO wiki_worker;

-- Hilfsfunktionen: Kontext setzen, IDs nachschlagen
CREATE FUNCTION pg_temp.ctx(p_tenant uuid, p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.tenant_id', coalesce(p_tenant::text, ''), false),
         set_config('app.user_id',   coalesce(p_user::text, ''), false)
$$;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = p $$;

-- 1. Zwei Mandanten, der zweite mit vorgegebener ID (wie aus TalkFieber übernommen)
DO $$
DECLARE t1 uuid; t2 uuid; shared uuid := '0193a000-0000-7000-8000-000000000002';
BEGIN
  t1 := app.create_tenant('alpenwerk', 'Alpenwerk', 'eu-central', 'anna@alpenwerk.example', 'Anna Huber');
  INSERT INTO ids SELECT 't1', t1;
  INSERT INTO ids SELECT 'anna', id FROM users WHERE email = 'anna@alpenwerk.example';
  INSERT INTO ids SELECT 'ws1', id FROM workspaces WHERE tenant_id = t1;
  t2 := app.create_tenant('andere-firma', 'Andere Firma', 'eu-central', 'eva@andere.example', 'Eva Fremd',
                          p_tenant_id => shared);
  ASSERT t2 = shared, 'vorgegebene Mandanten-ID nicht übernommen';
  INSERT INTO ids SELECT 't2', t2;
  INSERT INTO ids SELECT 'eva', id FROM users WHERE email = 'eva@andere.example';
  INSERT INTO ids SELECT 'ws2', id FROM workspaces WHERE tenant_id = t2;
  RAISE NOTICE 'OK  1 Mandanten angelegt, gemeinsame ID mit TalkFieber möglich';
END $$;

-- 2. Personen und Gast im Mandanten 1
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE u uuid; n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['lukas', 'max', 'sophie'] LOOP
    u := uuidv7();
    INSERT INTO users (id, tenant_id, email, display_name) VALUES (u, app.current_tenant(), n || '@alpenwerk.example', initcap(n));
    INSERT INTO ids VALUES (n, u);
    PERFORM app.add_workspace_member(pg_temp.id('ws1'), u, 'member', pg_temp.id('anna'));
  END LOOP;
  u := uuidv7();
  INSERT INTO users (id, tenant_id, email, display_name, is_external)
  VALUES (u, app.current_tenant(), 'elena@agentur-nord.example', 'Elena Novak', true);
  INSERT INTO ids VALUES ('elena', u);
  PERFORM app.add_workspace_member(pg_temp.id('ws1'), u, 'guest', pg_temp.id('anna'));
  RAISE NOTICE 'OK  2 Personen und Gast angelegt';
END $$;

-- 3. Space mit Startseite, Ersteller als Admin, Workspace lesend
DO $$
DECLARE s uuid; home uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'entw', 'Entwicklung', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('entw', s);
  SELECT home_page_id INTO home FROM spaces WHERE id = s;
  ASSERT home IS NOT NULL, 'Startseite fehlt';
  INSERT INTO ids VALUES ('home', home);
  ASSERT (SELECT key FROM spaces WHERE id = s) = 'ENTW', 'Key nicht normalisiert';
  ASSERT app.space_role(s) = 'admin', 'Ersteller ist kein Admin';
  ASSERT (SELECT count(*) FROM page_contents WHERE page_id = home) = 1, 'Inhalt der Startseite fehlt';
  RAISE NOTICE 'OK  3 Space mit Startseite, Ersteller ist Admin';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT app.space_role(pg_temp.id('entw')) = 'viewer', 'Workspace-Mitglied nicht lesend';
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('home')) = 1, 'Startseite unsichtbar';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM spaces) = 0, 'Gast sieht Space';
  ASSERT (SELECT count(*) FROM pages) = 0, 'Gast sieht Seiten';
  RAISE NOTICE 'OK  4 Workspace-Zugriff gilt für Mitglieder, nicht für Gäste';
END $$;

-- 5. Seitenbaum
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE a uuid; d uuid;
BEGIN
  a := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Architektur', pg_temp.id('anna'));
  d := app.create_page(pg_temp.id('entw'), a, 'Datenmodell', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('arch', a), ('dm', d);
  ASSERT (SELECT nlevel(path) FROM pages WHERE id = d) = 3, 'Pfad falsch';
  ASSERT (SELECT path FROM pages WHERE id = d) <@ (SELECT path FROM pages WHERE id = a), 'Teilbaum falsch';
  RAISE NOTICE 'OK  5 Seitenbaum mit Pfaden';
END $$;

-- 6. Leser dürfen nicht schreiben, auch nicht direkt
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Von Max', pg_temp.id('max'));
    RAISE EXCEPTION 'FEHLER: Leser legt Seite an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE page_contents SET plain_text = 'überschrieben' WHERE page_id = pg_temp.id('arch');
    RAISE EXCEPTION 'FEHLER: App ändert Inhalt direkt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE pages SET title = 'Gekapert' WHERE id = pg_temp.id('arch');
    RAISE EXCEPTION 'FEHLER: App ändert Titel direkt (Titel kommt nur aus Yjs)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO pages (tenant_id, space_id, parent_id, position, title)
    VALUES (app.current_tenant(), pg_temp.id('entw'), pg_temp.id('home'), 'z', 'Direkt');
    RAISE EXCEPTION 'FEHLER: Leser fügt Seite direkt ein';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), 'Kommentar', pg_temp.id('max'));
    RAISE EXCEPTION 'FEHLER: Leser kommentiert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK  6 Leser: keine Seiten, keine Kommentare, kein direktes Schreiben';
END $$;

-- 7. Gruppen aus dem Login-Dienst geben Rechte
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
SELECT app.sync_user_groups(pg_temp.id('lukas'), ARRAY['grp-dev'], ARRAY['Entwicklung']);
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  INSERT INTO ids SELECT 'grp_dev', id FROM groups WHERE idp_group_id = 'grp-dev';
  PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'group', NULL, pg_temp.id('grp_dev'), 'editor', pg_temp.id('anna'));
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE p uuid;
BEGIN
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Von Lukas', pg_temp.id('lukas'));
  INSERT INTO ids VALUES ('lukas_page', p);
  PERFORM app.sync_user_groups(pg_temp.id('lukas'), '{}', '{}');
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Noch eine', pg_temp.id('lukas'));
    RAISE EXCEPTION 'FEHLER: Gruppenrecht bleibt nach Austritt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM app.sync_user_groups(pg_temp.id('lukas'), ARRAY['grp-dev'], ARRAY['Entwicklung']);
  RAISE NOTICE 'OK  7 Gruppenrechte kommen und gehen mit der Gruppe';
END $$;

-- 8. Vererbung kappen: bisherige Rechte werden kopiert, dann eingeschränkt
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE g uuid; c uuid; n int; f uuid := uuidv7();
BEGIN
  g := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Gehälter', pg_temp.id('anna'));
  c := app.create_page(pg_temp.id('entw'), g, 'Gehälter 2027', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('geh', g), ('geh27', c), ('f_geh', f);
  PERFORM app.set_page_inheritance(g, false, pg_temp.id('anna'));
  SELECT count(*) INTO n FROM grants WHERE page_id = g;
  ASSERT n = 3, 'Rechte nicht kopiert: ' || n;   -- anna admin, Workspace viewer, Gruppe editor
  PERFORM app.set_grant(NULL, g, 'workspace', NULL, NULL, NULL, pg_temp.id('anna'));
  PERFORM app.add_comment(g, 'Bitte bis Freitag prüfen', pg_temp.id('anna'));
  INSERT INTO files (id, tenant_id, page_id, uploaded_by, storage_key, file_name, mime, size_bytes)
  VALUES (f, app.current_tenant(), g, pg_temp.id('anna'), 'k-geh', 'gehaelter.xlsx', 'application/vnd.ms-excel', 1);
  BEGIN
    PERFORM app.set_grant(NULL, g, 'user', pg_temp.id('anna'), NULL, NULL, pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: letzter Admin der Seite entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RAISE NOTICE 'OK  8 Vererbung gekappt, Rechte kopiert, letzter Admin bleibt';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
SELECT app.store_content(pg_temp.id('geh'), '\x0102'::bytea, 'Gehaltsbänder 2027', 'Gehälter', ARRAY[pg_temp.id('anna')]);
SELECT app.create_version(pg_temp.id('geh'), 'auto');
SELECT app.replace_page_links(pg_temp.id('arch'), ARRAY[pg_temp.id('geh'), pg_temp.id('dm')]);
INSERT INTO page_search (page_id, tenant_id, space_id, tsv)
SELECT pg_temp.id('geh'), pg_temp.id('t1'), pg_temp.id('entw'), to_tsvector('german', 'Gehälter Gehaltsbänder');
RESET ROLE;
SET ROLE wiki_app;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE g uuid := pg_temp.id('geh');
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id IN (g, pg_temp.id('geh27'))) = 0, 'eingeschränkte Seiten sichtbar';
  ASSERT (SELECT count(*) FROM page_contents WHERE page_id = g) = 0, 'Inhalt sichtbar';
  ASSERT (SELECT count(*) FROM page_versions WHERE page_id = g) = 0, 'Versionen sichtbar';
  ASSERT (SELECT count(*) FROM page_search WHERE page_id = g) = 0, 'Suchtreffer sichtbar';
  ASSERT (SELECT count(*) FROM comments WHERE page_id = g) = 0, 'Kommentare sichtbar';
  ASSERT (SELECT count(*) FROM files WHERE page_id = g) = 0, 'Anhänge sichtbar';
  ASSERT (SELECT count(*) FROM grants WHERE page_id = g) = 0, 'Rechte sichtbar';
  ASSERT (SELECT count(*) FROM page_links WHERE from_page_id = pg_temp.id('arch')) = 1, 'Link-Filter falsch';
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('arch')) = 1, 'freie Seite unsichtbar';
  RAISE NOTICE 'OK  9 Eingeschränkte Seite samt Unterseiten, Inhalt, Versionen, Suche, Kommentaren, Dateien, Links unsichtbar';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.page_role(pg_temp.id('geh27')) = 'editor', 'Gruppenrecht auf Unterseite fehlt';
  ASSERT (SELECT count(*) FROM page_links WHERE from_page_id = pg_temp.id('arch')) = 2, 'Links fehlen';
  RAISE NOTICE 'OK 10 Unterseiten erben die Einschränkung, kopiertes Gruppenrecht gilt';
END $$;

-- 11. Verschieben: Teilbaum wandert mit, auch unsichtbare Seiten; keine Zyklen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE i uuid;
BEGIN
  PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('sophie'), NULL, 'editor', pg_temp.id('anna'));
  i := app.create_page(pg_temp.id('entw'), pg_temp.id('dm'), 'Intern', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('intern', i);
  PERFORM app.set_page_inheritance(i, false, pg_temp.id('anna'));
  PERFORM app.set_grant(NULL, i, 'user', pg_temp.id('sophie'), NULL, NULL, pg_temp.id('anna'));
  PERFORM app.set_grant(NULL, i, 'workspace', NULL, NULL, NULL, pg_temp.id('anna'));
  BEGIN
    PERFORM app.move_page(pg_temp.id('arch'), pg_temp.id('dm'), 'a1', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Seite unter sich selbst verschoben';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%unter sich selbst verschoben werden%' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('intern')) = 0, 'Sophie sieht Intern';
  PERFORM app.move_page(pg_temp.id('arch'), NULL, 'a1', pg_temp.id('sophie'));
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  ASSERT (SELECT nlevel(path) FROM pages WHERE id = pg_temp.id('arch')) = 1, 'Seite nicht verschoben';
  ASSERT (SELECT nlevel(path) FROM pages WHERE id = pg_temp.id('intern')) = 3, 'unsichtbare Unterseite nicht mitgewandert';
  ASSERT (SELECT path FROM pages WHERE id = pg_temp.id('intern')) <@ (SELECT path FROM pages WHERE id = pg_temp.id('arch')),
    'Teilbaum zerrissen';
  RAISE NOTICE 'OK 11 Verschieben mit Teilbaum, auch unsichtbare Seiten, keine Zyklen';
END $$;

-- 12. Papierkorb: nur ganze Teilbäume, die man bearbeiten darf; Startseite bleibt
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie'));
DO $$
BEGIN
  PERFORM app.trash_page(pg_temp.id('arch'), pg_temp.id('sophie'));
  RAISE EXCEPTION 'FEHLER: Teilbaum mit fremder Seite gelöscht';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE n int;
BEGIN
  n := app.trash_page(pg_temp.id('arch'), pg_temp.id('anna'));
  ASSERT n = 3, 'erwartet 3 Seiten im Papierkorb, sind ' || n;
  BEGIN
    PERFORM app.restore_page(pg_temp.id('dm'), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Unterseite einzeln wiederhergestellt';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Nur die Seite, die gelöscht wurde%' THEN RAISE; END IF;
  END;
  n := app.restore_page(pg_temp.id('arch'), pg_temp.id('anna'));
  ASSERT n = 3, 'nicht alles wiederhergestellt';
  BEGIN
    PERFORM app.trash_page(pg_temp.id('home'), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Startseite gelöscht';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Startseite eines Spaces%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK 12 Papierkorb: ganze Teilbäume, Rechte geprüft, Startseite geschützt';
END $$;

-- 13. Inhalt und Versionen: nur der Collab-Server speichert, Autoren pro Version
DO $$
BEGIN
  PERFORM app.store_content(pg_temp.id('dm'), '\x01'::bytea, 'x', 'x', ARRAY[pg_temp.id('anna')]);
  RAISE EXCEPTION 'FEHLER: App speichert Yjs-Inhalt';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
SELECT app.store_content(pg_temp.id('dm'), '\x0a'::bytea, 'Tabellen und Schlüssel', 'Datenmodell', ARRAY[pg_temp.id('lukas')]);
SELECT app.store_content(pg_temp.id('dm'), '\x0b'::bytea, 'Tabellen, Schlüssel, RLS', 'Datenmodell v2', ARRAY[pg_temp.id('sophie')]);
DO $$
DECLARE v int;
BEGIN
  v := app.create_version(pg_temp.id('dm'), 'auto');
  ASSERT v = 1, 'erste Version nicht 1';
  ASSERT (SELECT cardinality(author_ids) FROM page_versions WHERE page_id = pg_temp.id('dm') AND version = 1) = 2,
    'Autoren fehlen';
  ASSERT (SELECT cardinality(editors_since_version) FROM page_contents WHERE page_id = pg_temp.id('dm')) = 0,
    'Autorenliste nicht zurückgesetzt';
  ASSERT (SELECT title FROM pages WHERE id = pg_temp.id('dm')) = 'Datenmodell v2', 'Titel nicht übernommen';
END $$;
RESET ROLE;
SET ROLE wiki_app;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  PERFORM app.create_version(pg_temp.id('dm'), 'manual', pg_temp.id('max'));
  RAISE EXCEPTION 'FEHLER: Leser speichert Version';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie'));
DO $$
BEGIN
  ASSERT app.create_version(pg_temp.id('dm'), 'manual', pg_temp.id('sophie')) = 2, 'zweite Version nicht 2';
  RAISE NOTICE 'OK 13 Nur der Collab-Server speichert Inhalt, Versionen mit Autoren';
END $$;

-- 14. Kommentare: Threads, erledigt, Antwort öffnet wieder, Löschen überschreibt
DO $$
DECLARE c uuid; r uuid; b text;
BEGIN
  c := app.add_comment(pg_temp.id('dm'), 'Fehlt hier tenant_id?', pg_temp.id('sophie'), '{"from": 12, "to": 30}');
  r := app.add_comment(pg_temp.id('dm'), 'Ja, ergänzt', pg_temp.id('sophie'), NULL, c);
  INSERT INTO ids VALUES ('c1', c), ('c1r', r);
  PERFORM app.set_comment_resolved(c, pg_temp.id('sophie'), true);
  ASSERT (SELECT resolved_at FROM comments WHERE id = c) IS NOT NULL, 'nicht erledigt';
  PERFORM app.add_comment(pg_temp.id('dm'), 'Doch noch eine Frage', pg_temp.id('sophie'), NULL, c);
  ASSERT (SELECT resolved_at FROM comments WHERE id = c) IS NULL, 'Antwort öffnet nicht wieder';
  BEGIN
    PERFORM app.add_comment(pg_temp.id('dm'), 'Zu tief', pg_temp.id('sophie'), NULL, r);
    RAISE EXCEPTION 'FEHLER: Antwort auf Antwort';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%eine Ebene tief%' THEN RAISE; END IF;
  END;
  PERFORM app.delete_comment(r, pg_temp.id('sophie'));
  SELECT body INTO b FROM comments WHERE id = r;
  ASSERT b IS NULL, 'Inhalt nicht gelöscht';
  BEGIN
    UPDATE comments SET body = 'zurück' WHERE id = r;
    RAISE EXCEPTION 'FEHLER: App ändert Kommentar direkt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
DO $$
BEGIN
  UPDATE comments SET body = 'zurück' WHERE id = pg_temp.id('c1r');
  RAISE EXCEPTION 'FEHLER: gelöschter Kommentar mit Inhalt';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
RESET ROLE;
SET ROLE wiki_app;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  PERFORM app.delete_comment(pg_temp.id('c1'), pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: fremder Kommentar gelöscht';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK 14 Kommentare: Threads, erledigt, Wiederöffnen, Löschen überschreibt, fremde nur Admins';
END $$;

-- 15. Mandantentrennung
SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pages;   ASSERT n = 0, 'fremde Seiten sichtbar';
  SELECT count(*) INTO n FROM spaces;  ASSERT n = 0, 'fremde Spaces sichtbar';
  SELECT count(*) INTO n FROM users;   ASSERT n = 1, 'fremde Personen sichtbar';
  SELECT count(*) INTO n FROM tenants; ASSERT n = 1, 'fremde Mandanten sichtbar';
  ASSERT app.page_rank(pg_temp.id('arch')) = 0, 'Rang über Mandantengrenzen';
  BEGIN
    INSERT INTO users (tenant_id, email, display_name) VALUES (pg_temp.id('t1'), 'x@x.example', 'X');
    RAISE EXCEPTION 'FEHLER: Schreiben in fremden Mandanten';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('eva'), NULL, 'admin', pg_temp.id('eva'));
    RAISE EXCEPTION 'FEHLER: Recht auf fremdem Space';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Space nicht gefunden%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK 15 Mandantentrennung beim Lesen, Schreiben und bei Rechten';
END $$;
SELECT pg_temp.ctx(NULL, NULL);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages) = 0, 'ohne Kontext sichtbar';
  RAISE NOTICE 'OK 16 Ohne gesetzten Mandanten ist nichts sichtbar';
END $$;

-- 17. Outbox und Audit-Log
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM outbox LIMIT 1;
    RAISE EXCEPTION 'FEHLER: App kann Outbox lesen';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM audit_log;
    RAISE EXCEPTION 'FEHLER: Audit-Log löschbar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM audit_log WHERE action = 'page.inheritance_cut') = 2, 'Audit fehlt';
  RAISE NOTICE 'OK 17 Outbox nur schreibbar, Audit-Log nicht löschbar und gefüllt';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM outbox WHERE subject = 't.' || pg_temp.id('t1') || '.wiki.s.' || pg_temp.id('entw')
          AND event_type = 'page.created') >= 5, 'Events fehlen';
  RAISE NOTICE 'OK 18 Events in der Outbox mit Subject t.<tenant>.wiki.s.<space>';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 19. Jede Tabelle ist abgesichert, auch künftige. tenants ist die einzige Ausnahme.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT c.oid, c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  LOOP
    n := n + 1;
    ASSERT r.relrowsecurity, format('RLS fehlt auf %s', r.relname);
    ASSERT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polname = 'tenant_isolation'),
      format('Policy fehlt auf %s', r.relname);
    ASSERT r.relname = 'tenants' OR EXISTS (SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = r.oid AND a.attname = 'tenant_id' AND a.attnotnull AND NOT a.attisdropped),
      format('tenant_id fehlt auf %s', r.relname);
    ASSERT r.owner NOT IN ('wiki_app', 'wiki_worker'), format('App besitzt %s', r.relname);
  END LOOP;
  ASSERT n >= 20, 'zu wenige Tabellen gefunden: ' || n;
  ASSERT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('wiki_app', 'wiki_worker')
                     AND (rolsuper OR rolbypassrls)), 'App-Rolle umgeht RLS';
  RAISE NOTICE 'OK 19 Alle Tabellen haben tenant_id und RLS, App-Rollen umgehen RLS nicht';
END $$;

-- 20. Niemand handelt im Namen anderer, path nur über Funktionen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Gefälscht', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Seite im Namen anderer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('max'), NULL, 'admin', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Recht im Namen anderer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  UPDATE pages SET path = 'x' WHERE id = pg_temp.id('arch');
  RAISE EXCEPTION 'FEHLER: path direkt geändert';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK 20 Handeln im Namen anderer abgelehnt, Baum nur über Funktionen änderbar';
END $$;

-- 21. Aus dem Workspace entfernt: persönliche Rechte weg, nichts mehr sichtbar
SELECT app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('sophie'), pg_temp.id('anna'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM grants WHERE user_id = pg_temp.id('sophie')) = 0, 'Rechte bleiben';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages) = 0, 'entfernte Person sieht Seiten';
  RAISE NOTICE 'OK 21 Aus dem Workspace entfernt: Rechte weg, Seiten unsichtbar';
END $$;

-- 22. Letzter Owner und letzter Organisations-Admin bleiben
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  BEGIN
    PERFORM app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('anna'), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: letzter Owner entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.set_user_role(pg_temp.id('anna'), 'member', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: letzter Organisations-Admin herabgestuft';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 22 Letzter Owner und letzter Organisations-Admin geschützt';
END $$;

-- 23. Organisations-Admin: kein automatischer Lesezugriff, aber Wiederherstellung von Rechten
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE s uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'PRIV', 'Privat', pg_temp.id('lukas'), NULL);
  INSERT INTO ids VALUES ('priv', s);
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM spaces WHERE id = pg_temp.id('priv')) = 0, 'Org-Admin sieht privaten Space';
  PERFORM app.set_grant(pg_temp.id('priv'), NULL, 'user', pg_temp.id('anna'), NULL, 'admin', pg_temp.id('anna'));
  ASSERT (SELECT count(*) FROM spaces WHERE id = pg_temp.id('priv')) = 1, 'Wiederherstellung wirkt nicht';
  ASSERT (SELECT count(*) FROM audit_log WHERE action = 'grant.changed' AND target_id = pg_temp.id('priv')) = 1,
    'Wiederherstellung nicht im Audit-Log';
  RAISE NOTICE 'OK 23 Organisations-Admin liest nicht automatisch, kann Rechte aber nachvollziehbar wiederherstellen';
END $$;

-- 24. Archivierte Spaces sind nur noch lesbar
SELECT app.archive_space(pg_temp.id('priv'), true, pg_temp.id('anna'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.space_role(pg_temp.id('priv')) = 'viewer', 'archivierter Space nicht nur lesbar';
  ASSERT app.page_role((SELECT home_page_id FROM spaces WHERE id = pg_temp.id('priv'))) = 'viewer',
    'Seite im archivierten Space nicht nur lesbar';
  PERFORM app.create_page(pg_temp.id('priv'), NULL, 'Neu', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: Seite in archiviertem Space';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK 24 Archivierte Spaces sind nur lesbar';
END $$;

-- 25. Import nur für Space-Admins mit geprüfter Datei
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE f uuid := uuidv7();
BEGIN
  INSERT INTO files (id, tenant_id, uploaded_by, storage_key, file_name, mime, size_bytes)
  VALUES (f, app.current_tenant(), pg_temp.id('anna'), 'k-imp', 'ENTW-export.zip', 'application/zip', 1);
  INSERT INTO ids VALUES ('f_imp', f);
  BEGIN
    PERFORM app.start_import(pg_temp.id('entw'), f, pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Import mit ungeprüfter Datei';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%nicht geprüft%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
UPDATE files SET scan_status = 'clean' WHERE id = pg_temp.id('f_imp');   -- Virenscan durch den Worker
RESET ROLE;
SET ROLE wiki_app;
DO $$
DECLARE i uuid;
BEGIN
  i := app.start_import(pg_temp.id('entw'), pg_temp.id('f_imp'), pg_temp.id('anna'));
  INSERT INTO ids VALUES ('imp', i);
  ASSERT (SELECT dry_run FROM imports WHERE id = i), 'Probelauf nicht Standard';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM imports) = 0, 'fremder Import sichtbar';
  PERFORM app.start_import(pg_temp.id('entw'), pg_temp.id('f_imp'), pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: Import ohne Admin-Recht';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  INSERT INTO import_items (import_id, source_id, tenant_id, page_id)
  VALUES (pg_temp.id('imp'), 'conf-98765', pg_temp.id('t1'), pg_temp.id('dm'));
  BEGIN
    INSERT INTO import_items (import_id, source_id, tenant_id) VALUES (pg_temp.id('imp'), 'conf-98765', pg_temp.id('t1'));
    RAISE EXCEPTION 'FEHLER: Confluence-ID doppelt importiert';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 25 Import nur für Space-Admins, jede Confluence-Seite nur einmal';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 26. Verweise über Grenzen lehnt die Datenbank selbst ab (als Worker, der direkt schreiben darf)
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  BEGIN
    INSERT INTO pages (tenant_id, space_id, parent_id, position, title)
    VALUES (app.current_tenant(), pg_temp.id('entw'), (SELECT home_page_id FROM spaces WHERE id = pg_temp.id('priv')), 'a5', 'Quer');
    RAISE EXCEPTION 'FEHLER: Elternseite aus anderem Space';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Elternseite nicht gefunden%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO comments (tenant_id, page_id, parent_id, author_id, body)
    VALUES (app.current_tenant(), pg_temp.id('arch'), pg_temp.id('c1'), pg_temp.id('anna'), 'falsche Seite');
    RAISE EXCEPTION 'FEHLER: Antwort auf Kommentar einer anderen Seite';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t2'), NULL);
DO $$
BEGIN
  INSERT INTO comments (tenant_id, page_id, author_id, body)
  VALUES (app.current_tenant(), pg_temp.id('arch'), pg_temp.id('eva'), 'fremd');
  RAISE EXCEPTION 'FEHLER: Kommentar auf Seite eines fremden Mandanten';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'OK 26 Verweise über Spaces, Seiten und Mandanten von der DB abgelehnt';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 27. Mandant finden und Einladung annehmen, bevor jemand angemeldet ist
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
INSERT INTO invites (tenant_id, workspace_id, email, token_hash, invited_by, expires_at, revoked_at)
VALUES (pg_temp.id('t1'), pg_temp.id('ws1'), 'neu@alpenwerk.example', 'hash-gueltig', pg_temp.id('anna'), now() + interval '7 days', NULL),
       (pg_temp.id('t1'), pg_temp.id('ws1'), 'alt@alpenwerk.example', 'hash-abgelaufen', pg_temp.id('anna'), now() - interval '1 day', NULL);
SELECT pg_temp.ctx(NULL, NULL);
DO $$
DECLARE r record; u uuid;
BEGIN
  ASSERT (SELECT count(*) FROM tenants) = 0, 'Mandanten ohne Kontext sichtbar';
  SELECT * INTO r FROM app.resolve_tenant('alpenwerk');
  ASSERT r.tenant_id = pg_temp.id('t1'), 'Mandant nicht gefunden';
  ASSERT NOT EXISTS (SELECT 1 FROM app.find_invite('hash-abgelaufen')), 'abgelaufene Einladung gefunden';
  SELECT * INTO r FROM app.find_invite('hash-gueltig');
  ASSERT r.invited_by_name = 'Anna Huber', 'Einladung unvollständig';
  PERFORM pg_temp.ctx(r.tenant_id, NULL);
  u := app.accept_invite('hash-gueltig', 'Neue Person');
  ASSERT (SELECT role FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = u) = 'member',
    'keine Mitgliedschaft';
  ASSERT NOT EXISTS (SELECT 1 FROM app.find_invite('hash-gueltig')), 'benutzte Einladung gefunden';
  RAISE NOTICE 'OK 27 Mandant per Slug gefunden, Einladung nur einmal gültig';
END $$;

-- 28. Längengrenzen für Eingaben
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), repeat('x', 256), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: zu langer Titel';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), repeat('x', 10001), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: zu langer Kommentar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), '', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: leerer Kommentar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.create_space(pg_temp.id('ws1'), 'x-1', 'Ungültig', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: ungültiger Space-Key';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Position', pg_temp.id('anna'), 'ä!');
    RAISE EXCEPTION 'FEHLER: ungültige Position';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 28 Längengrenzen für Titel, Kommentare, Space-Keys und Positionen';
END $$;

-- 29. Vererbung ändern nur Admins, und nur über app.set_page_inheritance
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.page_role(pg_temp.id('geh')) = 'editor', 'Voraussetzung: Lukas ist Editor der Gehälter';
  BEGIN
    UPDATE pages SET inherit_perms = true WHERE id = pg_temp.id('geh');
    RAISE EXCEPTION 'FEHLER: Editor hebt Einschränkung direkt auf';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE pages SET inherit_perms = false WHERE id = pg_temp.id('lukas_page');
    RAISE EXCEPTION 'FEHLER: Editor kappt Vererbung direkt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_page_inheritance(pg_temp.id('geh'), true, pg_temp.id('lukas'));
    RAISE EXCEPTION 'FEHLER: Editor hebt Einschränkung über Funktion auf';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 29 Vererbung ändern nur Admins, nie direkt';
END $$;

-- 30. Kein Weg an den Funktionen vorbei: Ein Leser schreibt nichts direkt, was Rechte,
--     Inhalte, Import, Events oder das Audit-Log berührt
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE
  t uuid := pg_temp.id('t1'); m uuid := pg_temp.id('max');
  v_sql text; n int;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format('INSERT INTO grants (tenant_id, space_id, subject_type, user_id, role) VALUES (%L, %L, ''user'', %L, ''admin'')', t, pg_temp.id('entw'), m),
    format('DELETE FROM grants WHERE space_id = %L', pg_temp.id('entw')),
    format('UPDATE users SET role = ''org_admin'' WHERE id = %L', m),
    format('UPDATE users SET deactivated_at = now() WHERE id = %L', pg_temp.id('anna')),
    format('INSERT INTO users (tenant_id, email, display_name, role) VALUES (%L, ''boss@x.example'', ''Boss'', ''org_admin'')', t),
    format('UPDATE workspace_members SET role = ''owner'' WHERE user_id = %L', m),
    format('INSERT INTO group_members (group_id, user_id, tenant_id) VALUES (%L, %L, %L)', pg_temp.id('grp_dev'), m, t),
    format('INSERT INTO page_versions (tenant_id, page_id, version, kind, title, ydoc) VALUES (%L, %L, 99, ''manual'', ''x'', ''\x01''::bytea)', t, pg_temp.id('geh')),
    format('INSERT INTO page_contents (page_id, tenant_id, ydoc) VALUES (%L, %L, ''\x00''::bytea)', pg_temp.id('home'), t),
    format('INSERT INTO imports (tenant_id, space_id, file_id, dry_run, created_by) VALUES (%L, %L, %L, false, %L)', t, pg_temp.id('entw'), pg_temp.id('f_imp'), m),
    format('UPDATE spaces SET archived_at = NULL WHERE id = %L', pg_temp.id('priv')),
    format('UPDATE comments SET body = ''geändert'' WHERE id = %L', pg_temp.id('c1')),
    format('INSERT INTO outbox (tenant_id, subject, event_type, payload) VALUES (%L, ''x'', ''import.requested'', ''{}'')', t),
    format('INSERT INTO audit_log (tenant_id, actor_id, action, target_type) VALUES (%L, %L, ''x'', ''x'')', t, pg_temp.id('anna')),
    format('UPDATE tenants SET idp_org_id = ''fremd'' WHERE id = %L', t),
    format('INSERT INTO page_search (page_id, tenant_id, space_id, tsv) VALUES (%L, %L, %L, ''x'')', pg_temp.id('home'), t, pg_temp.id('entw')),
    format('INSERT INTO files (tenant_id, page_id, uploaded_by, storage_key, file_name, mime, size_bytes) VALUES (%L, %L, %L, ''k-x'', ''x'', ''x'', 1)', t, pg_temp.id('geh'), m),
    format('INSERT INTO files (tenant_id, uploaded_by, storage_key, file_name, mime, size_bytes, scan_status) VALUES (%L, %L, ''k-y'', ''x'', ''x'', 1, ''clean'')', t, m),
    format('UPDATE files SET scan_status = ''clean'' WHERE uploaded_by = %L', m),
    format('UPDATE users SET avatar_file_id = %L WHERE id = %L', pg_temp.id('f_geh'), m),
    format('INSERT INTO invites (tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at) VALUES (%L, %L, ''zweit@x.example'', ''admin'', ''h-max'', %L, now() + interval ''1 day'')', t, pg_temp.id('ws1'), m)
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FEHLER: direkt geschrieben: %', v_sql;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- Erlaubt bleibt das eigene Profil, fremde Profile nicht
  UPDATE users SET display_name = 'Max M.' WHERE id = m;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'eigenes Profil nicht änderbar';
  UPDATE users SET display_name = 'Gekapert' WHERE id = pg_temp.id('anna');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'fremdes Profil änderbar';
  ASSERT (SELECT count(*) FROM audit_log) = 0, 'Audit-Log für Mitglieder lesbar';
  RAISE NOTICE 'OK 30 Kein direkter Weg an den Funktionen vorbei (Rechte, Inhalte, Import, Events, Audit)';
END $$;

-- 31. Verschieben aus einem eingeschränkten Bereich nur als dessen Admin, hinein als Editor
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  PERFORM app.move_page(pg_temp.id('geh27'), pg_temp.id('home'), 'a5', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: Editor holt Seite aus eingeschränktem Bereich';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
SELECT app.move_page(pg_temp.id('geh27'), pg_temp.id('home'), 'a5', pg_temp.id('anna'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('geh27')) = 1, 'vom Admin freigegebene Seite unsichtbar';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
SELECT app.move_page(pg_temp.id('geh27'), pg_temp.id('geh'), 'a0', pg_temp.id('lukas'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('geh27')) = 0, 'Seite nach Verschieben in den Bereich sichtbar';
  RAISE NOTICE 'OK 31 Aus eingeschränkten Bereichen verschieben nur deren Admins';
END $$;

-- 32. Deaktivierte Admins zählen nicht, ihre Rechte lassen sich entfernen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE s uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'OPS', 'Betrieb', pg_temp.id('anna'), NULL);
  INSERT INTO ids VALUES ('ops', s);
  PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('max'), NULL, 'admin', pg_temp.id('anna'));
  PERFORM app.set_user_active(pg_temp.id('max'), false, pg_temp.id('anna'));
  BEGIN
    PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('anna'), NULL, NULL, pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: letzter aktiver Admin entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('max'), NULL, NULL, pg_temp.id('anna'));
  ASSERT NOT EXISTS (SELECT 1 FROM grants WHERE space_id = s AND user_id = pg_temp.id('max')),
    'Recht der deaktivierten Person nicht entfernbar';
  BEGIN
    PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('max'), NULL, 'viewer', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Recht an deaktivierte Person vergeben';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%kein aktives Mitglied%' THEN RAISE; END IF;
  END;
  PERFORM app.set_user_active(pg_temp.id('max'), true, pg_temp.id('anna'));
  RAISE NOTICE 'OK 32 Deaktivierte Admins zählen nicht, ihre Rechte lassen sich entfernen';
END $$;

-- 33. Letzter Admin bleibt: beim Entfernen aus dem Workspace und als Rückfallebene im Trigger
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE s uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'LUK', 'Lukas', pg_temp.id('lukas'), NULL);
  INSERT INTO ids VALUES ('luk', s);
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  BEGIN
    PERFORM app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('lukas'), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: letzter Admin eines Spaces aus dem Workspace entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  ASSERT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = pg_temp.id('lukas')),
    'Mitgliedschaft trotz Fehler entfernt';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;   -- der Trigger prüft sonst erst beim Commit
  DELETE FROM grants WHERE space_id = pg_temp.id('luk') AND role = 'admin';
  RAISE EXCEPTION 'FEHLER: letzter Admin direkt gelöscht';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'OK 33 Letzter Admin bleibt, auch beim Entfernen aus dem Workspace und an Funktionen vorbei';
END $$;

-- 34. Entzogene Rechte erreichen den Collab-Server als Event
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'member.removed'
                 AND payload->>'user' = pg_temp.id('sophie')::text
                 AND subject = 't.' || pg_temp.id('t1') || '.wiki.s.' || pg_temp.id('entw')), 'member.removed fehlt';
  ASSERT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'user.deactivated'
                 AND payload->>'user' = pg_temp.id('max')::text), 'user.deactivated fehlt';
  ASSERT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'space.archived'
                 AND payload->>'id' = pg_temp.id('priv')::text), 'space.archived fehlt';
  ASSERT (SELECT count(*) FROM outbox WHERE event_type = 'page.permissions_changed'
          AND payload->>'id' = pg_temp.id('geh27')::text) = 2, 'page.permissions_changed beim Verschieben fehlt';
  ASSERT NOT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'page.permissions_changed'
                     AND payload->>'id' = pg_temp.id('arch')::text), 'Event ohne Änderung der Rechtequelle';
  RAISE NOTICE 'OK 34 Events für entfernte Mitglieder, Deaktivieren, Archivieren und Verschieben';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 35. Kommentare bearbeiten nur Autoren, fremde löschen nur Admins der Seite
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE c uuid;
BEGIN
  c := app.add_comment(pg_temp.id('arch'), 'Erster Entwurf', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('c_anna', c);
  PERFORM app.edit_comment(c, 'Zweiter Entwurf', pg_temp.id('anna'));
  ASSERT (SELECT body FROM comments WHERE id = c) = 'Zweiter Entwurf', 'Bearbeiten wirkt nicht';
  ASSERT (SELECT edited_at FROM comments WHERE id = c) IS NOT NULL, 'edited_at fehlt';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  PERFORM app.edit_comment(pg_temp.id('c_anna'), 'Fremd geändert', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: fremder Kommentar bearbeitet';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  PERFORM app.delete_comment(pg_temp.id('c1'), pg_temp.id('anna'));   -- Space-Admin, Kommentar von Sophie
  ASSERT (SELECT deleted_at FROM comments WHERE id = pg_temp.id('c1')) IS NOT NULL, 'Admin kann nicht löschen';
  RAISE NOTICE 'OK 35 Kommentare bearbeiten nur Autoren, fremde löschen nur Admins der Seite';
END $$;

-- 36. Titel kommt aus Yjs: Zu lange Titel und Texte werden gekürzt, statt das Speichern
--     abzulehnen (sonst gingen alle weiteren Änderungen verloren)
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE dm uuid := pg_temp.id('dm');
BEGIN
  PERFORM app.store_content(dm, '\x0c'::bytea, repeat('x', 2000001), repeat('T', 300), ARRAY[pg_temp.id('anna')]);
  ASSERT (SELECT length(title) FROM pages WHERE id = dm) = 255, 'zu langer Titel nicht gekürzt';
  ASSERT (SELECT length(plain_text) FROM page_contents WHERE page_id = dm) = 2000000, 'zu langer Text nicht gekürzt';
  PERFORM app.store_content(dm, '\x0d'::bytea, 'Text', NULL, ARRAY[pg_temp.id('anna')]);
  ASSERT (SELECT length(title) FROM pages WHERE id = dm) = 255, 'Titel ohne Angabe verändert';
  PERFORM app.store_content(dm, '\x0e'::bytea, 'Text', '  Datenmodell  ', ARRAY[pg_temp.id('anna')]);
  ASSERT (SELECT title FROM pages WHERE id = dm) = 'Datenmodell', 'Titel nicht übernommen';
  RAISE NOTICE 'OK 36 Titel nur über Yjs, zu lange Titel und Texte werden gekürzt';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 37. Positionen ohne Angabe: hinter alle Geschwister (auch unsichtbare) und kurz,
--     mit denselben Schlüsseln wie das npm-Paket fractional-indexing
DO $$
BEGIN
  ASSERT app.next_position(NULL) = 'a0', 'erste Position';
  ASSERT app.next_position('a0') = 'a1', 'a0';
  ASSERT app.next_position('a9') = 'aA', 'a9';
  ASSERT app.next_position('aZ') = 'aa', 'aZ';
  ASSERT app.next_position('az') = 'b00', 'az';
  ASSERT app.next_position('b0z') = 'b10', 'b0z';
  ASSERT app.next_position('a0V') = 'a1', 'Nachkommastellen nicht ignoriert';
  ASSERT app.next_position('Zz') = 'a0', 'Zz';
  ASSERT app.next_position('Yzz') = 'Z0', 'Yzz';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE p uuid; h uuid;
BEGIN
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Viele Kinder', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('viele', p);
  FOR i IN 1..70 LOOP
    PERFORM app.create_page(pg_temp.id('entw'), p, 'Kind ' || i, pg_temp.id('anna'));
  END LOOP;
  ASSERT (SELECT max(length(position)) FROM pages WHERE parent_id = p) = 3, 'Positionen wachsen';
  ASSERT (SELECT array_agg(title ORDER BY position, id) FROM pages WHERE parent_id = p)
       = (SELECT array_agg('Kind ' || i ORDER BY i) FROM generate_series(1, 70) AS i), 'Reihenfolge falsch';
  -- Ein eingeschränktes Geschwister weit hinten, für Lukas unsichtbar
  h := app.create_page(pg_temp.id('entw'), p, 'Geheim', pg_temp.id('anna'), 'c000');
  PERFORM app.set_page_inheritance(h, false, pg_temp.id('anna'));
  PERFORM app.set_grant(NULL, h, 'workspace', NULL, NULL, NULL, pg_temp.id('anna'));
  PERFORM app.set_grant(NULL, h, 'group', NULL, pg_temp.id('grp_dev'), NULL, pg_temp.id('anna'));
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), p, 'Falsch', pg_temp.id('anna'), 'z0');
    RAISE EXCEPTION 'FEHLER: Position mit zu kurzem ganzzahligem Teil';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE c uuid;
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE parent_id = pg_temp.id('viele')) = 70, 'Lukas sieht das eingeschränkte Geschwister';
  c := app.create_page(pg_temp.id('entw'), pg_temp.id('viele'), 'Von Lukas am Ende', pg_temp.id('lukas'));
  ASSERT (SELECT position FROM pages WHERE id = c) = 'c001', 'nicht hinter dem unsichtbaren Geschwister';
  RAISE NOTICE 'OK 37 Positionen ohne Angabe bleiben kurz und landen hinter allen Geschwistern';
END $$;

-- 38. Dieselbe Person aus Zitadel in mehreren Mandanten, pro Mandant aber nur einmal
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  INSERT INTO users (tenant_id, idp_subject, email, display_name)
  VALUES (app.current_tenant(), 'zitadel-4711', 'berater@extern.example', 'Berater');
  BEGIN
    INSERT INTO users (tenant_id, idp_subject, email, display_name)
    VALUES (app.current_tenant(), 'zitadel-4711', 'zweit@extern.example', 'Doppelt');
    RAISE EXCEPTION 'FEHLER: dieselbe Person zweimal im Mandanten';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
BEGIN
  INSERT INTO users (tenant_id, idp_subject, email, display_name)
  VALUES (app.current_tenant(), 'zitadel-4711', 'berater@extern.example', 'Berater');
  RAISE NOTICE 'OK 38 Dieselbe Person aus Zitadel in mehreren Mandanten, pro Mandant einmal';
END $$;

-- 39. Gäste sehen nur, was ihnen ausdrücklich freigegeben ist, den Space nur über diese Seite
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE g uuid;
BEGIN
  g := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Für die Agentur', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('agentur', g);
  PERFORM app.set_page_inheritance(g, false, pg_temp.id('anna'));
  PERFORM app.set_grant(NULL, g, 'user', pg_temp.id('elena'), NULL, 'commenter', pg_temp.id('anna'));
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena'));
DO $$
BEGIN
  ASSERT (SELECT array_agg(id) FROM pages) = ARRAY[pg_temp.id('agentur')], 'Gast sieht mehr als die freigegebene Seite';
  ASSERT (SELECT count(*) FROM spaces WHERE id = pg_temp.id('entw')) = 1, 'Gast sieht den Space der Seite nicht (Brotkrume)';
  ASSERT app.space_role(pg_temp.id('entw')) IS NULL, 'Gast hat eine Rolle im ganzen Space';
  ASSERT app.page_role(pg_temp.id('agentur')) = 'commenter', 'Recht des Gasts fehlt';
  PERFORM app.add_comment(pg_temp.id('agentur'), 'Passt so', pg_temp.id('elena'));
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('agentur'), 'Vom Gast', pg_temp.id('elena'));
    RAISE EXCEPTION 'FEHLER: Gast mit commenter legt Seite an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 39 Gäste sehen nur ausdrücklich freigegebene Seiten, den Space nur über diese';
END $$;

-- 40. Deaktivierte Personen sehen nichts mehr und dürfen nichts, auch mit Rechten
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
SELECT app.set_user_active(pg_temp.id('lukas'), false, pg_temp.id('anna'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages) = 0, 'deaktivierte Person sieht Seiten';
  ASSERT (SELECT count(*) FROM spaces) = 0, 'deaktivierte Person sieht Spaces';
  ASSERT app.page_role(pg_temp.id('home')) IS NULL, 'deaktivierte Person hat eine Rolle';
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Nach dem Austritt', pg_temp.id('lukas'));
    RAISE EXCEPTION 'FEHLER: deaktivierte Person legt Seite an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 40 Deaktivierte Personen sehen nichts und dürfen nichts';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
SELECT app.set_user_active(pg_temp.id('lukas'), true, pg_temp.id('anna'));

-- 41. Kleine Regeln: kein Admin für alle im Workspace, kleine Anker, keine Kommentare im
--     Papierkorb, Wiederherstellen nur aus vorhandenen, älteren Versionen
DO $$
DECLARE t uuid;
BEGIN
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'workspace', NULL, NULL, 'admin', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: alle im Workspace als Admin';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%können nicht Admin sein%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), 'Anker', pg_temp.id('anna'), jsonb_build_object('x', repeat('y', 3000)));
    RAISE EXCEPTION 'FEHLER: riesiger Anker';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  t := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Wegwerfen', pg_temp.id('anna'));
  PERFORM app.trash_page(t, pg_temp.id('anna'));
  BEGIN
    PERFORM app.add_comment(t, 'Zu spät', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Kommentar im Papierkorb';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%liegt im Papierkorb%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE v int;
BEGIN
  BEGIN
    PERFORM app.create_version(pg_temp.id('dm'), 'restore', NULL, 0);
    RAISE EXCEPTION 'FEHLER: aus nicht vorhandener Version wiederhergestellt';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.create_version(pg_temp.id('dm'), 'restore', NULL, 99);
    RAISE EXCEPTION 'FEHLER: aus künftiger Version wiederhergestellt';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v := app.create_version(pg_temp.id('dm'), 'restore', NULL, 1);
  ASSERT (SELECT restored_from FROM page_versions WHERE page_id = pg_temp.id('dm') AND version = v) = 1,
    'Wiederherstellung nicht vermerkt';
  BEGIN
    INSERT INTO grants (tenant_id, space_id, subject_type, role)
    VALUES (app.current_tenant(), pg_temp.id('ops'), 'workspace', 'admin');
    RAISE EXCEPTION 'FEHLER: alle im Workspace als Admin (direkt)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 41 Kein Admin für alle, kleine Anker, kein Kommentar im Papierkorb, Versionen geprüft';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 42. Rechte anderer Personen lassen sich nicht abfragen, interne Bausteine nicht aufrufen,
--     und künftige Funktionen sind nicht von selbst für alle ausführbar
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format('SELECT app.page_rank(%L::uuid, %L::uuid)', pg_temp.id('geh'), pg_temp.id('lukas')),
    format('SELECT app.space_rank(%L::uuid, %L::uuid)', pg_temp.id('entw'), pg_temp.id('anna')),
    format('SELECT app.has_admin(%L::uuid)', pg_temp.id('entw')),
    format('SELECT app.perm_source(%L::uuid)', pg_temp.id('geh27')),
    format('SELECT app.emit(%L::uuid, %L::uuid, ''x'', ''{}'')', pg_temp.id('t1'), pg_temp.id('entw')),
    format('SELECT app.audit(%L::uuid, ''x'', ''x'', NULL)', pg_temp.id('anna')),
    format('SELECT app.insert_version(%L::uuid, ''manual'', NULL, NULL)', pg_temp.id('dm')),
    format('SELECT app.lock_tree(%L::uuid, true)', pg_temp.id('entw'))
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FEHLER: für wiki_app aufrufbar: %', v_sql;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  ASSERT app.page_rank(pg_temp.id('arch')) = 1, 'eigener Rang nicht abfragbar';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace
                     AND has_function_privilege('public', p.oid, 'EXECUTE')), 'Funktion für PUBLIC ausführbar';
  -- Globaler Eintrag für wiki_owner, der PUBLIC nicht enthält
  ASSERT EXISTS (SELECT 1 FROM pg_default_acl d
                 WHERE d.defaclrole = 'wiki_owner'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 0)),
    'künftige Funktionen wären für PUBLIC ausführbar';
  RAISE NOTICE 'OK 42 Rechte anderer nicht abfragbar, interne Bausteine gesperrt, auch künftige';
END $$;

RESET ROLE;
ROLLBACK;
\echo 'Alle Tests bestanden (zurückgerollt, die Datenbank ist unverändert).'
