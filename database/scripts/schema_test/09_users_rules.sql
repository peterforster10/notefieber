-- =============================================================================
-- Tests 38–42: Personen, Gäste, Deaktivierte, kleine Regeln, Rechte an Funktionen
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: arch dm elena entw eva geh geh27 home lukas max ops peter t1 t2
-- Legt Testdaten an: agentur
-- =============================================================================

-- 38. Neue Personen kommen nur über Einladungen, auch nicht direkt durch Organisations-Admins
--     (REVIEW.md, R-06). Dieselbe Person aus Zitadel kann in mehreren Mandanten ein Konto
--     haben, pro Mandant aber nur eines
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  BEGIN
    INSERT INTO users (tenant_id, idp_subject, email, display_name)
    VALUES (app.current_tenant(), 'zitadel-direkt', 'direkt@alpenwerk.example', 'Direkt');
    RAISE EXCEPTION 'FEHLER: App legt Person direkt an (neue Personen nur über Einladungen)';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_temp.new_user(app.current_tenant(), 'berater@extern.example', 'Berater', 'zitadel-4711');
  BEGIN
    PERFORM pg_temp.new_user(app.current_tenant(), 'zweit@extern.example', 'Doppelt', 'zitadel-4711');
    RAISE EXCEPTION 'FEHLER: dieselbe Person zweimal im Mandanten';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
BEGIN
  PERFORM pg_temp.new_user(app.current_tenant(), 'berater@extern.example', 'Berater', 'zitadel-4711');
  RAISE NOTICE 'OK 38 Personen nur über Einladungen; dieselbe Person in mehreren Mandanten, pro Mandant einmal';
END $$;

-- 39. Gäste sehen nur, was ihnen ausdrücklich freigegeben ist, den Space nur über diese Seite
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE g uuid;
BEGIN
  g := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Für die Agentur', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('agentur', g);
  PERFORM app.set_page_inheritance(g, false, pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, g, 'user', pg_temp.id('elena'), NULL, 'commenter', pg_temp.id('peter'));
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena'));
DO $$
BEGIN
  ASSERT (SELECT array_agg(id) FROM pages) = ARRAY[pg_temp.id('agentur')], 'Gast sieht mehr als die freigegebene Seite';
  ASSERT (SELECT count(*) FROM spaces WHERE id = pg_temp.id('entw')) = 1, 'Gast sieht den Space der Seite nicht (Brotkrume)';
  ASSERT app.space_role(pg_temp.id('entw')) IS NULL, 'Gast hat eine Rolle im ganzen Space';
  ASSERT app.page_role(pg_temp.id('agentur')) = 'commenter', 'Recht des Gasts fehlt';
  PERFORM app.add_comment(pg_temp.id('agentur'), 'Passt so', pg_temp.id('elena'));
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('agentur'), 'Vom Gast', pg_temp.id('elena'));
    RAISE EXCEPTION 'FEHLER: Gast mit commenter legt Seite an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 39 Gäste sehen nur ausdrücklich freigegebene Seiten, den Space nur über diese';
END $$;

-- 40. Deaktivierte Personen sehen nichts mehr und dürfen nichts, auch mit Rechten
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.set_user_active(pg_temp.id('lukas'), false, pg_temp.id('peter'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages) = 0, 'deaktivierte Person sieht Seiten';
  ASSERT (SELECT count(*) FROM spaces) = 0, 'deaktivierte Person sieht Spaces';
  ASSERT app.page_role(pg_temp.id('home')) IS NULL, 'deaktivierte Person hat eine Rolle';
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Nach dem Austritt', pg_temp.id('lukas'));
    RAISE EXCEPTION 'FEHLER: deaktivierte Person legt Seite an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 40 Deaktivierte Personen sehen nichts und dürfen nichts';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.set_user_active(pg_temp.id('lukas'), true, pg_temp.id('peter'));

-- 41. Kleine Regeln: kein Admin für alle im Workspace, kleine Anker, keine Kommentare im
--     Papierkorb, Wiederherstellen nur aus vorhandenen, älteren Versionen
DO $$
DECLARE t uuid;
BEGIN
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'workspace', NULL, NULL, 'admin', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: alle im Workspace als Admin';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%können nicht Admin sein%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM app.add_comment(pg_temp.id('arch'), 'Anker', pg_temp.id('peter'), jsonb_build_object('x', repeat('y', 3000)));
    RAISE EXCEPTION 'FEHLER: riesiger Anker';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  t := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Wegwerfen', pg_temp.id('peter'));
  PERFORM app.trash_page(t, pg_temp.id('peter'));
  BEGIN
    PERFORM app.add_comment(t, 'Zu spät', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Kommentar im Papierkorb';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%liegt im Papierkorb%' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
DECLARE v int;
BEGIN
  BEGIN
    PERFORM app.create_version(pg_temp.id('dm'), 'restore', NULL, 0);
    RAISE EXCEPTION 'FEHLER: aus nicht vorhandener Version wiederhergestellt';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.create_version(pg_temp.id('dm'), 'restore', NULL, 99);
    RAISE EXCEPTION 'FEHLER: aus künftiger Version wiederhergestellt';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  v := app.create_version(pg_temp.id('dm'), 'restore', NULL, 1);
  ASSERT (SELECT restored_from FROM page_versions WHERE page_id = pg_temp.id('dm') AND version = v) = 1,
    'Wiederherstellung nicht vermerkt';
  BEGIN
    INSERT INTO grants (tenant_id, space_id, subject_type, role)
    VALUES (app.current_tenant(), pg_temp.id('ops'), 'workspace', 'admin');
    RAISE EXCEPTION 'FEHLER: alle im Workspace als Admin (direkt)';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 41 Kein Admin für alle, kleine Anker, kein Kommentar im Papierkorb, Versionen geprüft';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 42. Rechte anderer Personen lassen sich nicht abfragen, interne Bausteine nicht aufrufen,
--     und künftige Funktionen sind nicht von selbst für alle ausführbar
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format('SELECT app.page_rank(%L::uuid, %L::uuid)', pg_temp.id('geh'), pg_temp.id('lukas')),
    format('SELECT app.space_rank(%L::uuid, %L::uuid)', pg_temp.id('entw'), pg_temp.id('peter')),
    format('SELECT app.has_admin(%L::uuid)', pg_temp.id('entw')),
    format('SELECT app.perm_source(%L::uuid)', pg_temp.id('geh27')),
    format('SELECT app.emit(%L::uuid, %L::uuid, ''x'', ''{}'')', pg_temp.id('t1'), pg_temp.id('entw')),
    format('SELECT app.audit(%L::uuid, ''x'', ''x'', NULL)', pg_temp.id('peter')),
    format('SELECT app.insert_version(%L::uuid, ''manual'', NULL, NULL)', pg_temp.id('dm')),
    format('SELECT app.lock_tree(%L::uuid, true)', pg_temp.id('entw')),
    -- Gruppen aus dem Login-Dienst gleicht nur wiki_worker ab, sonst trüge sich jede Person
    -- selbst in jede idp-Gruppe ein (REVIEW.md, R-02)
    format('SELECT app.sync_user_groups(%L::uuid, ARRAY[''grp-dev''], ARRAY[''Entwicklung''])', pg_temp.id('max'))
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FEHLER: für wiki_app aufrufbar: %', v_sql;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  ASSERT app.page_rank(pg_temp.id('arch')) = 1, 'eigener Rang nicht abfragbar';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'app'::regnamespace
                     AND has_function_privilege('public', p.oid, 'EXECUTE')), 'Funktion für PUBLIC ausführbar';
  -- Globaler Eintrag für wiki_owner, der PUBLIC nicht enthält
  ASSERT EXISTS (SELECT 1 FROM pg_default_acl d
                 WHERE d.defaclrole = 'wiki_owner'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f'
                   AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 0)),
    'künftige Funktionen wären für PUBLIC ausführbar';
  RAISE NOTICE 'OK 42 Rechte anderer nicht abfragbar, interne Bausteine gesperrt, auch künftige';
END $$;
