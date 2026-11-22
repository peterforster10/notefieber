-- =============================================================================
-- NoteFieber: Spaces und Rechte
-- Spaces anlegen, ändern, archivieren; Rechte setzen; Vererbung kappen.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abläufe: Spaces und Rechte
-- =============================================================================

-- Space + Startseite + Ersteller als Space-Admin.
-- p_workspace_access: Rolle für alle Workspace-Mitglieder (ohne Gäste), NULL = keine.
-- SECURITY DEFINER, weil wiki_app Spaces, Grants und Seiten nicht direkt schreiben darf.
CREATE FUNCTION app.create_space(
  p_workspace_id uuid, p_key text, p_name text, p_actor_id uuid,
  p_workspace_access text DEFAULT 'viewer', p_description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_space  uuid := uuidv7();
  v_home   uuid := uuidv7();
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM workspace_members
                 WHERE workspace_id = p_workspace_id AND user_id = p_actor_id
                   AND tenant_id = v_tenant AND role <> 'guest') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Workspace-Mitglieder (ohne Gäste) dürfen Spaces anlegen';
  END IF;
  IF p_workspace_access IS NOT NULL AND p_workspace_access NOT IN ('viewer', 'commenter', 'editor') THEN
    RAISE EXCEPTION 'create_space: ungültiger Zugriff für den Workspace: %', p_workspace_access;
  END IF;

  -- Kein RETURNING: Der neue Space ist erst nach dem Grant lesbar.
  INSERT INTO spaces (id, tenant_id, workspace_id, key, name, description, created_by)
  VALUES (v_space, v_tenant, p_workspace_id, upper(btrim(p_key)), btrim(p_name), p_description, p_actor_id);
  INSERT INTO grants (tenant_id, space_id, subject_type, user_id, role, created_by)
  VALUES (v_tenant, v_space, 'user', p_actor_id, 'admin', p_actor_id);
  IF p_workspace_access IS NOT NULL THEN
    INSERT INTO grants (tenant_id, space_id, subject_type, role, created_by)
    VALUES (v_tenant, v_space, 'workspace', p_workspace_access, p_actor_id);
  END IF;

  INSERT INTO pages (id, tenant_id, space_id, position, title, created_by, updated_by)
  VALUES (v_home, v_tenant, v_space, 'a0', btrim(p_name), p_actor_id, p_actor_id);
  INSERT INTO page_contents (page_id, tenant_id, ydoc) VALUES (v_home, v_tenant, '\x0000'::bytea);
  UPDATE spaces SET home_page_id = v_home WHERE id = v_space;

  PERFORM app.emit(v_tenant, v_space, 'space.created',
    jsonb_build_object('id', v_space, 'key', upper(btrim(p_key)), 'name', btrim(p_name), 'home_page', v_home));
  PERFORM app.audit(p_actor_id, 'space.created', 'space', v_space);
  RETURN v_space;
END $$;

-- Recht setzen oder entfernen (p_role NULL). Auf Seiten nur mit gekappter Vererbung.
-- Erlaubt für Admins des Objekts, Space-Admins und Organisations-Admins (Wiederherstellung).
-- SECURITY DEFINER, weil Space- und Organisations-Admins eingeschränkte Seiten nicht sehen müssen.
CREATE FUNCTION app.set_grant(
  p_space_id uuid, p_page_id uuid, p_subject_type text, p_user_id uuid, p_group_id uuid,
  p_role text, p_actor_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant   uuid := app.current_tenant();
  v_space    uuid := p_space_id;
  v_page     pages%ROWTYPE;
  v_allowed  boolean;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF (p_space_id IS NULL) = (p_page_id IS NULL) THEN
    RAISE EXCEPTION 'set_grant: genau ein Space oder eine Seite angeben';
  END IF;
  IF p_role IS NOT NULL AND app.role_rank(p_role) = 0 THEN
    RAISE EXCEPTION 'set_grant: ungültige Rolle %', p_role;
  END IF;
  IF p_subject_type = 'workspace' AND p_role = 'admin' THEN
    RAISE EXCEPTION 'set_grant: Alle im Workspace können nicht Admin sein, Admins namentlich oder als Gruppe vergeben';
  END IF;

  -- Objekt sperren: Zwei Admins, die sich gleichzeitig gegenseitig entfernen, laufen
  -- nacheinander, und der zweite scheitert an der Prüfung unten.
  IF p_page_id IS NOT NULL THEN
    SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'set_grant: Seite nicht gefunden'; END IF;
    IF v_page.inherit_perms THEN
      RAISE EXCEPTION 'set_grant: Die Seite erbt ihre Rechte, zuerst die Vererbung kappen';
    END IF;
    v_space := v_page.space_id;
    v_allowed := app.page_rank(p_page_id, p_actor_id) = 4;
  ELSE
    PERFORM 1 FROM spaces WHERE id = p_space_id AND tenant_id = v_tenant FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'set_grant: Space nicht gefunden';
    END IF;
    v_allowed := false;
  END IF;
  v_allowed := v_allowed OR app.space_rank(v_space, p_actor_id) = 4 OR app.is_org_admin(p_actor_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen Rechte ändern';
  END IF;

  -- Nur beim Vergeben: Grants deaktivierter oder entfernter Personen lassen sich löschen.
  IF p_role IS NOT NULL AND p_subject_type = 'user' AND app.space_ws_role(v_space, p_user_id) IS NULL THEN
    RAISE EXCEPTION 'set_grant: Person ist kein aktives Mitglied des Workspaces';
  END IF;

  DELETE FROM grants
  WHERE tenant_id = v_tenant
    AND coalesce(space_id, page_id) = coalesce(p_space_id, p_page_id)
    AND subject_type = p_subject_type
    AND user_id IS NOT DISTINCT FROM p_user_id AND group_id IS NOT DISTINCT FROM p_group_id;
  IF p_role IS NOT NULL THEN
    INSERT INTO grants (tenant_id, space_id, page_id, subject_type, user_id, group_id, role, created_by)
    VALUES (v_tenant, p_space_id, p_page_id, p_subject_type, p_user_id, p_group_id, p_role, p_actor_id);
  END IF;

  -- Sofort prüfen (verständlicher Fehler); der Trigger admin_remains prüft beim Commit noch einmal.
  IF NOT app.has_admin(coalesce(p_space_id, p_page_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Mindestens ein aktiver Admin muss bleiben';
  END IF;

  PERFORM app.emit(v_tenant, v_space, 'grant.changed',
    jsonb_build_object('space', p_space_id, 'page', p_page_id, 'subject_type', p_subject_type,
                       'user', p_user_id, 'group', p_group_id, 'role', p_role));
  PERFORM app.audit(p_actor_id, 'grant.changed', CASE WHEN p_page_id IS NULL THEN 'space' ELSE 'page' END,
    coalesce(p_space_id, p_page_id),
    jsonb_build_object('subject_type', p_subject_type, 'user_id', p_user_id,
                       'group_id', p_group_id, 'role', p_role));
END $$;

-- Vererbung kappen oder wiederherstellen. Beim Kappen werden die bisher geltenden
-- Rechte auf die Seite kopiert und die handelnde Person wird Admin der Seite.
-- Danach lassen sich die Rechte mit app.set_grant einschränken.
CREATE FUNCTION app.set_page_inheritance(p_page_id uuid, p_inherit boolean, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_source uuid;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  -- Baum exklusiv sperren: move_page berechnet die Rechtequelle aus inherit_perms.
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'set_page_inheritance: Seite nicht gefunden'; END IF;
  IF v_page.inherit_perms = p_inherit THEN RETURN; END IF;
  IF NOT (app.page_rank(p_page_id, p_actor_id) = 4
          OR app.space_rank(v_page.space_id, p_actor_id) = 4
          OR app.is_org_admin(p_actor_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen die Vererbung ändern';
  END IF;

  IF NOT p_inherit THEN
    -- Bisher geltende Quelle: nächste eingeschränkte Seite oberhalb oder der Space
    SELECT id INTO v_source FROM pages
    WHERE space_id = v_page.space_id AND path @> v_page.path AND id <> p_page_id AND NOT inherit_perms
    ORDER BY nlevel(path) DESC LIMIT 1;

    INSERT INTO grants (tenant_id, page_id, subject_type, user_id, group_id, role, created_by)
    SELECT v_tenant, p_page_id, g.subject_type, g.user_id, g.group_id, g.role, p_actor_id
    FROM grants g
    WHERE (v_source IS NULL AND g.space_id = v_page.space_id) OR g.page_id = v_source;

    DELETE FROM grants WHERE page_id = p_page_id AND subject_type = 'user' AND user_id = p_actor_id;
    INSERT INTO grants (tenant_id, page_id, subject_type, user_id, role, created_by)
    VALUES (v_tenant, p_page_id, 'user', p_actor_id, 'admin', p_actor_id);
  ELSE
    DELETE FROM grants WHERE page_id = p_page_id;
  END IF;

  UPDATE pages SET inherit_perms = p_inherit WHERE id = p_page_id;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.permissions_changed',
    jsonb_build_object('id', p_page_id, 'inherit', p_inherit));
  PERFORM app.audit(p_actor_id, CASE WHEN p_inherit THEN 'page.inheritance_restored'
                                     ELSE 'page.inheritance_cut' END, 'page', p_page_id);
END $$;

-- Name und Beschreibung eines Spaces ändern (Space-Admins).
CREATE FUNCTION app.update_space(p_space_id uuid, p_name text, p_description text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_space(p_space_id, p_actor_id, 'admin');
  UPDATE spaces SET name = btrim(p_name), description = p_description
  WHERE id = p_space_id AND tenant_id = v_tenant;
  PERFORM app.emit(v_tenant, p_space_id, 'space.updated',
    jsonb_build_object('id', p_space_id, 'name', btrim(p_name)));
  PERFORM app.audit(p_actor_id, 'space.updated', 'space', p_space_id);
END $$;

-- Darf die angemeldete Person diesen Space archivieren und zurückholen? Space-Admins über
-- ihre Grants (ohne die Kappung im archivierten Space, wo space_rank höchstens viewer meldet)
-- und Organisations-Admins. Für app.archive_space und die API (Knopf „Zurückholen“).
CREATE FUNCTION app.can_manage_space(p_space_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_user    uuid := app.current_user_id();
  v_ws_role text;
BEGIN
  IF v_user IS NULL
     OR NOT EXISTS (SELECT 1 FROM spaces WHERE id = p_space_id AND tenant_id = app.current_tenant()) THEN
    RETURN false;
  END IF;
  IF app.is_org_admin(v_user) THEN RETURN true; END IF;
  v_ws_role := app.space_ws_role(p_space_id, v_user);
  RETURN v_ws_role IS NOT NULL AND app.grant_rank(p_space_id, NULL, v_user, v_ws_role) = 4;
END $$;

-- Space archivieren (nur noch lesbar) oder zurückholen. Erlaubt für Space-Admins (auch
-- im archivierten Space, dort gilt sonst höchstens viewer) und Organisations-Admins.
-- space.archived lässt den Collab-Server offene Verbindungen schreibgeschützt neu aufbauen.
CREATE FUNCTION app.archive_space(p_space_id uuid, p_archived boolean, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
BEGIN
  PERFORM app.require_actor(p_actor_id);   -- danach ist p_actor_id die angemeldete Person
  IF NOT app.can_manage_space(p_space_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen einen Space archivieren';
  END IF;

  UPDATE spaces SET archived_at = CASE WHEN p_archived THEN now() END
  WHERE id = p_space_id AND tenant_id = v_tenant AND (archived_at IS NOT NULL) <> p_archived;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM app.emit(v_tenant, p_space_id, 'space.archived',
    jsonb_build_object('id', p_space_id, 'archived', p_archived));
  PERFORM app.audit(p_actor_id, CASE WHEN p_archived THEN 'space.archived' ELSE 'space.unarchived' END,
                    'space', p_space_id);
END $$;

-- „Ansehen als …“: Wie sieht eine Person (p_user_id) diesen Space? Prüfwerkzeug, z. B. nach
-- einem Import. Die API darf page_rank(seite, person) bewusst nicht aufrufen; diese Funktion
-- gibt dieselbe Rolle heraus, aber nur unter diesen Bedingungen:
--   - Aufrufen dürfen Admins des Spaces (über ihre Grants, auch im archivierten Space) und
--     Organisations-Admins.
--   - Nur Struktur und Rolle (Titel, Pfad, Position, eigene Rechte ja/nein), keine Inhalte.
--     Seiten, die die Person nicht lesen darf, stehen mit role = NULL drin.
--   - Seiten mit eigenen Rechten, auf denen die handelnde Person nicht Admin ist, fehlen samt
--     ihren erbenden Unterseiten: Wer sie nicht verwaltet, erfährt auch hier nichts über sie.
--   - Seiten im Papierkorb fehlen.
--   - Jeder Aufruf steht im Audit-Log (space.viewed_as).
-- Den Baum baut die App daraus mit ORDER BY position, page_id; für die Suche filtert sie ihre
-- Treffer auf die Seiten mit Rolle.
CREATE FUNCTION app.view_as(p_space_id uuid, p_user_id uuid, p_actor_id uuid)
RETURNS TABLE (page_id uuid, parent_id uuid, path ltree, "position" text, title text,
               inherit_perms boolean, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_ws_role text;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id = p_space_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'view_as: Space nicht gefunden';
  END IF;
  v_ws_role := app.space_ws_role(p_space_id, p_actor_id);
  IF NOT ((v_ws_role IS NOT NULL AND app.grant_rank(p_space_id, NULL, p_actor_id, v_ws_role) = 4)
          OR app.is_org_admin(p_actor_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins des Spaces dürfen ansehen, was andere sehen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id AND u.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'view_as: Person nicht gefunden';
  END IF;

  PERFORM app.audit(p_actor_id, 'space.viewed_as', 'space', p_space_id,
                    jsonb_build_object('user_id', p_user_id));

  RETURN QUERY
  SELECT p.id, p.parent_id, p.path, p.position, p.title, p.inherit_perms,
         app.rank_role(app.page_rank(p.id, p_user_id))
  FROM pages p
  CROSS JOIN LATERAL (SELECT app.perm_source(p.id) AS source) src
  WHERE p.space_id = p_space_id AND p.tenant_id = v_tenant AND p.deleted_at IS NULL
    AND (src.source IS NULL
         OR (v_ws_role IS NOT NULL AND app.grant_rank(NULL, src.source, p_actor_id, v_ws_role) = 4))
  ORDER BY p.position, p.id;
END $$;
