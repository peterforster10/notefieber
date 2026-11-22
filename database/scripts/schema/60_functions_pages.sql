-- =============================================================================
-- NoteFieber: Seitenbaum
-- Seiten anlegen, verschieben, in den Papierkorb legen und zurückholen.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abläufe: Seiten
-- =============================================================================

-- Seite anlegen. p_position kommt aus der App (npm-Paket "fractional-indexing");
-- NULL hängt die Seite hinter alle Geschwister (app.next_position).
-- SECURITY DEFINER, weil wiki_app Seiten und Inhalt nicht direkt einfügen darf.
CREATE FUNCTION app.create_page(
  p_space_id uuid, p_parent_id uuid, p_title text, p_actor_id uuid, p_position text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   uuid := uuidv7();
  v_pos    text := p_position;
BEGIN
  IF p_parent_id IS NULL THEN
    PERFORM app.require_space(p_space_id, p_actor_id, 'editor');
  ELSE
    PERFORM app.require_page(p_parent_id, p_actor_id, 'editor');
    IF NOT EXISTS (SELECT 1 FROM pages WHERE id = p_parent_id AND space_id = p_space_id
                   AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'create_page: Elternseite fehlt oder liegt in einem anderen Space';
    END IF;
  END IF;
  -- Erst nach der Sperre prüfen, ob die Elternseite gerade in den Papierkorb gewandert ist
  PERFORM app.lock_tree(p_space_id, false);
  IF EXISTS (SELECT 1 FROM pages WHERE id = p_parent_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'create_page: Die Elternseite liegt im Papierkorb';
  END IF;
  IF EXISTS (SELECT 1 FROM spaces WHERE id = p_space_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'create_page: Der Space ist archiviert';
  END IF;

  IF v_pos IS NULL THEN
    -- Über alle Geschwister, auch eingeschränkte und im Papierkorb (läuft als Eigentümer)
    v_pos := app.next_position((SELECT max(position COLLATE "C") FROM pages
                                WHERE space_id = p_space_id AND parent_id IS NOT DISTINCT FROM p_parent_id));
  END IF;

  INSERT INTO pages (id, tenant_id, space_id, parent_id, position, title, created_by, updated_by)
  VALUES (v_page, v_tenant, p_space_id, p_parent_id, v_pos, btrim(coalesce(p_title, '')), p_actor_id, p_actor_id);
  INSERT INTO page_contents (page_id, tenant_id, ydoc) VALUES (v_page, v_tenant, '\x0000'::bytea);

  PERFORM app.emit(v_tenant, p_space_id, 'page.created',
    jsonb_build_object('id', v_page, 'parent', p_parent_id, 'title', btrim(coalesce(p_title, '')),
                       'position', v_pos, 'by', p_actor_id));
  RETURN v_page;
END $$;

-- Seite (mit Teilbaum) verschieben, innerhalb desselben Spaces.
-- SECURITY DEFINER, weil der Teilbaum eingeschränkte Seiten enthalten kann, die die
-- handelnde Person nicht sieht; deren path muss trotzdem mitwandern.
-- Ändert sich dadurch, woher die Seite ihre Rechte hat (app.perm_source), gilt:
--   - Aus einer Seite mit eigenen Rechten heraus nur als Admin dieser Seite (sonst könnte
--     ein Editor eingeschränkte Inhalte für den ganzen Space freigeben).
--   - Hinein genügt editor auf dem Ziel.
--   - Es folgt page.permissions_changed, damit der Collab-Server Verbindungen neu prüft.
CREATE FUNCTION app.move_page(p_page_id uuid, p_new_parent_id uuid, p_position text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant     uuid := app.current_tenant();
  v_page       pages%ROWTYPE;
  v_parent     pages%ROWTYPE;
  v_new_path   ltree;
  v_old_source uuid;
  v_new_source uuid;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF p_position IS NULL OR p_position !~ '^[A-Za-z][0-9A-Za-z]{1,63}$' THEN
    RAISE EXCEPTION 'move_page: ungültige Position';
  END IF;
  -- Erst sperren, dann alles lesen und prüfen: Pfade und Rechte sind danach aktuell.
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_page.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'move_page: Seite liegt im Papierkorb';
  END IF;
  v_old_source := app.perm_source(p_page_id);

  IF p_new_parent_id IS NULL THEN
    PERFORM app.require_space(v_page.space_id, p_actor_id, 'editor');
    v_new_path := app.page_label(p_page_id);
    v_new_source := NULL;
  ELSE
    SELECT * INTO v_parent FROM pages WHERE id = p_new_parent_id AND tenant_id = v_tenant;
    IF NOT FOUND OR v_parent.space_id <> v_page.space_id THEN
      RAISE EXCEPTION 'move_page: Ziel liegt nicht im selben Space';
    END IF;
    IF v_parent.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'move_page: Ziel liegt im Papierkorb';
    END IF;
    IF v_parent.path <@ v_page.path THEN
      RAISE EXCEPTION 'move_page: Eine Seite kann nicht unter sich selbst verschoben werden';
    END IF;
    PERFORM app.require_page(p_new_parent_id, p_actor_id, 'editor');
    v_new_path := v_parent.path || app.page_label(p_page_id);
    v_new_source := app.perm_source(p_new_parent_id);
  END IF;

  -- Eine Seite mit eigenen Rechten bleibt ihre eigene Quelle, mitsamt erbender Unterseiten.
  IF NOT v_page.inherit_perms THEN
    v_new_source := v_old_source;
  END IF;
  IF v_old_source IS NOT NULL AND v_old_source IS DISTINCT FROM v_new_source
     AND app.page_rank(v_old_source, p_actor_id) < 4 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Die Seite verlässt einen Bereich mit eigenen Rechten, dafür ist dort die Rolle admin nötig';
  END IF;

  UPDATE pages
  SET path = v_new_path || CASE WHEN nlevel(path) > nlevel(v_page.path)
                                THEN subpath(path, nlevel(v_page.path)) ELSE ''::ltree END
  WHERE space_id = v_page.space_id AND path <@ v_page.path;
  UPDATE pages SET parent_id = p_new_parent_id, position = p_position,
                   updated_at = now(), updated_by = p_actor_id
  WHERE id = p_page_id;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.moved',
    jsonb_build_object('id', p_page_id, 'from_parent', v_page.parent_id,
                       'to_parent', p_new_parent_id, 'position', p_position));
  IF v_old_source IS DISTINCT FROM v_new_source THEN
    PERFORM app.emit(v_tenant, v_page.space_id, 'page.permissions_changed',
      jsonb_build_object('id', p_page_id, 'reason', 'moved',
                         'from_source', v_old_source, 'to_source', v_new_source));
  END IF;
  PERFORM app.audit(p_actor_id, 'page.moved', 'page', p_page_id,
    jsonb_build_object('from_parent', v_page.parent_id, 'to_parent', p_new_parent_id,
                       'from_source', v_old_source, 'to_source', v_new_source));
END $$;

-- Seite mit Teilbaum in den Papierkorb. Abgelehnt, wenn darunter eine Seite liegt,
-- die die handelnde Person nicht bearbeiten darf. Die Startseite bleibt.
CREATE FUNCTION app.trash_page(p_page_id uuid, p_actor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_count  integer;
BEGIN
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_page.deleted_at IS NOT NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM spaces WHERE home_page_id = p_page_id) THEN
    RAISE EXCEPTION 'trash_page: Die Startseite eines Spaces kann nicht gelöscht werden';
  END IF;
  IF EXISTS (SELECT 1 FROM pages
             WHERE space_id = v_page.space_id AND path <@ v_page.path AND deleted_at IS NULL
               AND app.page_rank(id, p_actor_id) < 3) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Unter dieser Seite liegen Seiten, die du nicht bearbeiten darfst';
  END IF;

  UPDATE pages SET deleted_at = now(), deleted_by = p_actor_id, trash_root_id = p_page_id
  WHERE space_id = v_page.space_id AND path <@ v_page.path AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.trashed',
    jsonb_build_object('id', p_page_id, 'count', v_count));
  PERFORM app.audit(p_actor_id, 'page.trashed', 'page', p_page_id, jsonb_build_object('count', v_count));
  RETURN v_count;
END $$;

-- Aus dem Papierkorb holen: genau die Seiten, die gemeinsam gelöscht wurden.
CREATE FUNCTION app.restore_page(p_page_id uuid, p_actor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_count  integer;
BEGIN
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_page.trash_root_id IS DISTINCT FROM p_page_id THEN
    RAISE EXCEPTION 'restore_page: Nur die Seite, die gelöscht wurde, lässt sich wiederherstellen';
  END IF;
  IF EXISTS (SELECT 1 FROM pages WHERE id = v_page.parent_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'restore_page: Zuerst die Elternseite wiederherstellen';
  END IF;

  UPDATE pages SET deleted_at = NULL, deleted_by = NULL, trash_root_id = NULL
  WHERE trash_root_id = p_page_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.restored',
    jsonb_build_object('id', p_page_id, 'count', v_count));
  PERFORM app.audit(p_actor_id, 'page.restored', 'page', p_page_id, jsonb_build_object('count', v_count));
  RETURN v_count;
END $$;

-- =============================================================================
-- Seitenbaum lesen
-- =============================================================================

-- Eine Ebene des Seitenbaums für die angemeldete Person (ROADMAP M2; ARCHITECTURE_REVIEW.md,
-- A-01): die Seiten, deren nächste sichtbare Vorfahrin p_parent_id ist (NULL = oberste Ebene).
-- Das sind die sichtbaren Kinder, dazu sichtbare Seiten tiefer unten, wenn alles dazwischen
-- für die Person unsichtbar ist (eine Seite mit eigenen Rechten unter einer, die sie nicht
-- sieht). So steht jede sichtbare Seite genau einmal im Baum, unter derselben Seite wie in der
-- Brotkrume. has_children sagt, ob die Ebene darunter etwas enthält.
--
-- Mengenbasiert statt page_rank pro Zeile: Sichtbarkeit ändert sich nur an Seiten mit eigenen
-- Rechten. Ein erbendes Kind ist sichtbar, wenn seine Elternseite es ist; unter einer
-- sichtbaren Seite kann also nur eine Seite mit eigenen Rechten unsichtbar sein (auf der
-- obersten Ebene auch eine erbende, wenn die Person auf dem Space keinen Rang hat). Die
-- Funktion rechnet deshalb den Rang der Elternseite einmal und den jeder Seite mit eigenen
-- Rechten im Teilbaum einmal (selten), nicht den jeder Seite. Dieselben Ergebnisse wie
-- page_rank (Test 56).
--
-- SECURITY DEFINER, weil sie unsichtbare Seiten durchsuchen muss; heraus kommen nur sichtbare.
-- parent_id ist die echte Elternseite (bei Seiten unter unsichtbaren eine ID ohne Titel).
-- Unsichtbare oder gelöschte Elternseite, fremder Space: leer.
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
