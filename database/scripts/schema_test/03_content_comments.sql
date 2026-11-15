-- =============================================================================
-- Tests 13–14: Inhalt, Versionen und Kommentare
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: dm lukas max peter sophie t1
-- Legt Testdaten an: c1 c1r
-- =============================================================================

-- 13. Inhalt und Versionen: nur der Collab-Server speichert, Autoren pro Version
DO $$
BEGIN
  PERFORM app.store_ydoc(pg_temp.id('dm'), '\x01'::bytea, 'x', ARRAY[pg_temp.id('peter')]);
  RAISE EXCEPTION 'FEHLER: App speichert Yjs-Inhalt';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
SELECT pg_temp.store_all(pg_temp.id('dm'), '\x0a'::bytea, '[]'::jsonb, 'Tabellen und Schlüssel', 'Datenmodell', ARRAY[pg_temp.id('lukas')]);
SELECT pg_temp.store_all(pg_temp.id('dm'), '\x0b'::bytea, '[]'::jsonb, 'Tabellen, Schlüssel, RLS', 'Datenmodell v2', ARRAY[pg_temp.id('sophie')]);
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
