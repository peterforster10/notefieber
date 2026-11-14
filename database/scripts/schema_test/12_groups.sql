-- =============================================================================
-- Tests 45–46: Gruppen im Wiki (Quelle local), Schutz des letzten Admins, Quellen
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: entw grp_dev home lukas max peter t1
-- Legt Testdaten an: grp_pers pers_seite
-- =============================================================================

-- 45. Gruppen im Wiki: nur Organisations-Admins legen sie an und pflegen Mitglieder,
--     die Mitglieder bekommen die Rechte der Gruppe, Änderungen erzeugen Events
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  BEGIN
    PERFORM app.create_group('Von Max', pg_temp.id('max'));
    RAISE EXCEPTION 'FEHLER: Mitglied ohne Organisations-Admin legt Gruppe an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO groups (tenant_id, name) VALUES (app.current_tenant(), 'Direkt');
    RAISE EXCEPTION 'FEHLER: App legt Gruppe direkt an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE g uuid; p uuid; r record;
BEGIN
  g := app.create_group('  Personal ', pg_temp.id('peter'));
  ASSERT (SELECT name = 'Personal' AND source = 'local' AND external_id IS NULL FROM groups WHERE id = g),
    'Gruppe falsch angelegt';
  -- Seite nur für Peter: Vererbung kappen, alle kopierten Rechte außer Peters entfernen
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Personalakten', pg_temp.id('peter'));
  PERFORM app.set_page_inheritance(p, false, pg_temp.id('peter'));
  FOR r IN SELECT subject_type, user_id, group_id FROM grants
           WHERE page_id = p AND NOT (subject_type = 'user' AND user_id = pg_temp.id('peter')) LOOP
    PERFORM app.set_grant(NULL, p, r.subject_type, r.user_id, r.group_id, NULL, pg_temp.id('peter'));
  END LOOP;
  PERFORM app.set_grant(NULL, p, 'group', NULL, g, 'admin', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('grp_pers', g), ('pers_seite', p);
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.page_rank(pg_temp.id('pers_seite')) = 0, 'Lukas sieht die Seite ohne Gruppe';
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  PERFORM app.add_group_member(pg_temp.id('grp_pers'), pg_temp.id('lukas'), pg_temp.id('peter'));
  PERFORM app.add_group_member(pg_temp.id('grp_pers'), pg_temp.id('lukas'), pg_temp.id('peter'));   -- doppelt: nichts
  PERFORM app.rename_group(pg_temp.id('grp_pers'), 'Personalabteilung', pg_temp.id('peter'));
  ASSERT (SELECT name FROM groups WHERE id = pg_temp.id('grp_pers')) = 'Personalabteilung', 'Umbenennen wirkt nicht';
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.page_rank(pg_temp.id('pers_seite')) = 4, 'Gruppenrecht wirkt nicht';
END $$;
-- Der Abgleich mit dem Login-Dienst (nur wiki_worker, siehe Test 7) berührt nur Gruppen
-- aus dem Login-Dienst
RESET ROLE;
SET ROLE wiki_worker;
SELECT app.sync_user_groups(pg_temp.id('lukas'), '{}', '{}');
RESET ROLE;
SET ROLE wiki_app;
DO $$
BEGIN
  ASSERT app.page_rank(pg_temp.id('pers_seite')) = 4, 'Login-Abgleich entfernt Wiki-Gruppe';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT app.sync_user_groups(pg_temp.id('lukas'), ARRAY['grp-dev'], ARRAY['Entwicklung']);   -- wie vorher
RESET ROLE;
SET ROLE wiki_app;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  PERFORM app.add_group_member(pg_temp.id('grp_pers'), pg_temp.id('max'), pg_temp.id('max'));
  RAISE EXCEPTION 'FEHLER: Mitglied ohne Organisations-Admin nimmt sich in Gruppe auf';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM outbox
          WHERE event_type = 'member.changed' AND subject = 't.' || pg_temp.id('t1') || '.wiki.s.' || pg_temp.id('entw')
            AND payload ->> 'group' = pg_temp.id('grp_pers')::text
            AND payload ->> 'user' = pg_temp.id('lukas')::text) = 1,
    'member.changed fehlt oder doppelt';
  RAISE NOTICE 'OK 45 Gruppen im Wiki: nur Organisations-Admins, Rechte über die Gruppe, Events';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 46. Letzter Admin über eine Gruppe bleibt geschützt; Gruppen aus dem Login-Dienst
--     pflegt nur ihre Quelle
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE g uuid := pg_temp.id('grp_pers'); p uuid := pg_temp.id('pers_seite');
BEGIN
  -- Peter gibt das eigene Admin-Recht ab, die Gruppe (mit Lukas) bleibt Admin
  PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));
  BEGIN
    PERFORM app.remove_group_member(g, pg_temp.id('lukas'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letztes Mitglied der Admin-Gruppe entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.delete_group(g, pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Gruppe gelöscht, die letzter Admin ist';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  -- Organisations-Admin setzt sich wieder als Admin, dann geht beides
  PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('peter'), NULL, 'admin', pg_temp.id('peter'));
  PERFORM app.remove_group_member(g, pg_temp.id('lukas'), pg_temp.id('peter'));
  PERFORM app.delete_group(g, pg_temp.id('peter'));
  ASSERT NOT EXISTS (SELECT 1 FROM groups WHERE id = g), 'Gruppe nicht gelöscht';
  ASSERT NOT EXISTS (SELECT 1 FROM grants WHERE group_id = g), 'Grants der Gruppe bleiben';

  -- grp_dev kommt aus dem Login-Token (Test 7): Name und Mitglieder nicht im Wiki änderbar
  ASSERT (SELECT source FROM groups WHERE id = pg_temp.id('grp_dev')) = 'idp', 'grp_dev nicht aus dem Login-Dienst';
  BEGIN
    PERFORM app.add_group_member(pg_temp.id('grp_dev'), pg_temp.id('max'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Mitglied in Gruppe aus dem Login-Dienst aufgenommen';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM app.rename_group(pg_temp.id('grp_dev'), 'Umbenannt', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Gruppe aus dem Login-Dienst umbenannt';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK 46 Letzter Admin über Gruppe geschützt, Gruppen aus dem Login-Dienst nicht im Wiki änderbar';
END $$;
