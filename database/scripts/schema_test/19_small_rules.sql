-- =============================================================================
-- Test 54: Kleine Regeln aus dem Review (Einladungen, Audit-Log, Verbindungen)
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: entw lukas peter t1 ws1
-- Legt Testdaten an: (keine)
-- =============================================================================

-- 54. Einladungen ändert die App nur beim Zurücknehmen (REVIEW.md, R-07); Audit-Einträge
--     aus der API nur für die Aktionen der API, nicht für die der Datenbank (R-09); mit der
--     Datenbank verbinden dürfen sich nur ausdrücklich berechtigte Rollen (R-08)
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE i uuid := uuidv7(); v_sql text;
BEGIN
  INSERT INTO invites (id, tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at)
  VALUES (i, app.current_tenant(), pg_temp.id('ws1'), 'r07@alpenwerk.example', 'member', 'inv-r07',
          pg_temp.id('peter'), now() + interval '1 day');
  FOREACH v_sql IN ARRAY ARRAY[
    format('UPDATE invites SET invited_by = %L WHERE id = %L', pg_temp.id('lukas'), i),
    format('UPDATE invites SET accepted_at = now() WHERE id = %L', i),
    format('UPDATE invites SET token_hash = ''anders'' WHERE id = %L', i),
    format('UPDATE invites SET role = ''admin'' WHERE id = %L', i),
    format('DELETE FROM invites WHERE id = %L', i)
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FEHLER: Einladung direkt geändert: %', v_sql;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  UPDATE invites SET revoked_at = now() WHERE id = i;
  ASSERT (SELECT revoked_at IS NOT NULL FROM invites WHERE id = i), 'Zurücknehmen geht nicht mehr';

  PERFORM app.audit_event(pg_temp.id('peter'), 'invite.created', 'workspace', pg_temp.id('ws1'));
  BEGIN
    PERFORM app.audit_event(pg_temp.id('peter'), 'grant.changed', 'space', pg_temp.id('entw'));
    RAISE EXCEPTION 'FEHLER: API schreibt eine Aktion der Datenbank ins Audit-Log';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  ASSERT NOT has_database_privilege('public', current_database(), 'CONNECT'),
    'jede Rolle darf sich mit der Datenbank verbinden (CONNECT für PUBLIC)';
  RAISE NOTICE 'OK 54 Einladungen nur zurücknehmen, Audit-Aktionen der API begrenzt, CONNECT nicht für alle';
END $$;
