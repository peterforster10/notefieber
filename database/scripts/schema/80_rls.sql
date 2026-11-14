-- =============================================================================
-- NoteFieber: Row Level Security
-- Mandantentrennung, Leserechte und Bedingungen für direkte Schreibzugriffe von wiki_app.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Row Level Security
-- =============================================================================

-- 1. Mandantentrennung auf jeder Tabelle (für wiki_app und wiki_worker)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'workspaces', 'workspace_members', 'groups', 'group_members', 'invites',
    'spaces', 'pages', 'page_contents', 'page_versions', 'page_search', 'page_links',
    'grants', 'comments', 'files', 'imports', 'import_items', 'outbox', 'audit_log', 'sessions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app.current_tenant()) '
      'WITH CHECK (tenant_id = app.current_tenant())', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app.current_tenant()) WITH CHECK (id = app.current_tenant());

-- 2. Leserechte für Anfragen von Personen (nur wiki_app)
--    Seiten: mindestens viewer, nach Vererbung aufgelöst
CREATE POLICY read_access ON pages AS RESTRICTIVE FOR SELECT TO wiki_app
USING (app.page_rank(id) >= 1);

--    Spaces: Rolle im Space, oder mindestens eine lesbare Seite darin (für die Brotkrume)
CREATE POLICY read_access ON spaces AS RESTRICTIVE FOR SELECT TO wiki_app
USING (app.space_rank(id) >= 1 OR EXISTS (SELECT 1 FROM pages p WHERE p.space_id = spaces.id));

--    Alles, was an einer Seite hängt, ist nur mit ihr sichtbar
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['page_contents', 'page_versions', 'page_search', 'comments']
  LOOP
    EXECUTE format(
      'CREATE POLICY read_access ON %I AS RESTRICTIVE FOR SELECT TO wiki_app '
      'USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = %I.page_id))', t, t);
  END LOOP;
END $$;

--    Verlinkungen: nur, wenn beide Seiten lesbar sind (sonst verrät der Titel etwas)
CREATE POLICY read_access ON page_links AS RESTRICTIVE FOR SELECT TO wiki_app
USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = page_links.from_page_id)
   AND EXISTS (SELECT 1 FROM pages p WHERE p.id = page_links.to_page_id));

--    Rechte: sichtbar, wer das Objekt lesen darf
CREATE POLICY read_access ON grants AS RESTRICTIVE FOR SELECT TO wiki_app
USING ((space_id IS NOT NULL AND app.space_rank(space_id) >= 1)
    OR (page_id IS NOT NULL AND app.page_rank(page_id) >= 1));

--    Dateien: an lesbaren Seiten, eigene Uploads oder Profilbilder (nie ein Anhang, auch
--    wenn jemand ihn als Profilbild einträgt)
CREATE POLICY read_access ON files AS RESTRICTIVE FOR SELECT TO wiki_app
USING (
  uploaded_by = app.current_user_id()
  OR (page_id IS NOT NULL AND EXISTS (SELECT 1 FROM pages p WHERE p.id = files.page_id))
  OR (page_id IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.avatar_file_id = files.id))
);

--    Audit-Log: nur Organisations-Admins
CREATE POLICY read_access ON audit_log AS RESTRICTIVE FOR SELECT TO wiki_app
USING (app.is_org_admin(app.current_user_id()));

--    Sitzungen: nur die eigenen (z. B. für eine Liste „Angemeldete Geräte“)
CREATE POLICY read_access ON sessions AS RESTRICTIVE FOR SELECT TO wiki_app
USING (user_id = app.current_user_id());

--    Importe: eigene oder als Space-Admin
CREATE POLICY read_access ON imports AS RESTRICTIVE FOR SELECT TO wiki_app
USING (created_by = app.current_user_id() OR app.space_rank(space_id) = 4);
CREATE POLICY read_access ON import_items AS RESTRICTIVE FOR SELECT TO wiki_app
USING (EXISTS (SELECT 1 FROM imports i WHERE i.id = import_items.import_id));

-- 3. Direkte Schreibzugriffe von wiki_app (siehe Abschnitt Rechte: nur diese Tabellen
--    und Spalten). Alles andere läuft über die Funktionen oben.
--    Personen: anlegen nie direkt, neue Personen kommen nur über Einladungen
--    (app.accept_invite) oder app.create_tenant; ändern nur das eigene Profil oder als
--    Organisations-Admin. Profilbild nur eine eigene Datei ohne Seite. Rolle und
--    Deaktivieren: app.set_user_role, app.set_user_active.
CREATE POLICY write_update ON users AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (id = app.current_user_id() OR app.is_org_admin(app.current_user_id()))
WITH CHECK (avatar_file_id IS NULL OR EXISTS (
  SELECT 1 FROM files f WHERE f.id = users.avatar_file_id AND f.page_id IS NULL AND f.uploaded_by = users.id));

--    Workspaces: anlegen nur Organisations-Admins, ändern auch Owner und Admins
CREATE POLICY write_insert ON workspaces AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (app.is_org_admin(app.current_user_id()));
CREATE POLICY write_update ON workspaces AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (app.is_workspace_admin(id, app.current_user_id()));

--    Einladungen: nur wer den Workspace verwaltet, eingeladen wird im eigenen Namen
CREATE POLICY write_access ON invites AS RESTRICTIVE FOR ALL TO wiki_app
USING (app.is_workspace_admin(workspace_id, app.current_user_id()))
WITH CHECK (app.is_workspace_admin(workspace_id, app.current_user_id()));
CREATE POLICY write_insert ON invites AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (invited_by = app.current_user_id());

--    Dateien: Upload im eigenen Namen, ungeprüft (scan_status setzt der Worker), an einer
--    Seite nur als editor. Löschen (deleted_at) durch Hochladende oder Editoren der Seite.
CREATE POLICY write_insert ON files AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (uploaded_by = app.current_user_id() AND scan_status = 'pending'
            AND (page_id IS NULL OR app.page_rank(page_id) >= 3));
CREATE POLICY write_update ON files AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (uploaded_by = app.current_user_id() OR (page_id IS NOT NULL AND app.page_rank(page_id) >= 3));

