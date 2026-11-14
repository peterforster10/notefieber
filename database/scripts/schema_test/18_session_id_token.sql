-- =============================================================================
-- Test 53: ID-Token an der Sitzung, nur für das Abmelden beim Login-Dienst
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: lukas peter t1
-- Legt Testdaten an: sitzung_token
-- =============================================================================

-- 53. Die Sitzung merkt sich das ID-Token aus dem Login, damit die API beim Abmelden
--     id_token_hint mitschicken kann; sonst beendet Zitadel die eigene Sitzung erst nach
--     einer Kontenauswahl (REVIEW.md, R-18). Sichtbar nur für die eigene Person, begrenzt
--     lang, weg mit dem Abmelden. Aufrufe ohne ID-Token (bisherige API) gehen weiter.
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE s uuid; alt uuid;
BEGIN
  s := app.create_session(pg_temp.id('peter'), repeat('e', 64), now() + interval '1 hour', 'Browser', 'eyJ.id.token');
  ASSERT (SELECT id_token FROM sessions WHERE id = s) = 'eyJ.id.token', 'ID-Token nicht gespeichert';
  alt := app.create_session(pg_temp.id('peter'), repeat('f', 64), now() + interval '1 hour', 'Browser');
  ASSERT (SELECT id_token IS NULL FROM sessions WHERE id = alt), 'Sitzung ohne ID-Token falsch angelegt';
  BEGIN
    PERFORM app.create_session(pg_temp.id('peter'), repeat('9', 64), now() + interval '1 hour', NULL, repeat('x', 10001));
    RAISE EXCEPTION 'FEHLER: übergroßes ID-Token angenommen';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO ids VALUES ('sitzung_token', s);
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM sessions WHERE id = pg_temp.id('sitzung_token')), 'fremdes ID-Token sichtbar';
END $$;

SELECT pg_temp.ctx(NULL, NULL);
DO $$
BEGIN
  ASSERT app.end_session(repeat('e', 64)), 'Abmelden fand die Sitzung nicht';
  ASSERT app.end_session(repeat('f', 64)), 'Abmelden fand die Sitzung nicht';
END $$;

SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM sessions WHERE id = pg_temp.id('sitzung_token')), 'ID-Token bleibt nach dem Abmelden';
  RAISE NOTICE 'OK 53 ID-Token an der Sitzung: nur eigene, begrenzt, weg mit dem Abmelden';
END $$;
