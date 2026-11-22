-- =============================================================================
-- Test 56: Seitenbaum ebenenweise (app.tree_level) und wer einen Space verwalten darf
-- (app.can_manage_space); ROADMAP M2, ARCHITECTURE_REVIEW.md A-01
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: elena eva lukas max peter sophie t1 t2 ws1
-- Legt Testdaten an: tree tree_home tree_a tree_a1 tree_d tree_h tree_h1 tree_r tree_r2
--                    tree_x tree_y tree_z tree_luk
-- =============================================================================

-- Breitensuche über tree_level ab der obersten Ebene, als angemeldete Person: jede Seite mit
-- der Seite, unter der sie steht (NULL = oben), Rolle, has_children und der Zahl der Seiten
-- in der Ebene darunter
CREATE FUNCTION pg_temp.tree_walk(p_space uuid)
RETURNS TABLE (page uuid, shown_under uuid, page_role text, has_kids boolean, n_kids integer)
LANGUAGE plpgsql AS $$
DECLARE
  queue uuid[] := ARRAY[NULL::uuid];
  i     integer := 1;
  cur   uuid;
  rec   record;
BEGIN
  WHILE i <= cardinality(queue) LOOP
    cur := queue[i];
    i := i + 1;
    FOR rec IN SELECT * FROM app.tree_level(p_space, cur) LOOP
      page := rec.id;
      shown_under := cur;
      page_role := rec.role;
      has_kids := rec.has_children;
      n_kids := (SELECT count(*) FROM app.tree_level(p_space, rec.id));
      RETURN NEXT;
      queue := queue || rec.id;
    END LOOP;
  END LOOP;
END $$;

-- Erwartung aus page_rank (über die Leseregel auf pages): jede sichtbare Seite, darunter die
-- nächste sichtbare Vorfahrin wie in der Brotkrume, Rolle aus page_role
CREATE FUNCTION pg_temp.tree_expected(p_space uuid)
RETURNS TABLE (page uuid, shown_under uuid, page_role text)
LANGUAGE sql AS $$
  SELECT p.id,
         (SELECT a.id FROM pages a WHERE a.space_id = p.space_id AND a.path @> p.path AND a.id <> p.id
          ORDER BY nlevel(a.path) DESC LIMIT 1),
         app.page_role(p.id)
  FROM pages p WHERE p.space_id = p_space AND p.deleted_at IS NULL
$$;

-- Für eine Person und einen Space: Baum aus Ebenen = Erwartung, jede Seite genau einmal,
-- has_children genau dann, wenn die Ebene darunter etwas enthält
CREATE FUNCTION pg_temp.tree_check(p_space uuid, p_who text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_diff text;
BEGIN
  CREATE TEMP TABLE walk ON COMMIT DROP AS SELECT * FROM pg_temp.tree_walk(p_space);
  ASSERT (SELECT count(*) FROM walk) = (SELECT count(DISTINCT page) FROM walk),
    format('%s: Seite mehrfach im Baum', p_who);
  SELECT string_agg(format('%s unter %s als %s', page, shown_under, page_role), '; ') INTO v_diff
  FROM ((SELECT page, shown_under, page_role FROM walk EXCEPT SELECT * FROM pg_temp.tree_expected(p_space))
        UNION ALL
        (SELECT * FROM pg_temp.tree_expected(p_space) EXCEPT SELECT page, shown_under, page_role FROM walk)) d;
  ASSERT v_diff IS NULL, format('%s: Baum aus Ebenen weicht von page_rank ab: %s', p_who, v_diff);
  ASSERT NOT EXISTS (SELECT 1 FROM walk WHERE has_kids <> (n_kids > 0)),
    format('%s: has_children stimmt nicht', p_who);
  DROP TABLE walk;
END $$;

-- 56. Seitenbaum ebenenweise: dieselben Seiten und Rollen wie page_rank, jede Seite genau
--     einmal unter ihrer nächsten sichtbaren Vorfahrin; unsichtbare Elternseite, fremder
--     Mandant, Papierkorb und archivierter Space; wer einen Space verwalten darf
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE
  peter uuid := pg_temp.id('peter');
  s uuid; home uuid; a uuid; a1 uuid; d uuid; t uuid; h uuid; h1 uuid; r uuid; r2 uuid;
  x uuid; y uuid; z uuid;
BEGIN
  -- Alle im Workspace lesen (Standard), Peter ist Admin
  s := app.create_space(pg_temp.id('ws1'), 'TREE', 'Baum', peter);
  home := (SELECT home_page_id FROM spaces WHERE id = s);
  a  := app.create_page(s, home, 'A', peter);
  a1 := app.create_page(s, a, 'A1', peter);
  t  := app.create_page(s, a1, 'Im Papierkorb', peter);
  PERFORM app.trash_page(t, peter);
  -- D tief unten nur für Peter und den Gast Elena
  d  := app.create_page(s, a1, 'D für Elena', peter);
  PERFORM app.set_page_inheritance(d, false, peter);
  PERFORM app.set_grant(NULL, d, 'workspace', NULL, NULL, NULL, peter);
  PERFORM app.set_grant(NULL, d, 'user', pg_temp.id('elena'), NULL, 'viewer', peter);
  -- H nur für Peter und Lukas; darunter R (Max bearbeitet) und, unter dem erbenden H1, R2
  h  := app.create_page(s, home, 'H', peter);
  PERFORM app.set_page_inheritance(h, false, peter);
  PERFORM app.set_grant(NULL, h, 'workspace', NULL, NULL, NULL, peter);
  PERFORM app.set_grant(NULL, h, 'user', pg_temp.id('lukas'), NULL, 'viewer', peter);
  r  := app.create_page(s, h, 'R', peter);
  PERFORM app.set_page_inheritance(r, false, peter);
  PERFORM app.set_grant(NULL, r, 'user', pg_temp.id('max'), NULL, 'editor', peter);
  h1 := app.create_page(s, h, 'H1', peter);
  r2 := app.create_page(s, h1, 'R2', peter);
  PERFORM app.set_page_inheritance(r2, false, peter);
  PERFORM app.set_grant(NULL, r2, 'user', pg_temp.id('max'), NULL, 'viewer', peter);
  -- X für alle, darunter Y nur für Peter, darunter Z für Lukas (Sophie ist seit Test 21 nicht mehr Mitglied)
  x  := app.create_page(s, home, 'X', peter);
  PERFORM app.set_page_inheritance(x, false, peter);
  y  := app.create_page(s, x, 'Y', peter);
  PERFORM app.set_page_inheritance(y, false, peter);
  PERFORM app.set_grant(NULL, y, 'workspace', NULL, NULL, NULL, peter);
  z  := app.create_page(s, y, 'Z', peter);
  PERFORM app.set_page_inheritance(z, false, peter);
  PERFORM app.set_grant(NULL, z, 'user', pg_temp.id('lukas'), NULL, 'viewer', peter);
  INSERT INTO ids VALUES ('tree', s), ('tree_home', home), ('tree_a', a), ('tree_a1', a1), ('tree_d', d),
    ('tree_h', h), ('tree_h1', h1), ('tree_r', r), ('tree_r2', r2), ('tree_x', x), ('tree_y', y), ('tree_z', z);
END $$;

-- Allgemein: für jede Person und jeden Space, den sie sieht (auch die aus früheren Tests)
DO $$
DECLARE v_who text; v_space record;
BEGIN
  FOREACH v_who IN ARRAY ARRAY['peter', 'lukas', 'max', 'sophie', 'elena'] LOOP
    PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id(v_who));
    FOR v_space IN SELECT id, key FROM spaces LOOP
      PERFORM pg_temp.tree_check(v_space.id, v_who || ' in ' || v_space.key);
    END LOOP;
  END LOOP;
END $$;

-- Einzelfälle, damit die allgemeine Prüfung nicht leer durchläuft
DO $$
DECLARE s uuid := pg_temp.id('tree');
BEGIN
  -- Max: R und R2 stehen unter der Startseite, H fehlt; R zum Bearbeiten
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
  ASSERT (SELECT array_agg(title ORDER BY position, id) FROM app.tree_level(s, pg_temp.id('tree_home')))
         = ARRAY['A', 'R', 'R2', 'X'], 'Max: Ebene unter der Startseite falsch';
  ASSERT (SELECT role FROM app.tree_level(s, pg_temp.id('tree_home')) WHERE id = pg_temp.id('tree_r')) = 'editor',
    'Max: Rolle auf R falsch';
  ASSERT NOT EXISTS (SELECT 1 FROM app.tree_level(s, pg_temp.id('tree_h'))), 'Max: Ebene unter dem unsichtbaren H';
  ASSERT NOT EXISTS (SELECT 1 FROM app.tree_level(s, pg_temp.id('tree_h1'))), 'Max: Ebene unter dem unsichtbaren H1';
  -- unter A1 liegen nur D (unsichtbar) und eine Seite im Papierkorb
  ASSERT NOT (SELECT has_children FROM app.tree_level(s, pg_temp.id('tree_a')) WHERE id = pg_temp.id('tree_a1')),
    'Max: A1 hat sichtbare Kinder';
  -- Lukas sieht H mit R und H1 (R hat die Rechte von H übernommen), darunter R2
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
  ASSERT (SELECT array_agg(title ORDER BY position, id) FROM app.tree_level(s, pg_temp.id('tree_h'))) = ARRAY['R', 'H1'],
    'Lukas: Ebene unter H falsch';
  ASSERT (SELECT array_agg(title) FROM app.tree_level(s, pg_temp.id('tree_h1'))) = ARRAY['R2'],
    'Lukas: R2 fehlt unter H1';
  -- Lukas: Z steht unter X
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
  ASSERT (SELECT array_agg(title) FROM app.tree_level(s, pg_temp.id('tree_x'))) = ARRAY['Z'],
    'Lukas: Z steht nicht unter X';
  -- Elena (Gast, kein Rang auf dem Space): nur D, ganz oben
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena'));
  ASSERT (SELECT array_agg(title) FROM app.tree_level(s, NULL)) = ARRAY['D für Elena'], 'Elena: oberste Ebene falsch';
  ASSERT NOT EXISTS (SELECT 1 FROM app.tree_level(s, pg_temp.id('tree_home'))), 'Elena: Ebene unter der Startseite';
  -- Peter: Papierkorb fehlt, D unter A1
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
  ASSERT (SELECT array_agg(title) FROM app.tree_level(s, pg_temp.id('tree_a1'))) = ARRAY['D für Elena'],
    'Peter: Ebene unter A1 falsch (Papierkorb?)';
  -- anderer Mandant, ohne Person: nichts
  PERFORM pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
  ASSERT NOT EXISTS (SELECT 1 FROM app.tree_level(s, NULL)), 'fremder Mandant sieht den Baum';
  PERFORM pg_temp.ctx(pg_temp.id('t1'), NULL);
  ASSERT NOT EXISTS (SELECT 1 FROM app.tree_level(s, NULL)), 'ohne Person ein Baum';
END $$;

-- Verwalten: Space-Admin und Organisations-Admin ja, Leser nein; im archivierten Space
-- höchstens viewer im Baum, verwalten weiter möglich
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE luk uuid;
BEGIN
  luk := app.create_space(pg_temp.id('ws1'), 'LUKT', 'Lukas allein', pg_temp.id('lukas'), NULL);
  INSERT INTO ids VALUES ('tree_luk', luk);
  ASSERT app.can_manage_space(luk), 'Lukas verwaltet seinen Space nicht';
  ASSERT NOT app.can_manage_space(pg_temp.id('tree')), 'Lukas (Leser) verwaltet TREE';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE s uuid := pg_temp.id('tree');
BEGIN
  ASSERT app.can_manage_space(pg_temp.id('tree_luk')), 'Organisations-Admin verwaltet LUKT nicht';
  PERFORM app.archive_space(s, true, pg_temp.id('peter'));
  ASSERT app.space_role(s) = 'viewer', 'archivierter Space nicht nur lesbar';
  ASSERT app.can_manage_space(s), 'Admin verwaltet den archivierten Space nicht mehr';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_temp.tree_walk(s) WHERE page_role <> 'viewer'),
    'archivierter Space: Baum mit mehr als viewer';
  PERFORM pg_temp.tree_check(s, 'peter im archivierten TREE');
  PERFORM app.archive_space(s, false, pg_temp.id('peter'));
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT NOT app.can_manage_space(pg_temp.id('tree_luk')), 'Max verwaltet LUKT';
  BEGIN
    PERFORM app.archive_space(pg_temp.id('tree'), true, pg_temp.id('max'));
    RAISE EXCEPTION 'FEHLER: Leser archiviert einen Space';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 56 Seitenbaum ebenenweise wie page_rank, Space verwalten';
END $$;
