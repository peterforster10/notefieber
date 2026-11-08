-- =============================================================================
-- Test 49: Einladung annehmen beim Login: Login verknüpfen, fremdes Login ablehnen
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: max peter t1 ws1
-- Legt Testdaten an: (keine)
-- =============================================================================

-- 49. Annehmen legt neue Personen mit Login an, verknüpft Personen ohne Login und lehnt ab,
--     wenn die E-Mail im Mandanten zu einem anderen Login gehört
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  -- Person ohne Login, wie sie create_tenant ohne idp_subject anlegt
  INSERT INTO users (tenant_id, email, display_name) VALUES (app.current_tenant(), 'ohne.login@alpenwerk.example', 'Ohne Login');
  INSERT INTO invites (tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at)
  VALUES (app.current_tenant(), pg_temp.id('ws1'), 'Ohne.Login@alpenwerk.example', 'member', 'inv-verknuepfen', pg_temp.id('peter'), now() + interval '1 day'),
         (app.current_tenant(), pg_temp.id('ws1'), 'ohne.login@alpenwerk.example', 'member', 'inv-fremd', pg_temp.id('peter'), now() + interval '1 day'),
         (app.current_tenant(), pg_temp.id('ws1'), 'gast@extern.example', 'guest', 'inv-gast', pg_temp.id('peter'), now() + interval '1 day'),
         (app.current_tenant(), pg_temp.id('ws1'), 'max@alpenwerk.example', 'admin', 'inv-max', pg_temp.id('peter'), now() + interval '1 day');
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE u uuid; g uuid; m uuid;
BEGIN
  u := app.accept_invite('inv-verknuepfen', 'Ohne Login', 'sub-ohne-login');
  ASSERT (SELECT idp_subject FROM users WHERE id = u) = 'sub-ohne-login', 'Login nicht verknüpft';
  ASSERT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = u), 'keine Mitgliedschaft';

  BEGIN
    PERFORM app.accept_invite('inv-fremd', 'Jemand anderes', 'sub-anderes-login');
    RAISE EXCEPTION 'FEHLER: Einladung mit fremdem Login angenommen';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT EXISTS (SELECT 1 FROM app.find_invite('inv-fremd')), 'abgelehnte Einladung verbraucht';

  g := app.accept_invite('inv-gast', 'Gast Extern', 'sub-gast');
  ASSERT (SELECT is_external AND idp_subject = 'sub-gast' FROM users WHERE id = g), 'Gast falsch angelegt';
  ASSERT (SELECT role FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = g) = 'guest', 'Gast nicht als Gast';

  -- Schon Mitglied mit eigenem Login: bleibt, wie es ist (Rolle aus der Einladung ändert nichts)
  m := app.accept_invite('inv-max', 'Max', (SELECT idp_subject FROM users WHERE id = pg_temp.id('max')));
  ASSERT m = pg_temp.id('max'), 'bestehende Person nicht erkannt';
  ASSERT (SELECT role FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = m) <> 'admin',
    'Einladung hebt bestehende Rolle an';
  RAISE NOTICE 'OK 49 Einladung annehmen: Login verknüpfen, fremdes Login abgelehnt, Gäste, bestehende Mitglieder';
END $$;
