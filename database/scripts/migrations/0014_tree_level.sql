-- =============================================================================
-- Migration 0014: Seitenbaum ebenenweise und Space verwalten (ROADMAP M2; ARCHITECTURE_REVIEW.md,
-- A-01; E05, E06)
--   - Index pages_restricted: Seiten mit eigenen Rechten pro Space
--   - app.tree_level: eine Ebene des Seitenbaums für die angemeldete Person, mengenbasiert
--     statt page_rank pro Zeile; jede sichtbare Seite steht unter ihrer nächsten sichtbaren
--     Vorfahrin
--   - app.can_manage_space: darf die angemeldete Person den Space archivieren (auch im
--     archivierten Space, wo space_role nur viewer meldet); app.archive_space nutzt sie
-- Gleicher Text wie in schema/10_tables.sql, schema/50_functions_spaces.sql und
-- schema/60_functions_pages.sql (geprüft von schema_migrations_test.sh). archive_space behält
-- seine Rechte (CREATE OR REPLACE); die neuen Funktionen gibt diese Migration frei wie
-- schema/90_privileges.sql (alle Funktionen in app für wiki_app und wiki_worker).
-- =============================================================================

CREATE INDEX pages_restricted ON pages (space_id) WHERE NOT inherit_perms;

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

CREATE OR REPLACE FUNCTION app.archive_space(p_space_id uuid, p_archived boolean, p_actor_id uuid)
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

CREATE FUNCTION app.tree_level(p_space_id uuid, p_parent_id uuid)
RETURNS TABLE (id uuid, parent_id uuid, "position" text, title text, inherit_perms boolean,
               role text, has_children boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_user    uuid := app.current_user_id();
  v_ws_role text;
  v_parent  pages%ROWTYPE;
  v_base    integer;            -- Rang der Elternseite (oberste Ebene: des Spaces)
  v_depth   integer := 0;       -- Tiefe der Elternseite im Pfad
  v_cap     integer := 4;       -- archivierte Spaces: höchstens viewer
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;
  v_ws_role := app.space_ws_role(p_space_id, v_user);   -- prüft auch den Mandanten
  IF v_ws_role IS NULL THEN RETURN; END IF;
  IF (SELECT s.archived_at IS NOT NULL FROM spaces s WHERE s.id = p_space_id) THEN v_cap := 1; END IF;

  IF p_parent_id IS NULL THEN
    v_base := app.grant_rank(p_space_id, NULL, v_user, v_ws_role);
  ELSE
    SELECT * INTO v_parent FROM pages p
    WHERE p.id = p_parent_id AND p.space_id = p_space_id AND p.tenant_id = v_tenant AND p.deleted_at IS NULL;
    IF NOT FOUND THEN RETURN; END IF;
    v_base := app.page_rank(p_parent_id, v_user);
    IF v_base < 1 THEN RETURN; END IF;
    v_depth := nlevel(v_parent.path);
  END IF;

  RETURN QUERY
  WITH r AS MATERIALIZED (
    -- Seiten mit eigenen Rechten unter der Elternseite, jede mit ihrem Rang
    SELECT p.id, p.path, app.grant_rank(NULL, p.id, v_user, v_ws_role) AS rank
    FROM pages p
    WHERE p.space_id = p_space_id AND p.tenant_id = v_tenant AND NOT p.inherit_perms AND p.deleted_at IS NULL
      AND (p_parent_id IS NULL OR (p.path <@ v_parent.path AND p.id <> p_parent_id))
  ), lvl AS (
    -- direkte Kinder: erbende mit dem Rang der Elternseite, sonst mit ihrem eigenen
    SELECT c.id, CASE WHEN c.inherit_perms THEN v_base ELSE (SELECT r.rank FROM r WHERE r.id = c.id) END AS rank
    FROM pages c
    WHERE c.space_id = p_space_id AND c.tenant_id = v_tenant AND c.deleted_at IS NULL
      AND (c.parent_id = p_parent_id OR (p_parent_id IS NULL AND c.parent_id IS NULL))
    UNION ALL
    -- tiefer: sichtbare Seiten mit eigenen Rechten, wenn alles dazwischen unsichtbar ist. Die
    -- erste Seite darunter ist unsichtbar (eigene Rechte ohne Rang, oder erbend ohne Rang der
    -- Elternseite), und keine Seite mit eigenen Rechten dazwischen ist sichtbar.
    SELECT x.id, x.rank FROM r x
    WHERE x.rank > 0 AND nlevel(x.path) > v_depth + 1
      AND (v_base = 0 OR EXISTS (SELECT 1 FROM r f
                                 WHERE f.id = ltree2text(subltree(x.path, v_depth, v_depth + 1))::uuid))
      AND NOT EXISTS (SELECT 1 FROM r y WHERE y.rank > 0 AND y.path @> x.path AND y.id <> x.id)
  )
  SELECT p.id, p.parent_id, p.position, p.title, p.inherit_perms,
         app.rank_role(least(l.rank, v_cap)),
         -- erbende Kinder sind sichtbar wie die Seite selbst; sonst zählt jede sichtbare Seite
         -- mit eigenen Rechten darunter (sie oder eine Vorfahrin steht in der Ebene darunter)
         EXISTS (SELECT 1 FROM pages c
                 WHERE c.space_id = p_space_id AND c.parent_id = p.id AND c.inherit_perms AND c.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM r y WHERE y.rank > 0 AND y.path <@ p.path AND y.id <> p.id)
  FROM lvl l
  JOIN pages p ON p.id = l.id
  WHERE l.rank > 0
  ORDER BY p.position, p.id;
END $$;

GRANT EXECUTE ON FUNCTION app.can_manage_space(uuid), app.tree_level(uuid, uuid) TO wiki_app, wiki_worker;
