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

-- Person zum Login finden (Mandant gesetzt, noch keine Person im Kontext). Ohne Person sieht
-- wiki_app keine Personen (Leseregel auf users), deshalb diese Funktion. Gibt nur ID und
-- Deaktivierung heraus.
CREATE FUNCTION app.resolve_login(p_idp_subject text)
RETURNS TABLE (user_id uuid, deactivated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id, u.deactivated_at FROM users u
  WHERE u.tenant_id = app.current_tenant() AND u.idp_subject = p_idp_subject
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

-- Einladung annehmen, beim Login (Mandant gesetzt, noch keine Person). Die API prüft vorher,
-- dass die bestätigte E-Mail aus dem Login zur Einladung passt. Gehört das Login schon einer
-- Person, wird genau diese Mitglied, auch wenn die Einladung an eine andere Adresse ging (z. B.
-- nach einer Änderung im Login-Dienst). Sonst über die E-Mail: Gibt es die Person, wird sie
-- nur Mitglied; hatte sie noch kein Login (idp_subject leer), wird es verknüpft; gehört die
-- E-Mail zu einem anderen Login, wird abgelehnt. Deaktivierte Personen kommen nicht hinein.
-- SECURITY DEFINER, weil wiki_app Mitgliedschaften nicht direkt schreiben darf.
CREATE FUNCTION app.accept_invite(p_token_hash text, p_display_name text, p_idp_subject text DEFAULT NULL)
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

  -- Zuerst über das Login, dann über die E-Mail der Einladung
  SELECT id, deactivated_at, idp_subject INTO v_user, v_deact, v_subject FROM users
  WHERE tenant_id = v_tenant AND idp_subject = p_idp_subject;
  IF NOT FOUND THEN
    SELECT id, deactivated_at, idp_subject INTO v_user, v_deact, v_subject FROM users
    WHERE tenant_id = v_tenant AND lower(email) = lower(v_inv.email);
  END IF;
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

-- Gruppen aus dem Login-Token übernehmen (Quelle idp, siehe Tabelle groups). Noch nicht
-- genutzt: Zitadel liefert keine Gruppen; gedacht für einen Gruppen-Claim, z. B. aus
-- Entra ID. Berührt nur Gruppen mit Quelle idp, im Wiki gepflegte Gruppen bleiben, wie sie sind.
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
  INSERT INTO groups (tenant_id, source, external_id, name)
  SELECT v_tenant, 'idp', g.gid, g.gname FROM unnest(p_idp_group_ids, p_names) AS g (gid, gname)
  ON CONFLICT (tenant_id, source, external_id) DO NOTHING;

  UPDATE groups x SET name = g.gname
  FROM unnest(p_idp_group_ids, p_names) AS g (gid, gname)
  WHERE x.tenant_id = v_tenant AND x.source = 'idp' AND x.external_id = g.gid AND x.name <> g.gname;

  DELETE FROM group_members gm USING groups x
  WHERE gm.group_id = x.id AND gm.user_id = p_user_id AND x.tenant_id = v_tenant AND x.source = 'idp'
    AND x.external_id <> ALL (array_remove(coalesce(p_idp_group_ids, '{}'), NULL));   -- NULL würde nichts löschen

  INSERT INTO group_members (group_id, user_id, tenant_id)
  SELECT x.id, p_user_id, v_tenant FROM groups x
  WHERE x.tenant_id = v_tenant AND x.source = 'idp' AND x.external_id = ANY (p_idp_group_ids)
  ON CONFLICT (group_id, user_id) DO NOTHING;
END $$;

-- -----------------------------------------------------------------------------
-- Gruppen im Wiki pflegen (Quelle local und import). Nur Organisations-Admins, weil
-- Gruppen für den ganzen Mandanten gelten. Mitglieder von idp- und scim-Gruppen pflegt
-- ihre Quelle; hier abgelehnt, sonst überschriebe der nächste Abgleich die Änderung.
-- -----------------------------------------------------------------------------

-- Prüft Organisations-Admin und sperrt die Gruppe. Die Sperre lässt gleichzeitige
-- Änderungen an derselben Gruppe nacheinander laufen (zwei Admins, die gleichzeitig die
-- letzten Mitglieder einer Admin-Gruppe entfernen). Liefert die Quelle der Gruppe.
CREATE FUNCTION app.require_group_admin(p_group_id uuid, p_actor_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_source text;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_org_admin(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Organisations-Admins dürfen Gruppen verwalten';
  END IF;
  SELECT source INTO v_source FROM groups
  WHERE id = p_group_id AND tenant_id = app.current_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gruppe nicht gefunden'; END IF;
  RETURN v_source;
END $$;

-- Spaces und Seiten, auf denen die Gruppe Admin ist.
CREATE FUNCTION app.group_admin_objects(p_group_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(coalesce(g.space_id, g.page_id)), '{}') FROM grants g
  WHERE g.group_id = p_group_id AND g.tenant_id = app.current_tenant() AND g.role = 'admin'
$$;

-- Nach einer Änderung an einer Gruppe: Auf jedem dieser Objekte muss noch ein wirksamer
-- Admin bleiben (wie app.set_grant für einzelne Grants). Der Trigger admin_remains greift
-- hier nicht, weil sich beim Austritt keine Grants ändern.
CREATE FUNCTION app.require_admins_remain(p_objects uuid[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(p_objects) AS o (id) WHERE NOT app.has_admin(o.id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Mindestens ein aktiver Admin muss bleiben';
  END IF;
END $$;

CREATE FUNCTION app.create_group(p_name text, p_actor_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_group uuid := uuidv7();
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_org_admin(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Organisations-Admins dürfen Gruppen verwalten';
  END IF;
  INSERT INTO groups (id, tenant_id, name, source)
  VALUES (v_group, app.current_tenant(), btrim(p_name), 'local');
  PERFORM app.audit(p_actor_id, 'group.created', 'group', v_group, jsonb_build_object('name', btrim(p_name)));
  RETURN v_group;
END $$;

-- Umbenennen nur bei local und import; idp- und scim-Gruppen bekommen den Namen von der Quelle.
CREATE FUNCTION app.rename_group(p_group_id uuid, p_name text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF app.require_group_admin(p_group_id, p_actor_id) NOT IN ('local', 'import') THEN
    RAISE EXCEPTION 'rename_group: Name kommt aus dem Login-Dienst bzw. SCIM';
  END IF;
  UPDATE groups SET name = btrim(p_name) WHERE id = p_group_id;
  PERFORM app.audit(p_actor_id, 'group.renamed', 'group', p_group_id, jsonb_build_object('name', btrim(p_name)));
END $$;

-- Gruppe löschen, mit ihren Grants. Abgelehnt, wenn sie irgendwo der letzte wirksame Admin
-- ist. grant.changed an jeden Space, in dem sie Rechte hatte (der Collab-Server prüft
-- die Verbindungen dort neu).
CREATE FUNCTION app.delete_group(p_group_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_objects uuid[];
  v_name    text;
BEGIN
  IF app.require_group_admin(p_group_id, p_actor_id) NOT IN ('local', 'import') THEN
    RAISE EXCEPTION 'delete_group: Gruppe kommt aus dem Login-Dienst bzw. SCIM';
  END IF;
  v_objects := app.group_admin_objects(p_group_id);
  PERFORM app.emit_group_spaces(p_group_id, 'grant.changed',
    jsonb_build_object('subject_type', 'group', 'group', p_group_id, 'role', NULL));
  DELETE FROM grants WHERE group_id = p_group_id AND tenant_id = v_tenant;
  PERFORM app.require_admins_remain(v_objects);
  DELETE FROM groups WHERE id = p_group_id AND tenant_id = v_tenant RETURNING name INTO v_name;
  PERFORM app.audit(p_actor_id, 'group.deleted', 'group', p_group_id, jsonb_build_object('name', v_name));
END $$;

-- Mitglied aufnehmen bzw. entfernen (nur local und import). member.changed an jeden Space,
-- in dem die Gruppe Rechte hat: Der Collab-Server prüft die Verbindungen der Person dort neu.
-- Entfernen wird abgelehnt, wenn die Gruppe dadurch irgendwo als letzter Admin wegfällt.
CREATE FUNCTION app.add_group_member(p_group_id uuid, p_user_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  IF app.require_group_admin(p_group_id, p_actor_id) NOT IN ('local', 'import') THEN
    RAISE EXCEPTION 'add_group_member: Mitglieder kommen aus dem Login-Dienst bzw. SCIM';
  END IF;
  INSERT INTO group_members (group_id, user_id, tenant_id) VALUES (p_group_id, p_user_id, v_tenant)
  ON CONFLICT (group_id, user_id) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM app.emit_group_spaces(p_group_id, 'member.changed',
    jsonb_build_object('user', p_user_id, 'group', p_group_id));
  PERFORM app.audit(p_actor_id, 'group.member_added', 'group', p_group_id, jsonb_build_object('user_id', p_user_id));
END $$;

CREATE FUNCTION app.remove_group_member(p_group_id uuid, p_user_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  IF app.require_group_admin(p_group_id, p_actor_id) NOT IN ('local', 'import') THEN
    RAISE EXCEPTION 'remove_group_member: Mitglieder kommen aus dem Login-Dienst bzw. SCIM';
  END IF;
  DELETE FROM group_members WHERE group_id = p_group_id AND user_id = p_user_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM app.require_admins_remain(app.group_admin_objects(p_group_id));
  PERFORM app.emit_group_spaces(p_group_id, 'member.changed',
    jsonb_build_object('user', p_user_id, 'group', p_group_id));
  PERFORM app.audit(p_actor_id, 'group.member_removed', 'group', p_group_id, jsonb_build_object('user_id', p_user_id));
END $$;

-- Person aus einem Workspace entfernen: Ihre persönlichen Grants auf dessen Spaces und
-- Seiten fallen weg. Abgelehnt, wenn sie dadurch irgendwo letzter wirksamer Admin war,
-- persönlich oder über eine Gruppe (ohne Mitgliedschaft zählt sie in app.has_admin nicht
-- mehr). Das Event member.removed lässt den Collab-Server ihre offenen Verbindungen trennen.
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

  -- Dazu die Spaces und Seiten des Workspaces, auf denen eine ihrer Gruppen Admin ist
  v_admin_objects := coalesce(v_admin_objects, '{}') || ARRAY(
    SELECT coalesce(g.space_id, g.page_id)
    FROM grants g
    JOIN group_members gm ON gm.group_id = g.group_id AND gm.user_id = p_user_id
    LEFT JOIN pages p ON p.id = g.page_id
    JOIN spaces s ON s.id = coalesce(g.space_id, p.space_id)
    WHERE g.tenant_id = v_tenant AND g.role = 'admin' AND s.workspace_id = p_workspace_id);

  IF EXISTS (SELECT 1 FROM unnest(v_admin_objects) AS o WHERE NOT app.has_admin(o)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Die Person ist letzter Admin eines Spaces oder einer eingeschränkten Seite (auch über eine Gruppe), zuerst einen anderen Admin bestimmen';
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
    DELETE FROM sessions WHERE user_id = p_user_id AND tenant_id = app.current_tenant();   -- sofort abgemeldet
    PERFORM app.emit_user_spaces(p_user_id, NULL, 'user.deactivated', jsonb_build_object('user', p_user_id));
  END IF;
  PERFORM app.audit(p_actor_id, CASE WHEN p_active THEN 'user.reactivated' ELSE 'user.deactivated' END,
                    'user', p_user_id);
END $$;

-- -----------------------------------------------------------------------------
-- Sitzungen der API (Tabelle sessions). Das Token selbst kennt nur der Browser (Cookie),
-- die Datenbank nur seinen SHA-256-Hash (64 Hex-Zeichen).
-- -----------------------------------------------------------------------------

-- Sitzung anlegen, nach dem Login (die API hat Mandant und Person gesetzt). Nur für die
-- angemeldete Person selbst und nur, solange sie aktiv ist. Höchstens 30 Tage gültig.
-- Abgelaufene Sitzungen der Person räumt sie dabei gleich mit weg. p_id_token: das ID-Token
-- aus dem Login, für id_token_hint beim Abmelden (optional).
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
