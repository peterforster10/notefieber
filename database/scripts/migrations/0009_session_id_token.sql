-- =============================================================================
-- Migration 0009: ID-Token an der Sitzung fürs Abmelden beim Login-Dienst (REVIEW.md, R-18)
-- Ohne id_token_hint beendet Zitadel seine Sitzung erst nach einer Kontenauswahl; wer das
-- Fenster vorher schließt, bleibt dort angemeldet. Die Sitzung merkt sich deshalb das
-- ID-Token aus dem Login (nur die API sieht es, nie der Browser). app.create_session bekommt
-- dafür einen weiteren Parameter mit Standardwert: Die bisherige API ruft sie weiter mit vier
-- Argumenten auf. Eine Funktion mit anderer Parameterliste lässt sich nicht ersetzen, nur
-- neu anlegen; Rechte deshalb wie in schema/90_privileges.sql neu vergeben. Gleicher Text wie
-- in schema/10_tables.sql und schema/40_functions_tenants.sql (geprüft von
-- schema_migrations_test.sh).
-- =============================================================================

ALTER TABLE sessions ADD COLUMN id_token text CHECK (length(id_token) <= 10000);

DROP FUNCTION app.create_session(uuid, text, timestamptz, text);
CREATE FUNCTION app.create_session(p_user_id uuid, p_token_hash text, p_expires_at timestamptz,
                                   p_user_agent text DEFAULT NULL, p_id_token text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_session uuid := uuidv7();
BEGIN
  PERFORM app.require_actor(p_user_id);
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND tenant_id = v_tenant AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'create_session: Person ist deaktiviert oder gehört nicht zum Mandanten';
  END IF;
  IF p_expires_at <= now() OR p_expires_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'create_session: Ablauf muss in der Zukunft liegen, höchstens 30 Tage';
  END IF;

  DELETE FROM sessions WHERE user_id = p_user_id AND tenant_id = v_tenant AND expires_at <= now();
  INSERT INTO sessions (id, tenant_id, user_id, token_hash, user_agent, expires_at, id_token)
  VALUES (v_session, v_tenant, p_user_id, p_token_hash, left(p_user_agent, 500), p_expires_at, p_id_token);
  PERFORM app.audit(p_user_id, 'session.created', 'user', p_user_id, jsonb_build_object('session_id', v_session));
  RETURN v_session;
END $$;
GRANT EXECUTE ON FUNCTION app.create_session(uuid, text, timestamptz, text, text) TO wiki_app, wiki_worker;
