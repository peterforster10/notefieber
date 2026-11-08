-- =============================================================================
-- Tests 47–48: Sitzungen der API (Login), Abmelden, Deaktivieren, Ablauf
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: eva lukas max peter t1 t2
-- Legt Testdaten an: (keine)
-- =============================================================================

-- 47. Sitzung anlegen nur für sich selbst, finden über den Token-Hash, sehen nur die eigene,
--     abmelden; kein direkter Weg an den Funktionen vorbei
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE s uuid; r record;
BEGIN
  s := app.create_session(pg_temp.id('peter'), repeat('a', 64), now() + interval '8 hours', 'Testbrowser');
  BEGIN
    PERFORM app.create_session(pg_temp.id('lukas'), repeat('b', 64), now() + interval '1 hour');
    RAISE EXCEPTION 'FEHLER: Sitzung für eine andere Person angelegt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.create_session(pg_temp.id('peter'), repeat('c', 64), now() + interval '31 days');
    RAISE EXCEPTION 'FEHLER: Sitzung länger als 30 Tage';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FEHLER%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM app.create_session(pg_temp.id('peter'), 'kein-hash', now() + interval '1 hour');
    RAISE EXCEPTION 'FEHLER: ungültiger Token-Hash angenommen';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at)
    VALUES (app.current_tenant(), pg_temp.id('peter'), repeat('d', 64), now() + interval '1 hour');
    RAISE EXCEPTION 'FEHLER: App legt Sitzung direkt an';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT count(*) FROM sessions WHERE id = s) = 1, 'eigene Sitzung nicht sichtbar';
  ASSERT EXISTS (SELECT 1 FROM audit_log WHERE action = 'session.created' AND details ->> 'session_id' = s::text),
    'session.created fehlt im Audit-Log';
END $$;

-- Ohne Kontext (wie die API vor dem Lesen des Cookies): Sitzung über den Hash finden
SELECT pg_temp.ctx(NULL, NULL);
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM app.resolve_session(repeat('a', 64));
  ASSERT r.tenant_id = pg_temp.id('t1') AND r.user_id = pg_temp.id('peter'), 'Sitzung nicht gefunden';
  ASSERT NOT EXISTS (SELECT 1 FROM app.resolve_session(repeat('e', 64))), 'unbekanntes Token gefunden';
END $$;

-- Andere Person im selben Mandanten sieht die Sitzung nicht, Eva im anderen Mandanten auch nicht
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM sessions), 'Max sieht fremde Sitzung';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva'));
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM sessions), 'Eva sieht Sitzung aus anderem Mandanten';
END $$;

SELECT pg_temp.ctx(NULL, NULL);
DO $$
BEGIN
  ASSERT app.end_session(repeat('a', 64)), 'Abmelden findet die Sitzung nicht';
  ASSERT NOT app.end_session(repeat('a', 64)), 'zweites Abmelden meldet eine Sitzung';
  ASSERT NOT EXISTS (SELECT 1 FROM app.resolve_session(repeat('a', 64))), 'Sitzung nach dem Abmelden gültig';
  RAISE NOTICE 'OK 47 Sitzungen: nur für sich selbst, über den Hash, nur die eigene sichtbar, abmelden';
END $$;

-- 48. Deaktivieren meldet sofort ab; abgelaufene Sitzungen gelten nicht; Deaktivierte bekommen keine
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
SELECT app.create_session(pg_temp.id('lukas'), repeat('f', 64), now() + interval '1 hour') IS NOT NULL;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.set_user_active(pg_temp.id('lukas'), false, pg_temp.id('peter'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM app.resolve_session(repeat('f', 64))), 'Sitzung nach Deaktivieren gültig';
  ASSERT NOT EXISTS (SELECT 1 FROM sessions WHERE token_hash = repeat('f', 64)), 'Sitzung nach Deaktivieren nicht gelöscht';
  BEGIN
    PERFORM app.create_session(pg_temp.id('lukas'), repeat('0', 64), now() + interval '1 hour');
    RAISE EXCEPTION 'FEHLER: deaktivierte Person bekommt eine Sitzung';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.set_user_active(pg_temp.id('lukas'), true, pg_temp.id('peter'));

-- Ablauf: als Eigentümer zurückdatieren (die Apps können expires_at nicht ändern)
SELECT app.create_session(pg_temp.id('peter'), repeat('1', 64), now() + interval '1 hour') IS NOT NULL;
RESET ROLE;
UPDATE sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute'
WHERE token_hash = repeat('1', 64);
SET ROLE wiki_app;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM app.resolve_session(repeat('1', 64))), 'abgelaufene Sitzung gültig';
  -- Die nächste Sitzung derselben Person räumt abgelaufene mit weg
  PERFORM app.create_session(pg_temp.id('peter'), repeat('2', 64), now() + interval '1 hour');
  ASSERT NOT EXISTS (SELECT 1 FROM sessions WHERE token_hash = repeat('1', 64)), 'abgelaufene Sitzung nicht aufgeräumt';
  RAISE NOTICE 'OK 48 Deaktivieren meldet ab, Abgelaufenes gilt nicht, Deaktivierte bekommen keine Sitzung';
END $$;
