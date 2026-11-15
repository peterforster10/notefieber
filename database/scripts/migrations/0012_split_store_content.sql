-- =============================================================================
-- Migration 0012: Inhalt in zwei Schritten speichern (ARCHITECTURE_REVIEW.md, A-04 und A-05)
-- app.store_content schrieb bei jedem Speichern des Collab-Servers (alle ~2 s) Yjs-Zustand,
-- BlockNote-JSON, Klartext und Titel und legte ein page.updated in die Outbox. Jetzt:
--   - app.store_ydoc (Collab-Server): nur Yjs-Zustand, Titel und Bearbeitende, kein Ereignis;
--     markiert den abgeleiteten Inhalt als veraltet (page_contents.derived_stale)
--   - app.store_derived (Worker, wenn die Seite ruht): BlockNote-JSON, Klartext, Suchindex,
--     ein page.updated pro Ruhephase
--   - app.store_initial_ydoc (Worker, Rückfall Collab-Server): erster Yjs-Zustand aus
--     BlockNote-JSON (Testdaten, später Import)
--   - app.pages_to_derive (Worker): Arbeit über alle Mandanten, nur IDs
--   - app.insert_version: kein BlockNote-JSON in Versionen veralteter Seiten (NULL = fehlt)
-- app.store_content hatte noch keinen Aufrufer in den Apps und entfällt.
-- Gleicher Text wie in schema/10_tables.sql, schema/70_functions_content.sql und
-- schema/90_privileges.sql (geprüft von schema_migrations_test.sh). Neue Funktionen sind
-- nur für wiki_worker ausführbar.
-- =============================================================================

ALTER TABLE page_contents ADD COLUMN derived_stale boolean NOT NULL DEFAULT false;
CREATE INDEX page_contents_stale   ON page_contents (updated_at) WHERE derived_stale;
CREATE INDEX page_contents_no_ydoc ON page_contents (updated_at)
  WHERE ydoc = '\x0000'::bytea AND content_json <> '[]'::jsonb;

DROP FUNCTION app.store_content(uuid, bytea, jsonb, text, text, uuid[]);

CREATE FUNCTION app.store_ydoc(p_page_id uuid, p_ydoc bytea, p_title text, p_editor_ids uuid[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_title text;
BEGIN
  PERFORM app.require_worker();
  SELECT coalesce(left(btrim(p_title), 255), title) INTO v_title
  FROM pages WHERE id = p_page_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_ydoc: Seite fehlt oder liegt im Papierkorb';
  END IF;

  UPDATE page_contents
  SET ydoc = p_ydoc, derived_stale = true, updated_at = clock_timestamp(),
      editors_since_version = ARRAY(SELECT DISTINCT e FROM unnest(editors_since_version || p_editor_ids) AS e
                                    WHERE e IS NOT NULL ORDER BY e)
  WHERE page_id = p_page_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_ydoc: Inhalt der Seite fehlt';
  END IF;

  UPDATE pages
  SET title = v_title, updated_at = now(),
      updated_by = coalesce(p_editor_ids[cardinality(p_editor_ids)], updated_by)
  WHERE id = p_page_id;
END $$;

-- Abgeleiteten Inhalt speichern (Worker): BlockNote-JSON und Klartext, aus dem Yjs-Zustand
-- mit dem Stand p_seen (page_contents.updated_at beim Lesen). Hat der Collab-Server seither
-- wieder gespeichert, passt nichts mehr: false, die Seite bleibt veraltet und kommt nach der
-- nächsten Ruhephase wieder. Ein BlockNote-JSON, das zu groß (über 20 MB) oder kein Dokument
-- (Array) ist, wird als NULL gespeichert (NULL = fehlt, ydoc bleibt maßgeblich), Klartext
-- gekürzt. Pflegt page_search und meldet page.updated, beides einmal pro Ruhephase.
CREATE FUNCTION app.store_derived(p_page_id uuid, p_seen timestamptz, p_content_json jsonb, p_plain_text text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_text   text := left(coalesce(p_plain_text, ''), 2000000);
  v_json   jsonb := CASE WHEN jsonb_typeof(p_content_json) = 'array'
                          AND pg_column_size(p_content_json) <= 20000000 THEN p_content_json END;
  v_tsv    tsvector;
BEGIN
  PERFORM app.require_worker();
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE page_contents SET content_json = v_json, plain_text = v_text, derived_stale = false
  WHERE page_id = p_page_id AND derived_stale AND updated_at = p_seen;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Suchindex wie in seed.sql. Ein tsvector hat höchstens 1 MB; ist der Text dafür zu groß,
  -- zählt nur der Titel, statt dass die Seite nie mehr abgeleitet wird.
  BEGIN
    v_tsv := setweight(to_tsvector('german', v_page.title), 'A') || setweight(to_tsvector('german', v_text), 'B');
  EXCEPTION WHEN program_limit_exceeded THEN
    v_tsv := setweight(to_tsvector('german', v_page.title), 'A');
  END;
  INSERT INTO page_search (page_id, tenant_id, space_id, tsv)
  VALUES (p_page_id, v_tenant, v_page.space_id, v_tsv)
  ON CONFLICT (page_id) DO UPDATE SET space_id = EXCLUDED.space_id, tsv = EXCLUDED.tsv, updated_at = now();

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.updated',
    jsonb_build_object('id', p_page_id, 'title', v_page.title));
  RETURN true;
END $$;

-- Ersten Yjs-Zustand einer Seite speichern, die nur BlockNote-JSON hat (Testdaten aus
-- seed.sql, später der Import): Der Worker baut ihn, sobald er die Seite findet, der
-- Collab-Server nur als Rückfall beim Öffnen. Schreibt nur, solange noch der leere
-- Anfangszustand gespeichert ist; wer zuerst kommt, gewinnt, der andere bekommt false
-- und lädt den gespeicherten Stand. content_json passt dazu, die Seite bleibt aktuell.
CREATE FUNCTION app.store_initial_ydoc(p_page_id uuid, p_ydoc bytea)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.require_worker();
  UPDATE page_contents SET ydoc = p_ydoc WHERE page_id = p_page_id AND ydoc = '\x0000'::bytea;
  RETURN FOUND;
END $$;

-- Arbeit für den Worker, über alle Mandanten: Seiten mit veraltetem abgeleiteten Inhalt, die
-- seit p_rest ruhen (needs_ydoc = false), und Seiten mit BlockNote-JSON, aber noch ohne
-- Yjs-Zustand (needs_ydoc = true). SECURITY DEFINER, weil wiki_worker ohne Mandant nichts
-- sieht; gibt deshalb nur IDs heraus, den Inhalt liest der Worker danach im Mandanten.
-- Nur für wiki_worker ausführbar (90_privileges.sql). Seiten im Papierkorb fehlen.
CREATE FUNCTION app.pages_to_derive(p_rest interval, p_limit integer)
RETURNS TABLE (tenant_id uuid, page_id uuid, updated_at timestamptz, needs_ydoc boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  (SELECT c.tenant_id, c.page_id, c.updated_at, false
   FROM page_contents c JOIN pages p ON p.id = c.page_id AND p.tenant_id = c.tenant_id
   WHERE c.derived_stale AND c.updated_at <= clock_timestamp() - p_rest AND p.deleted_at IS NULL
   ORDER BY c.updated_at LIMIT p_limit)
  UNION ALL
  (SELECT c.tenant_id, c.page_id, c.updated_at, true
   FROM page_contents c JOIN pages p ON p.id = c.page_id AND p.tenant_id = c.tenant_id
   WHERE c.ydoc = '\x0000'::bytea AND c.content_json <> '[]'::jsonb AND p.deleted_at IS NULL
   ORDER BY c.updated_at LIMIT p_limit)
$$;

CREATE OR REPLACE FUNCTION app.insert_version(p_page_id uuid, p_kind text, p_actor_id uuid, p_restored_from integer)
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
          CASE WHEN NOT v_content.derived_stale THEN v_content.content_json END,
          v_content.plain_text, v_content.editors_since_version, p_actor_id);
  UPDATE page_contents SET editors_since_version = '{}' WHERE page_id = p_page_id;
  RETURN v_version;
END $$;

GRANT EXECUTE ON FUNCTION
  app.store_ydoc(uuid, bytea, text, uuid[]),
  app.store_derived(uuid, timestamptz, jsonb, text),
  app.store_initial_ydoc(uuid, bytea),
  app.pages_to_derive(interval, integer)
TO wiki_worker;
