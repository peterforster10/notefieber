-- =============================================================================
-- Test 52: Wer sieht welche Personen, Workspaces und Gruppen
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: elena lukas mia peter t1 ws1 ws_aussen yann zora
-- Legt Testdaten an: (keine)
-- =============================================================================

-- 52. Personen, Workspaces und Mitgliedschaften sieht man nur aus Workspaces, in denen man
--     selbst Mitglied ist (nicht nur Gast); Gruppen nur, wer irgendwo Mitglied ist. Gäste
--     sehen keine Personenliste (E18), Organisations-Admins alles. Vor der Anmeldung (ohne
--     Person im Kontext) ist niemand sichtbar; die API findet die Person über
--     app.resolve_login (REVIEW.md, R-03).
--     Stand: Lukas, Peter und Elena (Gast) sind in ws1, Zora und Mia nur in der Außenstelle,
--     Yann in keinem Workspace mehr.

-- Gast: nur sich selbst, den eigenen Workspace und die eigene Mitgliedschaft
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena'));
DO $$
BEGIN
  ASSERT (SELECT array_agg(id) FROM users) = ARRAY[pg_temp.id('elena')], 'Gast sieht andere Personen';
  ASSERT (SELECT array_agg(id) FROM workspaces) = ARRAY[pg_temp.id('ws1')], 'Gast sieht fremde Workspaces';
  ASSERT NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id <> pg_temp.id('elena')),
    'Gast sieht Mitgliedschaften anderer';
  ASSERT NOT EXISTS (SELECT 1 FROM groups), 'Gast sieht Gruppen';
  ASSERT NOT EXISTS (SELECT 1 FROM group_members), 'Gast sieht Gruppenmitglieder';
END $$;

-- Mitglied: Personen und Mitgliedschaften aus ws1, nichts aus der Außenstelle
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM users WHERE id = pg_temp.id('peter')), 'Mitglied sieht Peter nicht';
  ASSERT EXISTS (SELECT 1 FROM users WHERE id = pg_temp.id('elena')), 'Mitglied sieht den Gast im eigenen Workspace nicht';
  ASSERT NOT EXISTS (SELECT 1 FROM users WHERE id IN (pg_temp.id('zora'), pg_temp.id('mia'))),
    'Mitglied sieht Personen aus einem fremden Workspace';
  ASSERT NOT EXISTS (SELECT 1 FROM users WHERE id = pg_temp.id('yann')), 'Mitglied sieht Person ohne Workspace';
  ASSERT NOT EXISTS (SELECT 1 FROM workspaces WHERE id = pg_temp.id('ws_aussen')), 'Mitglied sieht fremden Workspace';
  ASSERT NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = pg_temp.id('ws_aussen')),
    'Mitglied sieht Mitgliedschaften eines fremden Workspaces';
  ASSERT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = pg_temp.id('elena')),
    'Mitglied sieht Mitgliedschaften im eigenen Workspace nicht';
  ASSERT EXISTS (SELECT 1 FROM groups), 'Mitglied sieht keine Gruppen';
END $$;

-- Organisations-Admin: alle
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM users WHERE id IN (pg_temp.id('zora'), pg_temp.id('mia'), pg_temp.id('yann'))) = 3,
    'Organisations-Admin sieht nicht alle Personen';
  ASSERT EXISTS (SELECT 1 FROM workspaces WHERE id = pg_temp.id('ws_aussen')), 'Organisations-Admin sieht nicht alle Workspaces';
END $$;

-- Vor der Anmeldung: niemand sichtbar, die Person zum Login findet app.resolve_login
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM users), 'ohne Person im Kontext sind Personen sichtbar';
  ASSERT (SELECT user_id FROM app.resolve_login('sub-mia')) = pg_temp.id('mia'), 'Login nicht gefunden';
  ASSERT (SELECT deactivated_at IS NOT NULL FROM app.resolve_login('sub-olaf')), 'Deaktivierung nicht gemeldet';
  ASSERT NOT EXISTS (SELECT 1 FROM app.resolve_login('sub-gibt-es-nicht')), 'unbekanntes Login gefunden';
  RAISE NOTICE 'OK 52 Personen, Workspaces und Gruppen nur aus gemeinsamen Workspaces, Gäste nur sich selbst';
END $$;
