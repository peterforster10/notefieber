-- =============================================================================
-- NoteFieber: Inhalt und Versionen
-- Yjs-Inhalt speichern (Collab-Server), Versionen, Verlinkungen (Worker).
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abläufe: Inhalt und Versionen (Collab-Server und Worker)
-- =============================================================================

-- Yjs-Zustand speichern. Nur Hintergrunddienste: Der Collab-Server prüft die Rechte
-- beim Verbindungsaufbau über die API und speichert gebündelt (entprellt).
-- Der Titel lebt im Yjs-Dokument (Y.Text "title") und kommt nur über diese Funktion in
-- pages.title. Deshalb muss der Collab-Server bei einem frischen Dokument (ydoc = '\x0000')
-- in onLoadDocument zuerst pages.title in Y.Text "title" schreiben, sonst überschreibt das
-- erste Speichern den Titel mit einem leeren (CLAUDE.md Abschnitt 6).
-- Titel und Klartext werden gekürzt statt abgelehnt: Ein Fehler hier hieße, dass der
-- Collab-Server die Änderungen gar nicht mehr speichern kann. Aus demselben Grund wird
-- ein BlockNote-JSON, das zu groß (über 20 MB) oder kein Dokument (Array) ist, als NULL
-- gespeichert; ydoc bleibt maßgeblich.
CREATE FUNCTION app.store_content(
  p_page_id uuid, p_ydoc bytea, p_content_json jsonb, p_plain_text text, p_title text, p_editor_ids uuid[]
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_space  uuid;
  v_title  text;
  v_json   jsonb := CASE WHEN jsonb_typeof(p_content_json) = 'array'
                          AND pg_column_size(p_content_json) <= 20000000 THEN p_content_json END;
BEGIN
  PERFORM app.require_worker();
  SELECT space_id, coalesce(left(btrim(p_title), 255), title) INTO v_space, v_title
  FROM pages WHERE id = p_page_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_content: Seite fehlt oder liegt im Papierkorb';
  END IF;

  UPDATE page_contents
  SET ydoc = p_ydoc, content_json = v_json, plain_text = left(coalesce(p_plain_text, ''), 2000000),
      updated_at = now(),
      editors_since_version = ARRAY(SELECT DISTINCT e FROM unnest(editors_since_version || p_editor_ids) AS e
                                    WHERE e IS NOT NULL ORDER BY e)
  WHERE page_id = p_page_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_content: Inhalt der Seite fehlt';
  END IF;

  UPDATE pages
  SET title = v_title, updated_at = now(),
      updated_by = coalesce(p_editor_ids[cardinality(p_editor_ids)], updated_by)
  WHERE id = p_page_id;

  PERFORM app.emit(v_tenant, v_space, 'page.updated',
    jsonb_build_object('id', p_page_id, 'title', v_title, 'editors', to_jsonb(p_editor_ids)));
END $$;

-- Version anlegen: automatisch (Worker, nach Ruhepause), manuell, beim Wiederherstellen
-- oder beim Import. Das eigentliche Wiederherstellen rechnet der Collab-Server in Yjs
-- (alter Stand als neues Update), danach ruft er diese Funktion mit kind = restore.
-- Intern: Snapshot des aktuellen Inhalts als nächste Version. Nicht für wiki_app
-- ausführbar; Aufrufer sind create_version (Worker) und save_version (geprüft).
CREATE FUNCTION app.insert_version(p_page_id uuid, p_kind text, p_actor_id uuid, p_restored_from integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_content page_contents%ROWTYPE;
  v_title   text;
  v_version integer;
BEGIN
  -- Versionsnummern serialisieren
  SELECT title INTO v_title FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'create_version: Seite nicht gefunden'; END IF;
  SELECT * INTO v_content FROM page_contents WHERE page_id = p_page_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'create_version: Inhalt nicht gefunden'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM page_versions WHERE page_id = p_page_id;

  INSERT INTO page_versions (tenant_id, page_id, version, kind, restored_from, title, ydoc,
                             content_json, plain_text, author_ids, created_by)
  VALUES (v_tenant, p_page_id, v_version, p_kind, p_restored_from, v_title, v_content.ydoc,
          v_content.content_json, v_content.plain_text, v_content.editors_since_version, p_actor_id);
  UPDATE page_contents SET editors_since_version = '{}' WHERE page_id = p_page_id;
  RETURN v_version;
END $$;

-- Manuelle Version durch eine Person (Editor). SECURITY DEFINER, weil wiki_app Versionen
-- nicht direkt schreiben darf (sonst ließen sich fremde Inhalte als Version unterschieben).
CREATE FUNCTION app.save_version(p_page_id uuid, p_actor_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  RETURN app.insert_version(p_page_id, 'manual', p_actor_id, NULL);
END $$;

CREATE FUNCTION app.create_version(
  p_page_id uuid, p_kind text, p_actor_id uuid DEFAULT NULL, p_restored_from integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'manual' THEN
    RETURN app.save_version(p_page_id, p_actor_id);
  END IF;
  PERFORM app.require_worker();
  RETURN app.insert_version(p_page_id, p_kind, p_actor_id, p_restored_from);
END $$;

-- Verlinkungen einer Seite ersetzen (Worker, nach dem Speichern).
CREATE FUNCTION app.replace_page_links(p_page_id uuid, p_to_page_ids uuid[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_worker();
  DELETE FROM page_links WHERE from_page_id = p_page_id;
  INSERT INTO page_links (from_page_id, to_page_id, tenant_id)
  SELECT p_page_id, t, v_tenant FROM (SELECT DISTINCT unnest(p_to_page_ids) AS t) x
  WHERE t <> p_page_id AND EXISTS (SELECT 1 FROM pages WHERE id = t);
END $$;
