-- =============================================================================
-- NoteFieber: Kommentare
-- Kommentare anlegen, bearbeiten, erledigen, löschen.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abläufe: Kommentare
-- =============================================================================

-- Kommentare schreibt wiki_app nur über diese Funktionen (SECURITY DEFINER, Rechte und
-- Mandant werden ausdrücklich geprüft).
CREATE FUNCTION app.add_comment(
  p_page_id uuid, p_body text, p_actor_id uuid, p_anchor jsonb DEFAULT NULL, p_parent_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_comment uuid := uuidv7();
  v_space   uuid;
BEGIN
  PERFORM app.require_page(p_page_id, p_actor_id, 'commenter');
  IF EXISTS (SELECT 1 FROM pages WHERE id = p_page_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'add_comment: Die Seite liegt im Papierkorb';
  END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM comments WHERE id = p_parent_id AND page_id = p_page_id AND tenant_id = v_tenant
         AND parent_id IS NULL) THEN
    RAISE EXCEPTION 'add_comment: Antworten nur auf Kommentare derselben Seite, eine Ebene tief';
  END IF;
  SELECT space_id INTO v_space FROM pages WHERE id = p_page_id AND tenant_id = v_tenant;

  INSERT INTO comments (id, tenant_id, page_id, parent_id, author_id, body, anchor)
  VALUES (v_comment, v_tenant, p_page_id, p_parent_id, p_actor_id, p_body,
          CASE WHEN p_parent_id IS NULL THEN p_anchor END);

  -- Eine Antwort öffnet einen erledigten Thread wieder
  IF p_parent_id IS NOT NULL THEN
    UPDATE comments SET resolved_at = NULL, resolved_by = NULL
    WHERE id = p_parent_id AND resolved_at IS NOT NULL;
  END IF;

  PERFORM app.emit(v_tenant, v_space, 'comment.created',
    jsonb_build_object('id', v_comment, 'page', p_page_id, 'parent', p_parent_id, 'author', p_actor_id));
  RETURN v_comment;
END $$;

CREATE FUNCTION app.set_comment_resolved(p_comment_id uuid, p_actor_id uuid, p_resolved boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_c comments%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM comments WHERE id = p_comment_id AND tenant_id = app.current_tenant();
  IF NOT FOUND THEN RAISE EXCEPTION 'set_comment_resolved: Kommentar nicht gefunden'; END IF;
  IF v_c.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'set_comment_resolved: Nur ganze Threads lassen sich erledigen';
  END IF;
  PERFORM app.require_page(v_c.page_id, p_actor_id, 'commenter');
  UPDATE comments
  SET resolved_at = CASE WHEN p_resolved THEN now() END,
      resolved_by = CASE WHEN p_resolved THEN p_actor_id END
  WHERE id = p_comment_id;
END $$;

-- Eigenen Kommentar bearbeiten (mindestens commenter auf der Seite).
CREATE FUNCTION app.edit_comment(p_comment_id uuid, p_body text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_c comments%ROWTYPE;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  SELECT * INTO v_c FROM comments WHERE id = p_comment_id AND tenant_id = app.current_tenant();
  IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'edit_comment: Kommentar nicht gefunden oder gelöscht';
  END IF;
  IF v_c.author_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur eigene Kommentare lassen sich bearbeiten';
  END IF;
  PERFORM app.require_page(v_c.page_id, p_actor_id, 'commenter');
  UPDATE comments SET body = p_body, edited_at = now() WHERE id = p_comment_id;
END $$;

-- Kommentar löschen: Inhalt wird überschrieben. Eigene mit Leserecht auf der Seite,
-- fremde nur als Admin der Seite (bei eingeschränkten Seiten deren Admin, sonst Space-Admin).
CREATE FUNCTION app.delete_comment(p_comment_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_c comments%ROWTYPE;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  SELECT * INTO v_c FROM comments WHERE id = p_comment_id AND tenant_id = app.current_tenant();
  IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF v_c.author_id IS DISTINCT FROM p_actor_id THEN
    PERFORM app.require_page(v_c.page_id, p_actor_id, 'admin');
    PERFORM app.audit(p_actor_id, 'comment.deleted', 'comment', p_comment_id);
  ELSE
    PERFORM app.require_page(v_c.page_id, p_actor_id, 'viewer');
  END IF;
  UPDATE comments SET body = NULL, deleted_at = now() WHERE id = p_comment_id;
END $$;
