-- =============================================================================
-- NoteFieber: Rechte an Schemas, Funktionen und Tabellen
-- Wer welche Funktion aufrufen und welche Tabelle direkt lesen oder schreiben darf.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- Rechte
-- =============================================================================
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
-- Auch künftige Funktionen (Migrationen von wiki_owner) sind nicht von selbst ausführbar,
-- sondern werden ausdrücklich an wiki_app bzw. wiki_worker freigegeben. Global statt
-- IN SCHEMA app: Ein REVOKE pro Schema hebt das globale EXECUTE für PUBLIC nicht auf.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app TO wiki_app, wiki_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO wiki_app, wiki_worker;

-- Interne Bausteine: nur aus Funktionen heraus, die als Eigentümer laufen, bzw. vom Worker.
-- Sonst könnte wiki_app Events und Audit-Einträge fälschen, Versionen ohne Prüfung anlegen
-- oder die Rechte anderer Personen abfragen.
REVOKE EXECUTE ON FUNCTION
  app.emit(uuid, uuid, text, jsonb),
  app.emit_user_spaces(uuid, uuid, text, jsonb),
  app.audit(uuid, text, text, uuid, jsonb),
  app.insert_version(uuid, text, uuid, integer),
  app.lock_tree(uuid, boolean),
  app.page_rank(uuid, uuid),
  app.space_rank(uuid, uuid),
  app.grant_rank(uuid, uuid, uuid, text),
  app.space_ws_role(uuid, uuid),
  app.has_admin(uuid),
  app.perm_source(uuid)
FROM wiki_app;

-- wiki_app: Lesen, was die Regeln freigeben. Die Outbox liest nur der Worker.
GRANT SELECT ON
  tenants, users, workspaces, workspace_members, groups, group_members, invites,
  spaces, pages, page_contents, page_versions, page_search, page_links, grants, comments,
  files, imports, import_items, audit_log
TO wiki_app;

-- wiki_app: direkt schreiben nur hier, jeweils durch die Regeln oben abgesichert.
-- Rechte, Mitgliedschaften, Gruppen, Spaces, Seitenbaum, Inhalt, Versionen, Kommentare,
-- Import, Suchindex, Verlinkungen, Outbox und Audit-Log nur über Funktionen.
GRANT INSERT ON users TO wiki_app;
GRANT UPDATE (display_name, locale, time_zone, avatar_file_id) ON users TO wiki_app;
GRANT INSERT, UPDATE (slug, name, archived_at) ON workspaces TO wiki_app;
GRANT INSERT, UPDATE, DELETE ON invites TO wiki_app;
GRANT INSERT, UPDATE (deleted_at) ON files TO wiki_app;

-- wiki_worker: Collab-Server, Suchindex, Import, Outbox. Unterliegt nur der Mandantentrennung.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, workspaces, workspace_members, groups, group_members, invites,
  spaces, page_contents, page_versions, page_search, page_links, grants, comments,
  files, imports, import_items
TO wiki_worker;
-- pages: path, parent_id, space_id und Papierkorb ändern nur die Funktionen
GRANT SELECT, INSERT ON pages TO wiki_worker;
GRANT UPDATE (title, position, inherit_perms, updated_at, updated_by) ON pages TO wiki_worker;
GRANT DELETE ON pages TO wiki_worker;                       -- endgültiges Löschen aus dem Papierkorb
GRANT SELECT, INSERT, UPDATE ON outbox TO wiki_worker;      -- Worker veröffentlicht Events
GRANT SELECT, INSERT ON audit_log TO wiki_worker;           -- nur Anfügen
