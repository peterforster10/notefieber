-- =============================================================================
-- NoteFieber: Mandanten, Personen, Workspaces
-- Abfragen vor dem Login, Mandant anlegen, Einladungen, Gruppen, Mitgliedschaften, Personen.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abfragen vor der Anmeldung (Mandant noch unbekannt), wie bei TalkFieber
-- =============================================================================

CREATE FUNCTION app.resolve_tenant(p_slug text)
RETURNS TABLE (tenant_id uuid, name text, idp_org_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.id, t.name, t.idp_org_id FROM tenants t
  WHERE t.slug = p_slug AND t.deleted_at IS NULL
$$;

CREATE FUNCTION app.find_invite(p_token_hash text)
RETURNS TABLE (tenant_id uuid, tenant_name text, workspace_name text, email text,
               role text, invited_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT i.tenant_id, t.name, w.name, i.email, i.role, u.display_name
  FROM invites i
  JOIN tenants t ON t.id = i.tenant_id
  JOIN workspaces w ON w.id = i.workspace_id
  LEFT JOIN users u ON u.id = i.invited_by
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
$$;

-- =============================================================================
-- Abläufe: Mandanten und Personen
-- =============================================================================

-- Mandant + erster Workspace + erste Person als Organisations-Admin und Owner.
-- p_tenant_id: dieselbe ID wie in TalkFieber verwenden, wenn der Kunde dort schon existiert.
CREATE FUNCTION app.create_tenant(
  p_slug text, p_name text, p_region text,
  p_admin_email text, p_admin_name text, p_admin_idp_subject text DEFAULT NULL,
  p_workspace_slug text DEFAULT 'main', p_workspace_name text DEFAULT NULL,
  p_idp_org_id text DEFAULT NULL, p_tenant_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, uuidv7());
  v_ws     uuid := uuidv7();
  v_user   uuid := uuidv7();
BEGIN
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  INSERT INTO tenants (id, slug, name, region, idp_org_id)
  VALUES (v_tenant, p_slug, p_name, p_region, p_idp_org_id);
  INSERT INTO workspaces (id, tenant_id, slug, name)
  VALUES (v_ws, v_tenant, p_workspace_slug, coalesce(p_workspace_name, p_name));
  INSERT INTO users (id, tenant_id, idp_subject, email, display_name, role)
  VALUES (v_user, v_tenant, p_admin_idp_subject, p_admin_email, p_admin_name, 'org_admin');
  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (v_ws, v_user, v_tenant, 'owner');

  PERFORM app.audit(v_user, 'tenant.created', 'tenant', v_tenant);
  RETURN v_tenant;
END $$;

-- SECURITY DEFINER, weil wiki_app Mitgliedschaften nicht direkt schreiben darf.
CREATE FUNCTION app.accept_invite(p_token_hash text, p_display_name text, p_idp_subject text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_inv    invites%ROWTYPE;
  v_user   uuid;
  v_deact  timestamptz;
BEGIN
  SELECT * INTO v_inv FROM invites
  WHERE token_hash = p_token_hash AND tenant_id = v_tenant
    AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_invite: Einladung ungültig oder abgelaufen';
  END IF;

  SELECT id, deactivated_at INTO v_user, v_deact FROM users
  WHERE tenant_id = v_tenant AND lower(email) = lower(v_inv.email);
  IF v_deact IS NOT NULL THEN
    RAISE EXCEPTION 'accept_invite: Person ist deaktiviert';
  END IF;
  IF v_user IS NULL THEN
    v_user := uuidv7();
    INSERT INTO users (id, tenant_id, idp_subject, email, display_name, is_external)
    VALUES (v_user, v_tenant, p_idp_subject, v_inv.email, p_display_name, v_inv.role = 'guest');
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (v_inv.workspace_id, v_user, v_tenant, v_inv.role)
  ON CONFLICT DO NOTHING;
  UPDATE invites SET accepted_at = now() WHERE id = v_inv.id;

  PERFORM app.audit(v_user, 'invite.accepted', 'workspace', v_inv.workspace_id);
  RETURN v_user;
END $$;

-- Gruppen beim Login aus dem Token übernehmen (Zitadel-Gruppen oder Rollen).
-- SECURITY DEFINER, weil wiki_app Gruppen und Mitgliedschaften nicht direkt schreiben darf.
CREATE FUNCTION app.sync_user_groups(p_user_id uuid, p_idp_group_ids text[], p_names text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_actor(p_user_id);
  IF cardinality(p_idp_group_ids) IS DISTINCT FROM cardinality(p_names) THEN
    RAISE EXCEPTION 'sync_user_groups: IDs und Namen passen nicht zusammen';
  END IF;

  -- ON CONFLICT: Zwei gleichzeitige Logins mit derselben neuen Gruppe scheitern sonst
  -- an der Eindeutigkeit (groups und group_members haben keine Leseregel, siehe CLAUDE.md).
  INSERT INTO groups (tenant_id, idp_group_id, name)
  SELECT v_tenant, g.gid, g.gname FROM unnest(p_idp_group_ids, p_names) AS g (gid, gname)
  ON CONFLICT (tenant_id, idp_group_id) DO NOTHING;

  UPDATE groups x SET name = g.gname
  FROM unnest(p_idp_group_ids, p_names) AS g (gid, gname)
  WHERE x.tenant_id = v_tenant AND x.idp_group_id = g.gid AND x.name <> g.gname;

  DELETE FROM group_members gm USING groups x
  WHERE gm.group_id = x.id AND gm.user_id = p_user_id AND x.tenant_id = v_tenant
    AND x.idp_group_id <> ALL (array_remove(coalesce(p_idp_group_ids, '{}'), NULL));   -- NULL würde nichts löschen

  INSERT INTO group_members (group_id, user_id, tenant_id)
  SELECT x.id, p_user_id, v_tenant FROM groups x
  WHERE x.tenant_id = v_tenant AND x.idp_group_id = ANY (p_idp_group_ids)
  ON CONFLICT (group_id, user_id) DO NOTHING;
END $$;

-- Person aus einem Workspace entfernen: Ihre persönlichen Grants auf dessen Spaces und
-- Seiten fallen weg. Abgelehnt, wenn sie dadurch irgendwo letzter Admin war. Das Event
-- member.removed lässt den Collab-Server ihre offenen Verbindungen trennen.
-- SECURITY DEFINER, weil auch Seiten betroffen sind, die die handelnde Person nicht
-- sieht. Der Mandant wird deshalb ausdrücklich geprüft.
CREATE FUNCTION app.remove_workspace_member(p_workspace_id uuid, p_user_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_admin_objects uuid[];
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF p_user_id <> p_actor_id AND NOT app.is_workspace_admin(p_workspace_id, p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen Personen aus einem Workspace entfernen';
  END IF;

  DELETE FROM workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN; END IF;

  WITH removed AS (
    DELETE FROM grants g
    WHERE g.tenant_id = v_tenant AND g.user_id = p_user_id
      AND (   g.space_id IN (SELECT id FROM spaces WHERE workspace_id = p_workspace_id)
           OR g.page_id IN (SELECT p.id FROM pages p JOIN spaces s ON s.id = p.space_id
                            WHERE s.workspace_id = p_workspace_id))
    RETURNING coalesce(g.space_id, g.page_id) AS object_id, g.role)
  SELECT array_agg(object_id) FILTER (WHERE role = 'admin') INTO v_admin_objects FROM removed;

  IF EXISTS (SELECT 1 FROM unnest(v_admin_objects) AS o WHERE NOT app.has_admin(o)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Die Person ist letzter Admin eines Spaces oder einer eingeschränkten Seite, zuerst einen anderen Admin bestimmen';
  END IF;

  PERFORM app.emit_user_spaces(p_user_id, p_workspace_id, 'member.removed',
    jsonb_build_object('user', p_user_id, 'workspace', p_workspace_id));
  PERFORM app.audit(p_actor_id, 'member.removed', 'workspace', p_workspace_id,
                    jsonb_build_object('user_id', p_user_id));
END $$;

-- Prüft, ob die handelnde Person einer anderen diese Workspace-Rolle geben darf.
-- Owner vergeben nur Owner und Organisations-Admins.
CREATE FUNCTION app.require_member_admin(p_workspace_id uuid, p_actor_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_workspace_admin(p_workspace_id, p_actor_id)
     OR (p_role = 'owner' AND NOT app.is_org_admin(p_actor_id) AND NOT EXISTS (
           SELECT 1 FROM workspace_members
           WHERE workspace_id = p_workspace_id AND user_id = p_actor_id
             AND tenant_id = app.current_tenant() AND role = 'owner')) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen Mitglieder verwalten, Owner nur Owner';
  END IF;
END $$;

-- Person in einen Workspace aufnehmen (ohne Einladung, z. B. bestehende Personen des Mandanten).
CREATE FUNCTION app.add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_member_admin(p_workspace_id, p_actor_id, p_role);
  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (p_workspace_id, p_user_id, v_tenant, p_role);
  PERFORM app.audit(p_actor_id, 'member.added', 'workspace', p_workspace_id,
                    jsonb_build_object('user_id', p_user_id, 'role', p_role));
END $$;

-- Rolle im Workspace ändern. member.changed, weil z. B. ein Wechsel zu guest den Zugriff
-- über "alle im Workspace" beendet.
CREATE FUNCTION app.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_old    text;
BEGIN
  PERFORM app.require_member_admin(p_workspace_id, p_actor_id, p_role);
  SELECT role INTO v_old FROM workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'set_workspace_member_role: Person ist kein Mitglied'; END IF;
  IF v_old = p_role THEN RETURN; END IF;
  IF v_old = 'owner' THEN
    PERFORM app.require_member_admin(p_workspace_id, p_actor_id, 'owner');
  END IF;

  UPDATE workspace_members SET role = p_role
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND tenant_id = v_tenant;

  PERFORM app.emit_user_spaces(p_user_id, p_workspace_id, 'member.changed',
    jsonb_build_object('user', p_user_id, 'workspace', p_workspace_id, 'role', p_role));
  PERFORM app.audit(p_actor_id, 'member.role_changed', 'workspace', p_workspace_id,
                    jsonb_build_object('user_id', p_user_id, 'from', v_old, 'to', p_role));
END $$;

-- Organisations-Rolle ändern (nur Organisations-Admins). Der Trigger schützt den letzten.
CREATE FUNCTION app.set_user_role(p_user_id uuid, p_role text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_org_admin(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Organisations-Admins dürfen Rollen ändern';
  END IF;
  UPDATE users SET role = p_role WHERE id = p_user_id AND tenant_id = app.current_tenant();
  IF NOT FOUND THEN RAISE EXCEPTION 'set_user_role: Person nicht gefunden'; END IF;
  PERFORM app.audit(p_actor_id, 'user.role_changed', 'user', p_user_id, jsonb_build_object('role', p_role));
END $$;

-- Person deaktivieren oder wieder aktivieren (nur Organisations-Admins). Beim Deaktivieren
-- trennt der Collab-Server ihre Verbindungen (user.deactivated). Ihre Grants bleiben, zählen
-- aber nicht mehr als Admin (app.has_admin).
CREATE FUNCTION app.set_user_active(p_user_id uuid, p_active boolean, p_actor_id uuid)
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
    PERFORM app.emit_user_spaces(p_user_id, NULL, 'user.deactivated', jsonb_build_object('user', p_user_id));
  END IF;
  PERFORM app.audit(p_actor_id, CASE WHEN p_active THEN 'user.reactivated' ELSE 'user.deactivated' END,
                    'user', p_user_id);
END $$;
