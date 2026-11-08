-- =============================================================================
-- Migration 0003: Einladung annehmen verknüpft das Login
-- app.accept_invite: Gibt es die Person schon, aber ohne Login (idp_subject leer), wird das
-- Login verknüpft; gehört die E-Mail zu einem anderen Login, wird abgelehnt. Gleicher Text
-- wie in schema/40_functions_tenants.sql (geprüft von schema_migrations_test.sh). Die
-- Rechte an der Funktion bleiben (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION app.accept_invite(p_token_hash text, p_display_name text, p_idp_subject text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_inv    invites%ROWTYPE;
  v_user   uuid;
  v_deact  timestamptz;
  v_subject text;
BEGIN
  SELECT * INTO v_inv FROM invites
  WHERE token_hash = p_token_hash AND tenant_id = v_tenant
    AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_invite: Einladung ungültig oder abgelaufen';
  END IF;

  SELECT id, deactivated_at, idp_subject INTO v_user, v_deact, v_subject FROM users
  WHERE tenant_id = v_tenant AND lower(email) = lower(v_inv.email);
  IF v_deact IS NOT NULL THEN
    RAISE EXCEPTION 'accept_invite: Person ist deaktiviert';
  END IF;
  IF v_user IS NULL THEN
    v_user := uuidv7();
    INSERT INTO users (id, tenant_id, idp_subject, email, display_name, is_external)
    VALUES (v_user, v_tenant, p_idp_subject, v_inv.email, p_display_name, v_inv.role = 'guest');
  ELSIF p_idp_subject IS NOT NULL AND v_subject IS NULL THEN
    -- Person gab es schon (z. B. mit create_tenant angelegt), aber ohne Login: jetzt verknüpfen,
    -- sonst käme sie beim nächsten Login nicht mehr hinein
    UPDATE users SET idp_subject = p_idp_subject WHERE id = v_user;
  ELSIF p_idp_subject IS DISTINCT FROM v_subject AND p_idp_subject IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'accept_invite: Zu dieser E-Mail-Adresse gehört im Mandanten ein anderes Login';
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (v_inv.workspace_id, v_user, v_tenant, v_inv.role)
  ON CONFLICT DO NOTHING;
  UPDATE invites SET accepted_at = now() WHERE id = v_inv.id;

  PERFORM app.audit(v_user, 'invite.accepted', 'workspace', v_inv.workspace_id);
  RETURN v_user;
END $$;
