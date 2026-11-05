-- =============================================================================
-- Tests 36–37: Titel aus Yjs und Positionen im Seitenbaum
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: anna dm entw grp_dev home lukas t1
-- Legt Testdaten an: viele
-- =============================================================================

-- 36. Titel kommt aus Yjs: Zu lange Titel und Texte werden gekürzt, statt das Speichern
--     abzulehnen (sonst gingen alle weiteren Änderungen verloren)
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE dm uuid := pg_temp.id('dm');
BEGIN
  PERFORM app.store_content(dm, '\x0c'::bytea, '[]'::jsonb, repeat('x', 2000001), repeat('T', 300), ARRAY[pg_temp.id('anna')]);
  ASSERT (SELECT length(title) FROM pages WHERE id = dm) = 255, 'zu langer Titel nicht gekürzt';
  ASSERT (SELECT length(plain_text) FROM page_contents WHERE page_id = dm) = 2000000, 'zu langer Text nicht gekürzt';
  PERFORM app.store_content(dm, '\x0d'::bytea, '[]'::jsonb, 'Text', NULL, ARRAY[pg_temp.id('anna')]);
  ASSERT (SELECT length(title) FROM pages WHERE id = dm) = 255, 'Titel ohne Angabe verändert';
  PERFORM app.store_content(dm, '\x0e'::bytea, '[]'::jsonb, 'Text', '  Datenmodell  ', ARRAY[pg_temp.id('anna')]);
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
