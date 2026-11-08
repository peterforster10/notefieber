-- =============================================================================
-- Migration 0002: Sitzungen der API (Login über OIDC)
-- Tabelle sessions, app.create_session, app.resolve_session, app.end_session;
-- app.set_user_active löscht beim Deaktivieren die Sitzungen der Person.
-- Gleicher Stand wie in schema/ (10_tables.sql, 40_functions_tenants.sql, 80_rls.sql,
-- 90_privileges.sql); Funktionen zeichengleich, geprüft von schema_migrations_test.sh.
-- =============================================================================

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_agent  text CHECK (length(user_agent) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX sessions_by_user ON sessions (user_id);

CREATE OR REPLACE FUNCTION app.set_user_active(p_user_id uuid, p_active boolean, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_org_admin(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Organisations-Admins dürfen Personen deaktivieren';
  END IF;
  UPDATE users SET deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END
  WHERE id = p_user_id AND tenant_id = app.current_tenant()
    AND (deactivated_at IS NULL) <> p_active;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT p_active THEN
    DELETE FROM sessions WHERE user_id = p_user_id AND tenant_id = app.current_tenant();   -- sofort abgemeldet
    PERFORM app.emit_user_spaces(p_user_id, NULL, 'user.deactivated', jsonb_build_object('user', p_user_id));
  END IF;
  PERFORM app.audit(p_actor_id, CASE WHEN p_active THEN 'user.reactivated' ELSE 'user.deactivated' END,
                    'user', p_user_id);
END $$;

CREATE FUNCTION app.create_session(p_user_id uuid, p_token_hash text, p_expires_at timestamptz,
                                   p_user_agent text DEFAULT NULL)
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
  INSERT INTO sessions (id, tenant_id, user_id, token_hash, user_agent, expires_at)
  VALUES (v_session, v_tenant, p_user_id, p_token_hash, left(p_user_agent, 500), p_expires_at);
  PERFORM app.audit(p_user_id, 'session.created', 'user', p_user_id, jsonb_build_object('session_id', v_session));
  RETURN v_session;
END $$;

-- Sitzung zum Token (Hash) finden, bei jeder Anfrage und vor dem Mandanten-Kontext (wie
-- find_invite). Nur gültige Sitzungen aktiver Personen in nicht gekündigten Mandanten.
CREATE FUNCTION app.resolve_session(p_token_hash text)
RETURNS TABLE (session_id uuid, tenant_id uuid, user_id uuid, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.id, s.tenant_id, s.user_id, s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
  JOIN tenants t ON t.id = s.tenant_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now()
    AND u.deactivated_at IS NULL AND t.deleted_at IS NULL
$$;

-- Abmelden: Sitzung zum Token löschen. Braucht keinen Kontext, das Token genügt. Gibt
-- zurück, ob es eine Sitzung gab.
CREATE FUNCTION app.end_session(p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_user   uuid;
BEGIN
  DELETE FROM sessions WHERE token_hash = p_token_hash RETURNING tenant_id, user_id INTO v_tenant, v_user;
  IF NOT FOUND THEN RETURN false; END IF;
  -- app.audit nimmt den Mandanten aus dem Kontext; hier gibt es keinen, also direkt
  INSERT INTO audit_log (tenant_id, actor_id, action, target_type, target_id)
  VALUES (v_tenant, v_user, 'session.ended', 'user', v_user);
  RETURN true;
END $$;

-- Row Level Security wie in 80_rls.sql: Mandantentrennung und nur die eigenen Sitzungen
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());
CREATE POLICY read_access ON sessions AS RESTRICTIVE FOR SELECT TO wiki_app
USING (user_id = app.current_user_id());

-- Rechte wie in 90_privileges.sql. Neue Funktionen sind wegen der Default Privileges für
-- niemanden ausführbar, bis sie hier freigegeben werden.
GRANT SELECT ON sessions TO wiki_app;
GRANT SELECT, DELETE ON sessions TO wiki_worker;
GRANT EXECUTE ON FUNCTION
  app.create_session(uuid, text, timestamptz, text),
  app.resolve_session(text),
  app.end_session(text)
TO wiki_app, wiki_worker;
