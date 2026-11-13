-- =============================================================================
-- Migration 0004: Wirksamer Admin nur mit Mitgliedschaft im Workspace (REVIEW.md, R-01)
-- app.has_admin zählt nur noch Personen (direkt oder über eine Gruppe), die aktiv und
-- Mitglied im Workspace des Spaces sind; Gruppen gelten für den ganzen Mandanten, Zugriff
-- gibt es aber nur über den Workspace. app.remove_workspace_member prüft deshalb auch die
-- Spaces und Seiten, auf denen eine Gruppe der Person Admin ist. Gleicher Text wie in
-- schema/20_functions_base.sql und schema/40_functions_tenants.sql (geprüft von
-- schema_migrations_test.sh). Die Rechte an den Funktionen bleiben (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION app.has_admin(p_object_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH ws AS (
    SELECT s.workspace_id FROM spaces s WHERE s.id = p_object_id
    UNION ALL
    SELECT s.workspace_id FROM pages p JOIN spaces s ON s.id = p.space_id WHERE p.id = p_object_id)
  SELECT EXISTS (
    SELECT 1 FROM grants g CROSS JOIN ws
    WHERE coalesce(g.space_id, g.page_id) = p_object_id AND g.role = 'admin'
      AND EXISTS (
        SELECT 1 FROM users u
        JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ws.workspace_id
        WHERE u.deactivated_at IS NULL
          AND (   (g.subject_type = 'user' AND u.id = g.user_id)
               OR (g.subject_type = 'group' AND u.id IN (
                     SELECT gm.user_id FROM group_members gm WHERE gm.group_id = g.group_id)))))
$$;

CREATE OR REPLACE FUNCTION app.remove_workspace_member(p_workspace_id uuid, p_user_id uuid, p_actor_id uuid)
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
