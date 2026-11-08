-- =============================================================================
-- Test 44: BlockNote-JSON neben dem Yjs-Zustand (page_contents, page_versions)
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: entw home max peter t1
-- Legt Testdaten an: json_seite
-- =============================================================================

-- 44. BlockNote-JSON: leer bei neuen Seiten, mit jedem Speichern geschrieben, in Versionen
--     übernommen; zu groß oder kein BlockNote-Dokument ergibt NULL, ohne das Speichern abzulehnen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE p uuid;
BEGIN
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'JSON-Seite', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('json_seite', p);
  ASSERT (SELECT content_json FROM page_contents WHERE page_id = p) = '[]'::jsonb, 'neue Seite ohne leeres Dokument';
  BEGIN
    UPDATE page_contents SET content_json = '[]' WHERE page_id = p;
    RAISE EXCEPTION 'FEHLER: App schreibt BlockNote-JSON direkt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE
  p   uuid := pg_temp.id('json_seite');
  doc jsonb := '[{"id": "b1", "type": "heading", "props": {"level": 1},
                  "content": [{"type": "text", "text": "Ziele", "styles": {}}], "children": []}]';
  v   int;
BEGIN
  PERFORM app.store_content(p, '\x0f'::bytea, doc, 'Ziele', 'JSON-Seite', ARRAY[pg_temp.id('peter')]);
  ASSERT (SELECT content_json FROM page_contents WHERE page_id = p) = doc, 'JSON nicht gespeichert';
  v := app.create_version(p, 'auto');
  ASSERT (SELECT content_json FROM page_versions WHERE page_id = p AND version = v) = doc,
    'JSON nicht in die Version übernommen';

  -- Kein BlockNote-Dokument (kein Array): NULL, Yjs und Klartext trotzdem gespeichert
  PERFORM app.store_content(p, '\x10'::bytea, '{"kaputt": true}'::jsonb, 'Neu', 'JSON-Seite', ARRAY[pg_temp.id('peter')]);
  ASSERT (SELECT content_json IS NULL AND ydoc = '\x10'::bytea AND plain_text = 'Neu'
          FROM page_contents WHERE page_id = p), 'ungültiges JSON nicht als NULL gespeichert';

  -- Zu groß (über 20 MB): NULL, Yjs trotzdem gespeichert
  PERFORM app.store_content(p, '\x11'::bytea, jsonb_build_array(repeat('x', 21000000)), 'Groß', 'JSON-Seite',
                            ARRAY[pg_temp.id('peter')]);
  ASSERT (SELECT content_json IS NULL AND ydoc = '\x11'::bytea FROM page_contents WHERE page_id = p),
    'zu großes JSON nicht als NULL gespeichert';

  -- Auch direkt (Import, Worker) nur BlockNote-Dokumente
  BEGIN
    UPDATE page_contents SET content_json = '"text"' WHERE page_id = p;
    RAISE EXCEPTION 'FEHLER: kein Array als BlockNote-Dokument gespeichert';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- Leserecht wie beim übrigen Inhalt: Max liest die JSON-Fassung einer lesbaren Seite
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM page_versions WHERE page_id = pg_temp.id('json_seite') AND content_json IS NOT NULL) = 1,
    'Version mit JSON für Leser nicht lesbar';
  RAISE NOTICE 'OK 44 BlockNote-JSON: mit jedem Speichern, in Versionen, ungültig oder zu groß NULL';
END $$;
