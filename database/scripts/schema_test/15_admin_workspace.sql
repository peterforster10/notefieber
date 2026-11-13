-- =============================================================================
-- Test 50: Wirksamer Admin nur mit Mitgliedschaft im Workspace des Spaces
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: peter t1 ws1
-- Legt Testdaten an: ws_aussen yann zora
-- =============================================================================

-- 50. Gruppen gelten für den ganzen Mandanten, Zugriff gibt es aber nur mit Mitgliedschaft
--     im Workspace des Spaces. Ein Gruppenmitglied aus einem anderen Workspace hält einen
--     Space oder eine Seite mit eigenen Rechten deshalb nicht als Admin offen, und wer den
--     Workspace verlässt, darf nicht der letzte Admin über eine Gruppe gewesen sein
--     (REVIEW.md, R-01). Yann ist Mitglied in ws1, Zora nur in einer Außenstelle.
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE w uuid := uuidv7();
BEGIN
  INSERT INTO workspaces (id, tenant_id, slug, name) VALUES (w, app.current_tenant(), 'aussenstelle', 'Außenstelle');
  INSERT INTO invites (tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at)
  VALUES (app.current_tenant(), pg_temp.id('ws1'), 'yann@alpenwerk.example', 'member', 'inv-yann', pg_temp.id('peter'), now() + interval '1 day'),
         (app.current_tenant(), w, 'zora@alpenwerk.example', 'member', 'inv-zora', pg_temp.id('peter'), now() + interval '1 day');
  INSERT INTO ids VALUES ('ws_aussen', w);
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  INSERT INTO ids VALUES ('yann', app.accept_invite('inv-yann', 'Yann', 'sub-yann')),
                         ('zora', app.accept_invite('inv-zora', 'Zora', 'sub-zora'));
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE s uuid; h uuid; p uuid; g uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'ADMINWS', 'Admin im Workspace', pg_temp.id('peter'), NULL);
  SELECT home_page_id INTO h FROM spaces WHERE id = s;
  p := app.create_page(s, h, 'Eigene Rechte', pg_temp.id('peter'));
  PERFORM app.set_page_inheritance(p, false, pg_temp.id('peter'));

  g := app.create_group('Admins gemischt', pg_temp.id('peter'));
  PERFORM app.add_group_member(g, pg_temp.id('yann'), pg_temp.id('peter'));
  PERFORM app.add_group_member(g, pg_temp.id('zora'), pg_temp.id('peter'));
  PERFORM app.set_grant(s, NULL, 'group', NULL, g, 'admin', pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, p, 'group', NULL, g, 'admin', pg_temp.id('peter'));
  -- Peter gibt seine Admin-Rechte ab: Admin bleibt die Gruppe, wirksam nur über Yann
  PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));
  PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));

  BEGIN
    PERFORM app.remove_group_member(g, pg_temp.id('yann'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letztes Mitglied im Workspace aus der Admin-Gruppe entfernt (Zora zählt nicht)';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('yann'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letzter Admin über eine Gruppe aus dem Workspace entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;

  -- Mit einem weiteren wirksamen Admin geht es
  PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('peter'), NULL, 'admin', pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('peter'), NULL, 'admin', pg_temp.id('peter'));
  PERFORM app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('yann'), pg_temp.id('peter'));
  ASSERT NOT EXISTS (SELECT 1 FROM workspace_members
                     WHERE workspace_id = pg_temp.id('ws1') AND user_id = pg_temp.id('yann')), 'Yann noch Mitglied';

  -- Jetzt hat die Gruppe nur noch Zora (anderer Workspace): Peter ist der einzige wirksame Admin
  BEGIN
    PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Admin abgegeben, obwohl in der Admin-Gruppe nur jemand aus einem anderen Workspace ist';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Admin der Seite abgegeben, obwohl in der Admin-Gruppe nur jemand aus einem anderen Workspace ist';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 50 Wirksamer Admin nur mit Mitgliedschaft im Workspace, auch über Gruppen';
END $$;
