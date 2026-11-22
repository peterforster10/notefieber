-- =============================================================================
-- NoteFieber: Inhalt und Versionen
-- Yjs-Inhalt speichern (Collab-Server), Versionen, Verlinkungen (Worker).
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abläufe: Inhalt und Versionen (Collab-Server und Worker)
-- =============================================================================

-- Der Inhalt wird in zwei Schritten gespeichert (ARCHITECTURE_REVIEW.md, A-04):
--   1. store_ydoc: der Collab-Server, entprellt alle ~2 s (spätestens 10 s). Nur Yjs-Zustand,
--      Titel und Bearbeitende; markiert den abgeleiteten Inhalt als veraltet (derived_stale).
--      Kein Ereignis: Das ist der heiße Pfad, er bleibt klein.
--   2. store_derived: der Worker, wenn die Seite ruht (~30 s, app.pages_to_derive). Leitet
--      BlockNote-JSON und Klartext aus dem Yjs-Zustand ab, pflegt den Suchindex und meldet
--      page.updated einmal pro Ruhephase.
-- Rechte prüft keine der Funktionen: Der Collab-Server prüft sie beim Verbindungsaufbau
-- (app.resolve_session, app.page_rank) und speichert nur für schreibende Verbindungen.

-- Yjs-Zustand und Titel speichern (Collab-Server). Der Titel lebt im Yjs-Dokument
-- (Y.Text "title") und kommt nur über diese Funktion in pages.title. Deshalb muss der
-- Collab-Server bei einem frischen Dokument (ydoc = '\x0000') in onLoadDocument zuerst
-- pages.title in Y.Text "title" schreiben, sonst überschreibt das erste Speichern den Titel
-- mit einem leeren (CLAUDE.md Abschnitt 6). Titel werden gekürzt statt abgelehnt: Ein Fehler
-- hier hieße, dass der Collab-Server die Änderungen gar nicht mehr speichern kann.
-- updated_at mit clock_timestamp(): Daran erkennt store_derived, ob der Worker noch den
-- aktuellen Stand abgeleitet hat, auch wenn zweimal in derselben Transaktion gespeichert wird.
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

-- Ersten Yjs-Zustand einer Seite speichern, die noch den leeren Anfangszustand hat. Hat sie
-- BlockNote-JSON (Testdaten aus seed.sql, später der Import), baut der Worker ihn, sobald er
-- die Seite findet, der Collab-Server nur als Rückfall beim Öffnen. Neue Seiten ohne Inhalt
-- sichert der Collab-Server beim ersten Öffnen mit dem Titel (REVIEW_M1.md, R-19: sonst
-- verdoppelte sich der Titel). Schreibt nur, solange noch der leere Anfangszustand gespeichert
-- ist; wer zuerst kommt, gewinnt, der andere bekommt false und lädt den gespeicherten Stand.
-- content_json passt dazu, die Seite bleibt aktuell.
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

-- Version anlegen: automatisch (Worker, nach Ruhepause), manuell, beim Wiederherstellen
-- oder beim Import. Das eigentliche Wiederherstellen rechnet der Collab-Server in Yjs
-- (alter Stand als neues Update), danach ruft er diese Funktion mit kind = restore.
-- Intern: Snapshot des aktuellen Inhalts als nächste Version. Nicht für wiki_app
-- ausführbar; Aufrufer sind create_version (Worker) und save_version (geprüft).
-- Ist der abgeleitete Inhalt veraltet (derived_stale), bekommt die Version kein BlockNote-JSON
-- (NULL = fehlt): Maßgeblich ist ihr ydoc, daraus leitet der Worker das JSON ab
-- (CLAUDE.md Abschnitt 7). Der Klartext ist dann der zuletzt abgeleitete.
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
          CASE WHEN NOT v_content.derived_stale THEN v_content.content_json END,
          v_content.plain_text, v_content.editors_since_version, p_actor_id);
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
