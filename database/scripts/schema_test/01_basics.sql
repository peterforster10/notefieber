-- =============================================================================
-- Tests 1–5: Grundlagen: Mandanten, Personen, Space, Seitenbaum
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Legt Testdaten an: anna arch dm elena entw eva home t1 t2 ws1 ws2 lukas max sophie
-- =============================================================================

-- 1. Zwei Mandanten, der zweite mit vorgegebener ID (wie aus TalkFieber übernommen)
DO $$
DECLARE t1 uuid; t2 uuid; shared uuid := '0193a000-0000-7000-8000-000000000002';
BEGIN
  t1 := app.create_tenant('alpenwerk', 'Alpenwerk', 'eu-central', 'anna@alpenwerk.example', 'Anna Huber');
  INSERT INTO ids SELECT 't1', t1;
  INSERT INTO ids SELECT 'anna', id FROM users WHERE email = 'anna@alpenwerk.example';
  INSERT INTO ids SELECT 'ws1', id FROM workspaces WHERE tenant_id = t1;
  t2 := app.create_tenant('andere-firma', 'Andere Firma', 'eu-central', 'eva@andere.example', 'Eva Fremd',
                          p_tenant_id => shared);
  ASSERT t2 = shared, 'vorgegebene Mandanten-ID nicht übernommen';
  INSERT INTO ids SELECT 't2', t2;
  INSERT INTO ids SELECT 'eva', id FROM users WHERE email = 'eva@andere.example';
  INSERT INTO ids SELECT 'ws2', id FROM workspaces WHERE tenant_id = t2;
  RAISE NOTICE 'OK  1 Mandanten angelegt, gemeinsame ID mit TalkFieber möglich';
END $$;

-- 2. Personen und Gast im Mandanten 1
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE u uuid; n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['lukas', 'max', 'sophie'] LOOP
    u := uuidv7();
    INSERT INTO users (id, tenant_id, email, display_name) VALUES (u, app.current_tenant(), n || '@alpenwerk.example', initcap(n));
    INSERT INTO ids VALUES (n, u);
    PERFORM app.add_workspace_member(pg_temp.id('ws1'), u, 'member', pg_temp.id('anna'));
  END LOOP;
  u := uuidv7();
  INSERT INTO users (id, tenant_id, email, display_name, is_external)
  VALUES (u, app.current_tenant(), 'elena@agentur-nord.example', 'Elena Novak', true);
  INSERT INTO ids VALUES ('elena', u);
  PERFORM app.add_workspace_member(pg_temp.id('ws1'), u, 'guest', pg_temp.id('anna'));
  RAISE NOTICE 'OK  2 Personen und Gast angelegt';
END $$;

-- 3. Space mit Startseite, Ersteller als Admin, Workspace lesend
DO $$
DECLARE s uuid; home uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'entw', 'Entwicklung', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('entw', s);
  SELECT home_page_id INTO home FROM spaces WHERE id = s;
  ASSERT home IS NOT NULL, 'Startseite fehlt';
  INSERT INTO ids VALUES ('home', home);
  ASSERT (SELECT key FROM spaces WHERE id = s) = 'ENTW', 'Key nicht normalisiert';
  ASSERT app.space_role(s) = 'admin', 'Ersteller ist kein Admin';
  ASSERT (SELECT count(*) FROM page_contents WHERE page_id = home) = 1, 'Inhalt der Startseite fehlt';
  RAISE NOTICE 'OK  3 Space mit Startseite, Ersteller ist Admin';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT app.space_role(pg_temp.id('entw')) = 'viewer', 'Workspace-Mitglied nicht lesend';
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('home')) = 1, 'Startseite unsichtbar';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM spaces) = 0, 'Gast sieht Space';
  ASSERT (SELECT count(*) FROM pages) = 0, 'Gast sieht Seiten';
  RAISE NOTICE 'OK  4 Workspace-Zugriff gilt für Mitglieder, nicht für Gäste';
END $$;

-- 5. Seitenbaum
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('anna'));
DO $$
DECLARE a uuid; d uuid;
BEGIN
  a := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Architektur', pg_temp.id('anna'));
  d := app.create_page(pg_temp.id('entw'), a, 'Datenmodell', pg_temp.id('anna'));
  INSERT INTO ids VALUES ('arch', a), ('dm', d);
  ASSERT (SELECT nlevel(path) FROM pages WHERE id = d) = 3, 'Pfad falsch';
  ASSERT (SELECT path FROM pages WHERE id = d) <@ (SELECT path FROM pages WHERE id = a), 'Teilbaum falsch';
  RAISE NOTICE 'OK  5 Seitenbaum mit Pfaden';
END $$;
