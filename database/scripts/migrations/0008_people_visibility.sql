-- =============================================================================
-- Migration 0008: Wer sieht welche Personen, Workspaces und Gruppen (REVIEW.md, R-03)
-- Bisher sah jede angemeldete Person alle Personen des Mandanten samt E-Mail, alle Gruppen,
-- Gruppenmitglieder, Workspaces und Mitgliedschaften, auch Gäste (E18 verlangt das
-- Gegenteil). Jetzt nur aus Workspaces, in denen man selbst Mitglied ist (nicht nur Gast),
-- dazu immer man selbst; Organisations-Admins sehen alle; Gruppen nur, wer irgendwo
-- Mitglied ist. Vor dem Login (ohne Person im Kontext) findet die API die Person über
-- app.resolve_login. Gleicher Text wie in schema/20_functions_base.sql,
-- schema/40_functions_tenants.sql und schema/80_rls.sql (geprüft von
-- schema_migrations_test.sh); Rechte wie in schema/90_privileges.sql. Dazu die Regel zum
-- Ändern einer Person: Profilbild über app.is_own_avatar (sonst ein Kreis zwischen den Regeln).
-- =============================================================================

CREATE FUNCTION app.member_workspaces() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(wm.workspace_id), '{}')
  FROM workspace_members wm
  JOIN users u ON u.id = wm.user_id AND u.deactivated_at IS NULL
  WHERE wm.user_id = app.current_user_id() AND wm.tenant_id = app.current_tenant() AND wm.role <> 'guest'
$$;

CREATE FUNCTION app.is_own_avatar(p_file_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM files f
                 WHERE f.id = p_file_id AND f.tenant_id = app.current_tenant()
                   AND f.page_id IS NULL AND f.uploaded_by = p_user_id)
$$;

CREATE FUNCTION app.resolve_login(p_idp_subject text)
RETURNS TABLE (user_id uuid, deactivated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.id, u.deactivated_at FROM users u
  WHERE u.tenant_id = app.current_tenant() AND u.idp_subject = p_idp_subject
$$;

GRANT EXECUTE ON FUNCTION app.member_workspaces(), app.is_own_avatar(uuid, uuid), app.resolve_login(text)
  TO wiki_app, wiki_worker;

CREATE POLICY read_access ON users AS RESTRICTIVE FOR SELECT TO wiki_app
USING (id = app.current_user_id()
       OR (SELECT app.is_org_admin(app.current_user_id()))
       OR EXISTS (SELECT 1 FROM workspace_members wm
                  WHERE wm.user_id = users.id AND wm.workspace_id IN (SELECT unnest(app.member_workspaces()))));
CREATE POLICY read_access ON workspaces AS RESTRICTIVE FOR SELECT TO wiki_app
USING ((SELECT app.is_org_admin(app.current_user_id()))
       OR EXISTS (SELECT 1 FROM workspace_members wm
                  WHERE wm.workspace_id = workspaces.id AND wm.user_id = app.current_user_id()));
CREATE POLICY read_access ON workspace_members AS RESTRICTIVE FOR SELECT TO wiki_app
USING (user_id = app.current_user_id()
       OR (SELECT app.is_org_admin(app.current_user_id()))
       OR workspace_id IN (SELECT unnest(app.member_workspaces())));
CREATE POLICY read_access ON groups AS RESTRICTIVE FOR SELECT TO wiki_app
USING ((SELECT app.is_org_admin(app.current_user_id()))
       OR cardinality((SELECT app.member_workspaces())) > 0);
CREATE POLICY read_access ON group_members AS RESTRICTIVE FOR SELECT TO wiki_app
USING ((SELECT app.is_org_admin(app.current_user_id()))
       OR cardinality((SELECT app.member_workspaces())) > 0);

-- Profilbild prüfen über app.is_own_avatar statt einer Unterabfrage auf files: Die Leseregel
-- auf files liest users, mit der neuen Leseregel auf users wäre das ein Kreis.
DROP POLICY write_update ON users;
CREATE POLICY write_update ON users AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (id = app.current_user_id() OR app.is_org_admin(app.current_user_id()))
WITH CHECK (avatar_file_id IS NULL OR app.is_own_avatar(avatar_file_id, id));
