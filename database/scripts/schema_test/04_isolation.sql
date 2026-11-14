-- =============================================================================
-- Tests 15–20: Mandantentrennung, Outbox, Audit-Log, RLS auf allen Tabellen, Handeln im Namen anderer
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: arch entw eva home max peter t1 t2 ws1
-- =============================================================================

-- 15. Mandantentrennung
SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pages;   ASSERT n = 0, 'fremde Seiten sichtbar';
  SELECT count(*) INTO n FROM spaces;  ASSERT n = 0, 'fremde Spaces sichtbar';
  SELECT count(*) INTO n FROM users;   ASSERT n = 1, 'fremde Personen sichtbar';
  SELECT count(*) INTO n FROM tenants; ASSERT n = 1, 'fremde Mandanten sichtbar';
  ASSERT app.page_rank(pg_temp.id('arch')) = 0, 'Rang über Mandantengrenzen';
  BEGIN
    INSERT INTO invites (tenant_id, workspace_id, email, role, token_hash, expires_at)
    VALUES (pg_temp.id('t1'), pg_temp.id('ws1'), 'x@x.example', 'member', 'fremd', now() + interval '1 day');
    RAISE EXCEPTION 'FEHLER: Schreiben in fremden Mandanten';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('eva'), NULL, 'admin', pg_temp.id('eva'));
    RAISE EXCEPTION 'FEHLER: Recht auf fremdem Space';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%Space nicht gefunden%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'OK 15 Mandantentrennung beim Lesen, Schreiben und bei Rechten';
END $$;
SELECT pg_temp.ctx(NULL, NULL);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages) = 0, 'ohne Kontext sichtbar';
  RAISE NOTICE 'OK 16 Ohne gesetzten Mandanten ist nichts sichtbar';
END $$;

-- 17. Outbox und Audit-Log
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM outbox LIMIT 1;
    RAISE EXCEPTION 'FEHLER: App kann Outbox lesen';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM audit_log;
    RAISE EXCEPTION 'FEHLER: Audit-Log löschbar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM audit_log WHERE action = 'page.inheritance_cut') = 2, 'Audit fehlt';
  RAISE NOTICE 'OK 17 Outbox nur schreibbar, Audit-Log nicht löschbar und gefüllt';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM outbox WHERE subject = 't.' || pg_temp.id('t1') || '.wiki.s.' || pg_temp.id('entw')
          AND event_type = 'page.created') >= 5, 'Events fehlen';
  RAISE NOTICE 'OK 18 Events in der Outbox mit Subject t.<tenant>.wiki.s.<space>';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 19. Jede Tabelle ist abgesichert, auch künftige. tenants ist die einzige Ausnahme.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT c.oid, c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
           FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  LOOP
    n := n + 1;
    ASSERT r.relrowsecurity, format('RLS fehlt auf %s', r.relname);
    ASSERT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polname = 'tenant_isolation'),
      format('Policy fehlt auf %s', r.relname);
    ASSERT r.relname = 'tenants' OR EXISTS (SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = r.oid AND a.attname = 'tenant_id' AND a.attnotnull AND NOT a.attisdropped),
      format('tenant_id fehlt auf %s', r.relname);
    ASSERT r.owner NOT IN ('wiki_app', 'wiki_worker'), format('App besitzt %s', r.relname);
  END LOOP;
  ASSERT n >= 20, 'zu wenige Tabellen gefunden: ' || n;
  ASSERT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('wiki_app', 'wiki_worker')
                     AND (rolsuper OR rolbypassrls)), 'App-Rolle umgeht RLS';
  RAISE NOTICE 'OK 19 Alle Tabellen haben tenant_id und RLS, App-Rollen umgehen RLS nicht';
END $$;

-- 20. Niemand handelt im Namen anderer, path nur über Funktionen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  BEGIN
    PERFORM app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Gefälscht', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Seite im Namen anderer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('max'), NULL, 'admin', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Recht im Namen anderer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  UPDATE pages SET path = 'x' WHERE id = pg_temp.id('arch');
  RAISE EXCEPTION 'FEHLER: path direkt geändert';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK 20 Handeln im Namen anderer abgelehnt, Baum nur über Funktionen änderbar';
END $$;
