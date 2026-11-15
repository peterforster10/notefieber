-- =============================================================================
-- Tests 6–12: Rechte: Leser, Gruppen, Vererbung, Sichtbarkeit, Verschieben, Papierkorb
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: arch dm entw home lukas max peter sophie t1
-- Legt Testdaten an: f_geh geh geh27 grp_dev intern lukas_page
-- =============================================================================

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

-- 7. Gruppen aus dem Login-Dienst geben Rechte. Den Abgleich ruft (bis zum Gruppen-Claim,
--    E03) nur wiki_worker auf, nicht die App (REVIEW.md, R-02; Test 42)
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
SELECT app.sync_user_groups(pg_temp.id('lukas'), ARRAY['grp-dev'], ARRAY['Entwicklung']);
RESET ROLE;
SET ROLE wiki_app;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  INSERT INTO ids SELECT 'grp_dev', id FROM groups WHERE source = 'idp' AND external_id = 'grp-dev';
  PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'group', NULL, pg_temp.id('grp_dev'), 'editor', pg_temp.id('peter'));
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE p uuid;
BEGIN
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Von Lukas', pg_temp.id('lukas'));
  INSERT INTO ids VALUES ('lukas_page', p);
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT app.sync_user_groups(pg_temp.id('lukas'), '{}', '{}');
RESET ROLE;
SET ROLE wiki_app;
DO $$
BEGIN
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Noch eine', pg_temp.id('lukas'));
    RAISE EXCEPTION 'FEHLER: Gruppenrecht bleibt nach Austritt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT app.sync_user_groups(pg_temp.id('lukas'), ARRAY['grp-dev'], ARRAY['Entwicklung']);
RESET ROLE;
SET ROLE wiki_app;
DO $$
BEGIN
  RAISE NOTICE 'OK  7 Gruppenrechte kommen und gehen mit der Gruppe';
END $$;

-- 8. Vererbung kappen: bisherige Rechte werden kopiert, dann eingeschränkt
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE g uuid; c uuid; n int; f uuid := uuidv7();
BEGIN
  g := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Gehälter', pg_temp.id('peter'));
  c := app.create_page(pg_temp.id('entw'), g, 'Gehälter 2027', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('geh', g), ('geh27', c), ('f_geh', f);
  PERFORM app.set_page_inheritance(g, false, pg_temp.id('peter'));
  SELECT count(*) INTO n FROM grants WHERE page_id = g;
  ASSERT n = 3, 'Rechte nicht kopiert: ' || n;   -- peter admin, Workspace viewer, Gruppe editor
  PERFORM app.set_grant(NULL, g, 'workspace', NULL, NULL, NULL, pg_temp.id('peter'));
  PERFORM app.add_comment(g, 'Bitte bis Freitag prüfen', pg_temp.id('peter'));
  INSERT INTO files (id, tenant_id, page_id, uploaded_by, storage_key, file_name, mime, size_bytes)
  VALUES (f, app.current_tenant(), g, pg_temp.id('peter'), 'k-geh', 'gehaelter.xlsx', 'application/vnd.ms-excel', 1);
  BEGIN
    PERFORM app.set_grant(NULL, g, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letzter Admin der Seite entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RAISE NOTICE 'OK  8 Vererbung gekappt, Rechte kopiert, letzter Admin bleibt';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
SELECT pg_temp.store_all(pg_temp.id('geh'), '\x0102'::bytea, '[]'::jsonb, 'Gehaltsbänder 2027', 'Gehälter', ARRAY[pg_temp.id('peter')]);
SELECT app.create_version(pg_temp.id('geh'), 'auto');
SELECT app.replace_page_links(pg_temp.id('arch'), ARRAY[pg_temp.id('geh'), pg_temp.id('dm')]);
-- page_search ('Gehälter Gehaltsbänder') schreibt app.store_derived mit (Test 55)
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
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE i uuid;
BEGIN
  PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('sophie'), NULL, 'editor', pg_temp.id('peter'));
  i := app.create_page(pg_temp.id('entw'), pg_temp.id('dm'), 'Intern', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('intern', i);
  PERFORM app.set_page_inheritance(i, false, pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, i, 'user', pg_temp.id('sophie'), NULL, NULL, pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, i, 'workspace', NULL, NULL, NULL, pg_temp.id('peter'));
  BEGIN
    PERFORM app.move_page(pg_temp.id('arch'), pg_temp.id('dm'), 'a1', pg_temp.id('peter'));
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
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
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
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE n int;
BEGIN
  n := app.trash_page(pg_temp.id('arch'), pg_temp.id('peter'));
  ASSERT n = 3, 'erwartet 3 Seiten im Papierkorb, sind ' || n;
  BEGIN
    PERFORM app.restore_page(pg_temp.id('dm'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Unterseite einzeln wiederhergestellt';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Nur die Seite, die gelöscht wurde%' THEN RAISE; END IF;
  END;
  n := app.restore_page(pg_temp.id('arch'), pg_temp.id('peter'));
  ASSERT n = 3, 'nicht alles wiederhergestellt';
  BEGIN
    PERFORM app.trash_page(pg_temp.id('home'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Startseite gelöscht';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Startseite eines Spaces%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK 12 Papierkorb: ganze Teilbäume, Rechte geprüft, Startseite geschützt';
END $$;
