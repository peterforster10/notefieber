-- =============================================================================
-- Test 51: Einladung annehmen mit einem Login, das schon zu einer Person gehört
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: peter t1 ws_aussen
-- Legt Testdaten an: (keine)
-- =============================================================================

-- 51. Das Login zählt vor der E-Mail: Gehört es schon zu einer Person, wird genau diese
--     Mitglied, auch wenn die Einladung an eine andere Adresse ging (z. B. nach einer
--     Änderung der E-Mail im Login-Dienst; die API prüft vorher die bestätigte Adresse).
--     Vorher scheiterte das an der Eindeutigkeit von (tenant_id, idp_subject)
--     (REVIEW.md, R-04). Deaktivierte Personen kommen auch so nicht hinein.
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  INSERT INTO ids VALUES
    ('mia',  pg_temp.new_user(app.current_tenant(), 'mia@alpenwerk.example', 'Mia', 'sub-mia')),
    ('olaf', pg_temp.new_user(app.current_tenant(), 'olaf@alpenwerk.example', 'Olaf', 'sub-olaf')),
    ('ohne', pg_temp.new_user(app.current_tenant(), 'mia.zweit@alpenwerk.example', 'Ohne Login'));
  PERFORM app.set_user_active(pg_temp.id('olaf'), false, pg_temp.id('peter'));
  INSERT INTO invites (tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at)
  VALUES (app.current_tenant(), pg_temp.id('ws_aussen'), 'mia.neu@alpenwerk.example', 'member', 'inv-mia-neu', pg_temp.id('peter'), now() + interval '1 day'),
         (app.current_tenant(), pg_temp.id('ws_aussen'), 'mia.zweit@alpenwerk.example', 'member', 'inv-mia-zweit', pg_temp.id('peter'), now() + interval '1 day'),
         (app.current_tenant(), pg_temp.id('ws_aussen'), 'olaf.neu@alpenwerk.example', 'member', 'inv-olaf', pg_temp.id('peter'), now() + interval '1 day');
END $$;

-- Annehmen vor der Anmeldung (keine Person im Kontext); was daraus wurde, prüft danach Peter
-- (ohne Person sieht wiki_app keine Personen, Test 52)
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
CREATE TEMP TABLE personen_vorher AS SELECT count(*) AS n FROM users;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE u uuid;
BEGIN
  -- Einladung an eine neue Adresse: Mia selbst wird Mitglied, keine zweite Person
  u := app.accept_invite('inv-mia-neu', 'Mia', 'sub-mia');
  ASSERT u = pg_temp.id('mia'), 'Login nicht der bestehenden Person zugeordnet';
  -- Die Adresse gehört einer Person ohne Login: Das Login gewinnt, die andere bleibt unberührt
  u := app.accept_invite('inv-mia-zweit', 'Mia', 'sub-mia');
  ASSERT u = pg_temp.id('mia'), 'Person ohne Login statt der mit dem Login genommen';

  BEGIN
    PERFORM app.accept_invite('inv-olaf', 'Olaf', 'sub-olaf');
    RAISE EXCEPTION 'FEHLER: deaktivierte Person über eine Einladung an eine andere Adresse aufgenommen';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  ASSERT EXISTS (SELECT 1 FROM app.find_invite('inv-olaf')), 'abgelehnte Einladung verbraucht';
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = pg_temp.id('ws_aussen') AND user_id = pg_temp.id('mia')),
    'keine Mitgliedschaft';
  ASSERT (SELECT idp_subject FROM users WHERE id = pg_temp.id('ohne')) IS NULL, 'fremde Person mit dem Login verknüpft';
  ASSERT EXISTS (SELECT 1 FROM users WHERE id = pg_temp.id('ohne')), 'Person ohne Login nicht sichtbar';
  ASSERT (SELECT count(*) FROM users) = (SELECT n FROM personen_vorher), 'zusätzliche Person angelegt';
  RAISE NOTICE 'OK 51 Einladung annehmen: Login vor E-Mail, keine zweite Person, Deaktivierte bleiben draußen';
END $$;
