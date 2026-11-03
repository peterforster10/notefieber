-- Funktionstest für schema.sql. Läuft als wiki_app (bzw. wiki_worker), damit RLS greift.
-- Aufruf auf einer frischen Datenbank, als wiki_owner:
--   psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f schema_test.sql
\set QUIET on
\pset tuples_only on
SET client_min_messages = notice;
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
    INSERT INTO workspace_members (workspace_id, user_id, tenant_id) VALUES (pg_temp.id('ws1'), u, app.current_tenant());
  END LOOP;
  u := uuidv7();
  INSERT INTO users (id, tenant_id, email, display_name, is_external)
  VALUES (u, app.current_tenant(), 'elena@agentur-nord.example', 'Elena Novak', true);
  INSERT INTO ids VALUES ('elena', u);
  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role) VALUES (pg_temp.id('ws1'), u, app.current_tenant(), 'guest');
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
  UPDATE page_contents SET plain_text = 'überschrieben' WHERE page_id = pg_temp.id('arch');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Leser ändert Inhalt direkt';
  UPDATE pages SET title = 'Gekapert' WHERE id = pg_temp.id('arch');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'Leser ändert Titel direkt';
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
  INSERT INTO ids VALUES ('geh', g), ('geh27', c);
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
    PERFORM app.move_page(pg_temp.id('arch'), pg_temp.id('dm'), 'b', pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Seite unter sich selbst verschoben';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('intern')) = 0, 'Sophie sieht Intern';
  PERFORM app.move_page(pg_temp.id('arch'), NULL, 'b', pg_temp.id('sophie'));
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
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  n := app.restore_page(pg_temp.id('arch'), pg_temp.id('anna'));
  ASSERT n = 3, 'nicht alles wiederhergestellt';
  BEGIN
    PERFORM app.trash_page(pg_temp.id('home'), pg_temp.id('anna'));
    RAISE EXCEPTION 'FEHLER: Startseite gelöscht';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
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
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  PERFORM app.delete_comment(r, pg_temp.id('sophie'));
  SELECT body INTO b FROM comments WHERE id = r;
  ASSERT b IS NULL, 'Inhalt nicht gelöscht';
  BEGIN
    UPDATE comments SET body = 'zurück' WHERE id = r;
    RAISE EXCEPTION 'FEHLER: gelöschter Kommentar mit Inhalt';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
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
  ASSERT app.page_rank(pg_temp.id('arch'), pg_temp.id('eva')) = 0, 'Rang über Mandantengrenzen';
  BEGIN
    INSERT INTO users (tenant_id, email, display_name) VALUES (pg_temp.id('t1'), 'x@x.example', 'X');
    RAISE EXCEPTION 'FEHLER: Schreiben in fremden Mandanten';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('eva'), NULL, 'admin', pg_temp.id('eva'));
    RAISE EXCEPTION 'FEHLER: Recht auf fremdem Space';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
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
    DELETE FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = pg_temp.id('anna');
    RAISE EXCEPTION 'FEHLER: letzter Owner entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    UPDATE users SET role = 'member' WHERE id = pg_temp.id('anna');
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
DO $$
BEGIN
  UPDATE spaces SET archived_at = now() WHERE id = pg_temp.id('priv');
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.space_role(pg_temp.id('priv')) = 'viewer', 'archivierter Space nicht nur lesbar';
  PERFORM app.create_page(pg_temp.id('priv'), NULL, 'Neu', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: Seite in archiviertem Space';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK 24 Archivierte Spaces sind nur lesbar';
END $$;

-- 25. Import nur für Space-Admins mit geprüfter Datei
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE f uuid := uuidv7(); i uuid;
BEGIN
  INSERT INTO files (id, tenant_id, uploaded_by, storage_key, file_name, mime, size_bytes, scan_status)
  VALUES (f, app.current_tenant(), pg_temp.id('anna'), 'k-imp', 'ENTW-export.zip', 'application/zip', 1, 'clean');
  INSERT INTO ids VALUES ('f_imp', f);
  i := app.start_import(pg_temp.id('entw'), f, pg_temp.id('anna'));
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

-- 26. Verweise über Grenzen lehnt die Datenbank selbst ab
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
BEGIN
  BEGIN
    INSERT INTO pages (tenant_id, space_id, parent_id, position, title)
    VALUES (app.current_tenant(), pg_temp.id('entw'), (SELECT home_page_id FROM spaces WHERE id = pg_temp.id('priv')), 'q', 'Quer');
    RAISE EXCEPTION 'FEHLER: Elternseite aus anderem Space';
  EXCEPTION WHEN raise_exception OR foreign_key_violation OR insufficient_privilege THEN
    IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO comments (tenant_id, page_id, parent_id, author_id, body)
    VALUES (app.current_tenant(), pg_temp.id('arch'), pg_temp.id('c1'), pg_temp.id('anna'), 'falsche Seite');
    RAISE EXCEPTION 'FEHLER: Antwort auf Kommentar einer anderen Seite';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
BEGIN
  INSERT INTO comments (tenant_id, page_id, author_id, body)
  VALUES (app.current_tenant(), pg_temp.id('arch'), pg_temp.id('eva'), 'fremd');
  RAISE EXCEPTION 'FEHLER: Kommentar auf Seite eines fremden Mandanten';
EXCEPTION WHEN foreign_key_violation THEN
  RAISE NOTICE 'OK 26 Verweise über Spaces, Seiten und Mandanten von der DB abgelehnt';
END $$;

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

RESET ROLE;
\echo 'Alle Tests bestanden.'
