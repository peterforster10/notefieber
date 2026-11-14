-- =============================================================================
-- Migration 0010: Kleine Rechte aus dem Review (REVIEW.md, R-07, R-08, R-09)
-- R-07: Einladungen ändert wiki_app nur noch beim Zurücknehmen (revoked_at), nicht mehr
--       Einladende, Annahme, Token oder Rolle, und löscht sie nicht.
-- R-08: CONNECT auf diese Datenbank nicht mehr für PUBLIC, nur für ausdrücklich berechtigte
--       Rollen (die Login-Rollen der Apps haben es ausdrücklich).
-- R-09: app.audit_event schreibt nur Aktionen der API (Bereiche invite und export).
-- Gleicher Stand wie in schema/20_functions_base.sql und schema/90_privileges.sql (geprüft
-- von schema_migrations_test.sh). Die Rechte an der Funktion bleiben (CREATE OR REPLACE).
-- =============================================================================

REVOKE UPDATE, DELETE ON invites FROM wiki_app;
GRANT UPDATE (revoked_at) ON invites TO wiki_app;

DO $$ BEGIN EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database()); END $$;

CREATE OR REPLACE FUNCTION app.audit_event(p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
                                p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF p_action IS NULL OR p_action !~ '^(invite|export)\.[a-z_]{1,50}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('audit_event: Aktion %s ist der Datenbank vorbehalten oder unbekannt', p_action);
  END IF;
  PERFORM app.audit(p_actor_id, p_action, p_target_type, p_target_id, p_details);
END $$;
