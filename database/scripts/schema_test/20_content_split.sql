-- =============================================================================
-- Test 55: Inhalt in zwei Schritten (ARCHITECTURE_REVIEW.md, A-04): Yjs-Zustand und Titel
-- vom Collab-Server (store_ydoc), abgeleiteter Inhalt vom Worker (store_derived)
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: entw eva home lukas peter t1 t2 ws2
-- Legt Testdaten an: split split_t2 split_json
-- =============================================================================

-- 55. Collab-Server speichert nur Yjs und Titel, ohne Ereignis, und markiert den abgeleiteten
--     Inhalt als veraltet; der Worker leitet ab, wenn die Seite ruht, aber nur für den Stand,
--     den er gelesen hat; Seiten nur mit BlockNote-JSON bekommen ihren ersten Yjs-Zustand
--     genau einmal; Versionen veralteter Seiten haben kein BlockNote-JSON; die App kann
--     keine der Funktionen aufrufen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE p uuid; j uuid; v_sql text;
BEGIN
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Zweistufig', pg_temp.id('peter'));
  j := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Nur JSON', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('split', p), ('split_json', j);
  FOREACH v_sql IN ARRAY ARRAY[
    format('SELECT app.store_ydoc(%L, ''\x01'', ''t'', ''{}'')', p),
    format('SELECT app.store_derived(%L, now(), ''[]'', ''t'')', p),
    format('SELECT app.store_initial_ydoc(%L, ''\x01'')', p),
    'SELECT * FROM app.pages_to_derive(''0 seconds'', 10)'
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FEHLER: App ruft Funktion des Collab-Servers bzw. Workers auf: %', v_sql;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
DECLARE s uuid; p uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws2'), 'NORD', 'Nordlicht', pg_temp.id('eva'));
  p := app.create_page(s, (SELECT home_page_id FROM spaces WHERE id = s), 'Andere Firma', pg_temp.id('eva'));
  INSERT INTO ids VALUES ('split_t2', p);
END $$;

RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t2'), NULL);
SELECT app.store_ydoc(pg_temp.id('split_t2'), '\x02'::bytea, 'Andere Firma', ARRAY[pg_temp.id('eva')]);

SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE
  p      uuid := pg_temp.id('split');
  j      uuid := pg_temp.id('split_json');
  doc    jsonb := '[{"id": "b1", "type": "paragraph", "props": {},
                     "content": [{"type": "text", "text": "Zweistufig gespeichert", "styles": {}}], "children": []}]';
  seen   timestamptz;
  events int := (SELECT count(*) FROM outbox);
  v      int;
BEGIN
  -- Collab-Server: Yjs und Titel, kein Ereignis, abgeleiteter Inhalt veraltet
  PERFORM app.store_ydoc(p, '\x03'::bytea, '  Zweistufig neu  ', ARRAY[pg_temp.id('lukas')]);
  ASSERT (SELECT ydoc = '\x03'::bytea AND derived_stale AND content_json = '[]'::jsonb
          FROM page_contents WHERE page_id = p), 'Yjs nicht gespeichert oder nicht als veraltet markiert';
  ASSERT (SELECT title = 'Zweistufig neu' AND updated_by = pg_temp.id('lukas') FROM pages WHERE id = p),
    'Titel oder Bearbeitende nicht übernommen';
  ASSERT (SELECT count(*) FROM outbox) = events, 'Speichern des Yjs-Zustands legt ein Ereignis an';

  -- Ruhezeit: frisch gespeichert ist noch keine Arbeit, ohne Ruhezeit schon, aus beiden Mandanten
  ASSERT NOT EXISTS (SELECT 1 FROM app.pages_to_derive('1 hour', 100) WHERE page_id = p),
    'Seite vor Ablauf der Ruhezeit abgeleitet';
  ASSERT (SELECT count(*) FROM app.pages_to_derive('0 seconds', 100)
          WHERE page_id IN (p, pg_temp.id('split_t2')) AND NOT needs_ydoc) = 2,
    'veraltete Seiten (auch aus dem anderen Mandanten) fehlen';

  -- Worker: abgeleitet aus einem älteren Stand passt nicht mehr
  seen := (SELECT updated_at FROM page_contents WHERE page_id = p);
  PERFORM app.store_ydoc(p, '\x04'::bytea, 'Zweistufig neu', ARRAY[pg_temp.id('peter')]);
  ASSERT NOT app.store_derived(p, seen, doc, 'Zweistufig gespeichert'),
    'abgeleiteter Inhalt eines älteren Stands gespeichert';
  ASSERT (SELECT derived_stale AND content_json = '[]'::jsonb FROM page_contents WHERE page_id = p),
    'Seite nach veraltetem Ableiten nicht mehr veraltet';
  ASSERT (SELECT count(*) FROM outbox) = events, 'veraltetes Ableiten legt ein Ereignis an';

  -- Version einer veralteten Seite: Yjs ja, BlockNote-JSON fehlt (NULL)
  v := app.create_version(p, 'auto');
  ASSERT (SELECT content_json IS NULL AND ydoc = '\x04'::bytea FROM page_versions WHERE page_id = p AND version = v),
    'Version einer veralteten Seite mit BlockNote-JSON';

  -- Worker: aktueller Stand, ein page.updated, Suchindex, nicht mehr veraltet; zweimal geht nicht
  seen := (SELECT updated_at FROM page_contents WHERE page_id = p);
  ASSERT app.store_derived(p, seen, doc, 'Zweistufig gespeichert'), 'abgeleiteter Inhalt nicht gespeichert';
  ASSERT (SELECT NOT derived_stale AND content_json = doc AND plain_text = 'Zweistufig gespeichert'
          FROM page_contents WHERE page_id = p), 'abgeleiteter Inhalt falsch';
  ASSERT (SELECT count(*) FROM outbox WHERE event_type = 'page.updated' AND payload->>'id' = p::text
          AND payload->>'title' = 'Zweistufig neu') = 1, 'page.updated fehlt';
  ASSERT (SELECT tsv @@ to_tsquery('german', 'gespeichert') AND tsv @@ to_tsquery('german', 'zweistufig')
          FROM page_search WHERE page_id = p), 'Suchindex nicht gepflegt';
  ASSERT NOT app.store_derived(p, seen, doc, 'Zweistufig gespeichert'), 'zweimal abgeleitet';
  ASSERT (SELECT count(*) FROM outbox WHERE event_type = 'page.updated' AND payload->>'id' = p::text) = 1,
    'page.updated doppelt';
  ASSERT NOT EXISTS (SELECT 1 FROM app.pages_to_derive('0 seconds', 100) WHERE page_id = p),
    'abgeleitete Seite noch als Arbeit gemeldet';
  v := app.create_version(p, 'auto');
  ASSERT (SELECT content_json = doc FROM page_versions WHERE page_id = p AND version = v),
    'Version einer aktuellen Seite ohne BlockNote-JSON';

  -- Seite nur mit BlockNote-JSON (Testdaten, Import): erster Yjs-Zustand genau einmal
  UPDATE page_contents SET content_json = doc, plain_text = 'Zweistufig gespeichert' WHERE page_id = j;
  ASSERT EXISTS (SELECT 1 FROM app.pages_to_derive('1 hour', 100) WHERE page_id = j AND needs_ydoc),
    'Seite ohne Yjs-Zustand nicht als Arbeit gemeldet';
  ASSERT app.store_initial_ydoc(j, '\x05'::bytea), 'erster Yjs-Zustand nicht gespeichert';
  ASSERT NOT app.store_initial_ydoc(j, '\x06'::bytea), 'vorhandener Yjs-Zustand überschrieben';
  ASSERT (SELECT ydoc = '\x05'::bytea AND NOT derived_stale AND content_json = doc
          FROM page_contents WHERE page_id = j), 'erster Yjs-Zustand falsch';
  ASSERT NOT EXISTS (SELECT 1 FROM app.pages_to_derive('0 seconds', 100) WHERE page_id = j),
    'Seite mit Yjs-Zustand noch als Arbeit gemeldet';
END $$;

-- Papierkorb: Yjs speichern abgelehnt, nicht mehr als Arbeit gemeldet, nicht abgeleitet
RESET ROLE;
SET ROLE wiki_app;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.trash_page(pg_temp.id('split_json'), pg_temp.id('peter'));
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE j uuid := pg_temp.id('split_json'); seen timestamptz;
BEGIN
  UPDATE page_contents SET derived_stale = true WHERE page_id = j;
  seen := (SELECT updated_at FROM page_contents WHERE page_id = j);
  BEGIN
    PERFORM app.store_ydoc(j, '\x07'::bytea, 'Nur JSON', ARRAY[pg_temp.id('peter')]);
    RAISE EXCEPTION 'FEHLER: Yjs einer Seite im Papierkorb gespeichert';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FEHLER:%' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM app.pages_to_derive('0 seconds', 100) WHERE page_id = j),
    'Seite im Papierkorb als Arbeit gemeldet';
  ASSERT NOT app.store_derived(j, seen, '[]', ''), 'Seite im Papierkorb abgeleitet';
  RAISE NOTICE 'OK 55 Inhalt in zwei Schritten: Yjs ohne Ereignis, abgeleitet nur für den gelesenen Stand';
END $$;
RESET ROLE;
SET ROLE wiki_app;
