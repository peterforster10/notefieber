-- =============================================================================
-- Tests 25–28: Import, Verweise über Grenzen, Einladungen, Eingabegrenzen
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: arch c1 dm entw eva home lukas peter priv t1 t2 ws1
-- Legt Testdaten an: f_imp imp
-- =============================================================================

-- 25. Import nur für Space-Admins mit geprüfter Datei
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE f uuid := uuidv7();
BEGIN
  INSERT INTO files (id, tenant_id, uploaded_by, storage_key, file_name, mime, size_bytes)
  VALUES (f, app.current_tenant(), pg_temp.id('peter'), 'k-imp', 'ENTW-export.zip', 'application/zip', 1);
  INSERT INTO ids VALUES ('f_imp', f);
  BEGIN
    PERFORM app.start_import(pg_temp.id('entw'), f, pg_temp.id('peter'));
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
  i := app.start_import(pg_temp.id('entw'), pg_temp.id('f_imp'), pg_temp.id('peter'));
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
    VALUES (app.current_tenant(), pg_temp.id('arch'), pg_temp.id('c1'), pg_temp.id('peter'), 'falsche Seite');
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
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
INSERT INTO invites (tenant_id, workspace_id, email, token_hash, invited_by, expires_at, revoked_at)
VALUES (pg_temp.id('t1'), pg_temp.id('ws1'), 'neu@alpenwerk.example', 'hash-gueltig', pg_temp.id('peter'), now() + interval '7 days', NULL),
       (pg_temp.id('t1'), pg_temp.id('ws1'), 'alt@alpenwerk.example', 'hash-abgelaufen', pg_temp.id('peter'), now() - interval '1 day', NULL);
SELECT pg_temp.ctx(NULL, NULL);
DO $$
DECLARE r record; u uuid;
BEGIN
  ASSERT (SELECT count(*) FROM tenants) = 0, 'Mandanten ohne Kontext sichtbar';
  SELECT * INTO r FROM app.resolve_tenant('test-alpenwerk');
  ASSERT r.tenant_id = pg_temp.id('t1'), 'Mandant nicht gefunden';
  ASSERT NOT EXISTS (SELECT 1 FROM app.find_invite('hash-abgelaufen')), 'abgelaufene Einladung gefunden';
  SELECT * INTO r FROM app.find_invite('hash-gueltig');
  ASSERT r.invited_by_name = 'Peter Forster', 'Einladung unvollständig';
  PERFORM pg_temp.ctx(r.tenant_id, NULL);
  u := app.accept_invite('hash-gueltig', 'Neue Person');
  ASSERT (SELECT role FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = u) = 'member',
    'keine Mitgliedschaft';
  ASSERT NOT EXISTS (SELECT 1 FROM app.find_invite('hash-gueltig')), 'benutzte Einladung gefunden';
  RAISE NOTICE 'OK 27 Mandant per Slug gefunden, Einladung nur einmal gültig';
END $$;

-- 28. Längengrenzen für Eingaben
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), repeat('x', 256), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: zu langer Titel';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), repeat('x', 10001), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: zu langer Kommentar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), '', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: leerer Kommentar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.create_space(pg_temp.id('ws1'), 'x-1', 'Ungültig', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: ungültiger Space-Key';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Position', pg_temp.id('peter'), 'ä!');
    RAISE EXCEPTION 'FEHLER: ungültige Position';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 28 Längengrenzen für Titel, Kommentare, Space-Keys und Positionen';
END $$;
