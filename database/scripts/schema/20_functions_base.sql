-- =============================================================================
-- NoteFieber: Grundfunktionen
-- Kontext und Hilfen, Rechte auflösen (page_rank …), Prüfungen, Ereignisse, Audit, Sperren.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Kontext- und Hilfsfunktionen
-- -----------------------------------------------------------------------------
CREATE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Rollen als Rang: 0 = kein Zugriff, 1 viewer, 2 commenter, 3 editor, 4 admin
CREATE FUNCTION app.role_rank(p_role text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'viewer' THEN 1 WHEN 'commenter' THEN 2
                     WHEN 'editor' THEN 3 WHEN 'admin' THEN 4 ELSE 0 END
$$;

CREATE FUNCTION app.rank_role(p_rank integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rank WHEN 1 THEN 'viewer' WHEN 2 THEN 'commenter'
                     WHEN 3 THEN 'editor' WHEN 4 THEN 'admin' END
$$;

-- ltree-Label aus einer UUID (ohne Bindestriche)
CREATE FUNCTION app.page_label(p_id uuid) RETURNS ltree
LANGUAGE sql IMMUTABLE AS $$
  SELECT text2ltree(replace(p_id::text, '-', ''))
$$;

-- Position hinter p_after, wie generateKeyBetween(p_after, null) im npm-Paket
-- fractional-indexing (Ziffern 0-9A-Za-z, byteweise sortiert). Zählt den ganzzahligen
-- Teil hoch (a0, a1 … az, b00 …), statt Zeichen anzuhängen; Schlüssel bleiben kurz.
-- NULL = erste Position (a0).
CREATE FUNCTION app.next_position(p_after text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c_digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_head text;
  v_len  integer;   -- Länge des ganzzahligen Teils inklusive Kopfzeichen
  v_digs text;
  v_d    integer;
BEGIN
  IF p_after IS NULL THEN RETURN 'a0'; END IF;
  v_head := left(p_after, 1);
  IF v_head COLLATE "C" BETWEEN 'a' AND 'z' THEN
    v_len := ascii(v_head) - ascii('a') + 2;
  ELSIF v_head COLLATE "C" BETWEEN 'A' AND 'Z' THEN
    v_len := ascii('Z') - ascii(v_head) + 2;
  ELSE
    v_len := 0;
  END IF;
  IF v_len = 0 OR length(p_after) < v_len THEN
    RAISE EXCEPTION 'next_position: ungültige Position %', p_after;
  END IF;

  v_digs := substr(p_after, 2, v_len - 1);
  FOR i IN REVERSE length(v_digs)..1 LOOP
    v_d := strpos(c_digits, substr(v_digs, i, 1));      -- 1 bis 62
    IF v_d < 62 THEN
      RETURN v_head || overlay(v_digs PLACING substr(c_digits, v_d + 1, 1) FROM i FOR 1);
    END IF;
    v_digs := overlay(v_digs PLACING '0' FROM i FOR 1);  -- Übertrag
  END LOOP;

  -- Alle Ziffern übergelaufen: nächstes Kopfzeichen
  IF v_head = 'Z' THEN RETURN 'a0'; END IF;
  IF v_head = 'z' THEN RAISE EXCEPTION 'next_position: keine Position mehr frei'; END IF;
  v_head := chr(ascii(v_head) + 1);
  IF v_head COLLATE "C" > 'a' THEN
    RETURN v_head || v_digs || '0';          -- positive Zahlen: eine Ziffer mehr
  END IF;
  RETURN v_head || left(v_digs, -1);         -- negative Zahlen: eine Ziffer weniger
END $$;

-- Läuft der Aufruf als Hintergrunddienst (Collab-Server, Worker)?
CREATE FUNCTION app.is_worker() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT pg_has_role(current_user, 'wiki_worker', 'MEMBER')
     AND NOT pg_has_role(current_user, 'wiki_app', 'MEMBER')
$$;

-- =============================================================================
-- Rechte auflösen
-- SECURITY DEFINER: Die Funktionen lesen grants, pages und spaces ohne RLS, damit die
-- Leseregeln auf pages und spaces sie aufrufen können (sonst Endlosschleife). Der
-- Mandant wird deshalb überall ausdrücklich geprüft.
-- =============================================================================

-- Höchster Rang aus den Grants eines Objekts (Space ODER Seite) für eine Person.
CREATE FUNCTION app.grant_rank(p_space_id uuid, p_page_id uuid, p_user_id uuid, p_ws_role text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(max(app.role_rank(g.role)), 0)
  FROM grants g
  WHERE g.tenant_id = app.current_tenant()
    AND (g.space_id = p_space_id OR g.page_id = p_page_id)
    AND (   (g.subject_type = 'user' AND g.user_id = p_user_id)
         OR (g.subject_type = 'group' AND EXISTS (
               SELECT 1 FROM group_members gm WHERE gm.group_id = g.group_id AND gm.user_id = p_user_id))
         OR (g.subject_type = 'workspace' AND p_ws_role IS DISTINCT FROM 'guest'))
$$;

-- Rolle einer Person im Workspace eines Spaces (NULL = kein Mitglied oder deaktiviert).
CREATE FUNCTION app.space_ws_role(p_space_id uuid, p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT wm.role
  FROM spaces s
  JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = p_user_id
  JOIN users u ON u.id = p_user_id AND u.deactivated_at IS NULL
  WHERE s.id = p_space_id AND s.tenant_id = app.current_tenant()
$$;

-- Rang auf einem Space bzw. einer Seite für eine beliebige Person: intern (Funktionen,
-- Worker, z. B. für Benachrichtigungen). wiki_app nutzt die Varianten mit einem Argument
-- weiter unten; sie gelten immer für die angemeldete Person, damit die API nicht die
-- Rechte anderer abfragen kann.

-- Rang auf einem Space. Archivierte Spaces sind höchstens lesbar.
CREATE FUNCTION app.space_rank(p_space_id uuid, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_ws_role  text;
  v_rank     integer;
  v_archived boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  v_ws_role := app.space_ws_role(p_space_id, p_user_id);
  IF v_ws_role IS NULL THEN RETURN 0; END IF;
  v_rank := app.grant_rank(p_space_id, NULL, p_user_id, v_ws_role);
  SELECT archived_at IS NOT NULL INTO v_archived FROM spaces WHERE id = p_space_id;
  IF v_archived THEN v_rank := least(v_rank, 1); END IF;
  RETURN v_rank;
END $$;

-- Rang auf einer Seite: Rechte kommen von der nächsten Seite oberhalb (oder der Seite
-- selbst) mit gekappter Vererbung, sonst vom Space.
CREATE FUNCTION app.page_rank(p_page_id uuid, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_page    pages%ROWTYPE;
  v_ws_role text;
  v_source  uuid;
  v_rank    integer;
  v_archived boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = app.current_tenant();
  IF NOT FOUND THEN RETURN 0; END IF;
  v_ws_role := app.space_ws_role(v_page.space_id, p_user_id);
  IF v_ws_role IS NULL THEN RETURN 0; END IF;

  SELECT id INTO v_source FROM pages
  WHERE space_id = v_page.space_id AND path @> v_page.path AND NOT inherit_perms
  ORDER BY nlevel(path) DESC LIMIT 1;

  IF v_source IS NULL THEN
    v_rank := app.grant_rank(v_page.space_id, NULL, p_user_id, v_ws_role);
  ELSE
    v_rank := app.grant_rank(NULL, v_source, p_user_id, v_ws_role);
  END IF;
  SELECT archived_at IS NOT NULL INTO v_archived FROM spaces WHERE id = v_page.space_id;
  IF v_archived THEN v_rank := least(v_rank, 1); END IF;
  RETURN v_rank;
END $$;

-- Rang der angemeldeten Person (für Leseregeln, API und require_*).
CREATE FUNCTION app.page_rank(p_page_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.page_rank(p_page_id, app.current_user_id())
$$;

CREATE FUNCTION app.space_rank(p_space_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.space_rank(p_space_id, app.current_user_id())
$$;

-- Lesbare Rolle für die App (viewer, commenter, editor, admin oder NULL).
CREATE FUNCTION app.page_role(p_page_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT app.rank_role(app.page_rank(p_page_id)) $$;

CREATE FUNCTION app.space_role(p_space_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT app.rank_role(app.space_rank(p_space_id)) $$;

-- =============================================================================
-- Interne Prüfungen
-- =============================================================================

CREATE FUNCTION app.require_actor(p_actor_id uuid) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_actor_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Handelnde Person ist nicht die angemeldete Person';
  END IF;
END $$;

CREATE FUNCTION app.require_page(p_page_id uuid, p_actor_id uuid, p_min_role text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);   -- danach ist p_actor_id die angemeldete Person
  IF app.page_rank(p_page_id) < app.role_rank(p_min_role) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Für diese Seite ist die Rolle %s nötig', p_min_role);
  END IF;
END $$;

CREATE FUNCTION app.require_space(p_space_id uuid, p_actor_id uuid, p_min_role text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF app.space_rank(p_space_id) < app.role_rank(p_min_role) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Für diesen Space ist die Rolle %s nötig', p_min_role);
  END IF;
END $$;

CREATE FUNCTION app.require_worker() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT app.is_worker() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur für Hintergrunddienste (wiki_worker)';
  END IF;
END $$;

CREATE FUNCTION app.is_org_admin(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND tenant_id = app.current_tenant()
                 AND role = 'org_admin' AND deactivated_at IS NULL)
$$;

-- Darf die Person Mitglieder und Einladungen dieses Workspaces verwalten?
-- (Organisations-Admin oder aktiver Owner/Admin des Workspaces)
CREATE FUNCTION app.is_workspace_admin(p_workspace_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.is_org_admin(p_user_id) OR EXISTS (
    SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id AND u.deactivated_at IS NULL
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_user_id
      AND wm.tenant_id = app.current_tenant() AND wm.role IN ('owner', 'admin'))
$$;

-- Workspaces, in denen die angemeldete Person aktiv und Mitglied ist, aber kein Gast. Für
-- die Leseregeln auf Personen, Workspaces und Gruppen (80_rls.sql): Man sieht, wen man aus
-- diesen Workspaces kennt. In den Regeln immer in einer Unterabfrage (IN (SELECT unnest(…))
-- bzw. (SELECT …)), damit es pro Abfrage nur einmal ausgewertet wird.
CREATE FUNCTION app.member_workspaces() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(array_agg(wm.workspace_id), '{}')
  FROM workspace_members wm
  JOIN users u ON u.id = wm.user_id AND u.deactivated_at IS NULL
  WHERE wm.user_id = app.current_user_id() AND wm.tenant_id = app.current_tenant() AND wm.role <> 'guest'
$$;

-- Darf diese Datei das Profilbild der Person sein? Nur eine eigene Datei ohne Seite. Für die
-- Regel auf users (80_rls.sql) als Funktion: Die Leseregel auf files liest ihrerseits users
-- (Profilbilder), und eine Unterabfrage hier ergäbe einen Kreis, den PostgreSQL als
-- Endlosschleife ablehnt.
CREATE FUNCTION app.is_own_avatar(p_file_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM files f
                 WHERE f.id = p_file_id AND f.tenant_id = app.current_tenant()
                   AND f.page_id IS NULL AND f.uploaded_by = p_user_id)
$$;

-- Hat ein Space bzw. eine Seite mit gekappter Vererbung (p_object_id) noch einen wirksamen
-- Admin? Zählt: Grant für eine Person oder für eine Gruppe mit mindestens einem Mitglied,
-- die aktiv und Mitglied im Workspace des Spaces ist (Gruppen gelten für den ganzen Mandanten,
-- Zugriff gibt es aber nur über den Workspace, siehe app.space_ws_role). "Alle im Workspace"
-- kann nicht Admin sein. Ohne Mandantenfilter, damit der Trigger beim Commit unabhängig vom
-- Kontext prüft (die IDs sind eindeutig).
CREATE FUNCTION app.has_admin(p_object_id uuid) RETURNS boolean
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

-- Woher hat eine Seite ihre Rechte? Nächste Seite oberhalb (oder die Seite selbst) mit
-- gekappter Vererbung, NULL = vom Space.
CREATE FUNCTION app.perm_source(p_page_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.id
  FROM pages p
  JOIN pages s ON s.space_id = p.space_id AND s.path @> p.path AND NOT s.inherit_perms
  WHERE p.id = p_page_id AND p.tenant_id = app.current_tenant()
  ORDER BY nlevel(s.path) DESC
  LIMIT 1
$$;

-- Seitenbaum eines Spaces sperren (über die Zeile in spaces). Verschieben, Papierkorb und
-- Vererbung sperren exklusiv, neue Seiten geteilt. So laufen Änderungen am Baum pro Space
-- nacheinander: keine Zyklen durch gleichzeitiges Verschieben, keine veralteten Pfade,
-- keine neuen Seiten unter Seiten, die gerade in den Papierkorb wandern.
CREATE FUNCTION app.lock_tree(p_space_id uuid, p_exclusive boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_exclusive THEN
    PERFORM 1 FROM spaces WHERE id = p_space_id FOR NO KEY UPDATE;
  ELSE
    PERFORM 1 FROM spaces WHERE id = p_space_id FOR SHARE;
  END IF;
END $$;

-- Event in die Outbox, Subject t.<tenant>.wiki.s.<space>
-- Intern: nur aus Funktionen heraus (wiki_app darf die Outbox nicht direkt beschreiben).
CREATE FUNCTION app.emit(p_tenant_id uuid, p_space_id uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO outbox (tenant_id, subject, event_type, payload)
  VALUES (p_tenant_id, 't.' || p_tenant_id || '.wiki.s.' || p_space_id, p_type, p_payload)
$$;

-- Dasselbe Event an jeden Space eines Workspaces (p_workspace_id) bzw. aller Workspaces,
-- in denen die Person Mitglied ist (p_workspace_id NULL). Für Ereignisse, nach denen der
-- Collab-Server Verbindungen einer Person trennen muss.
CREATE FUNCTION app.emit_user_spaces(p_user_id uuid, p_workspace_id uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO outbox (tenant_id, subject, event_type, payload)
  SELECT s.tenant_id, 't.' || s.tenant_id || '.wiki.s.' || s.id, p_type, p_payload
  FROM spaces s
  WHERE s.tenant_id = app.current_tenant()
    AND (s.workspace_id = p_workspace_id
         OR (p_workspace_id IS NULL AND s.workspace_id IN (
               SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = p_user_id)))
$$;

-- Dasselbe Event an jeden Space, in dem eine Gruppe Rechte hat (auf dem Space oder auf
-- einer seiner Seiten). Für Änderungen an Gruppen, nach denen der Collab-Server
-- Verbindungen neu prüfen muss.
CREATE FUNCTION app.emit_group_spaces(p_group_id uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO outbox (tenant_id, subject, event_type, payload)
  SELECT DISTINCT g.tenant_id, 't.' || g.tenant_id || '.wiki.s.' || coalesce(g.space_id, p.space_id),
         p_type, p_payload
  FROM grants g
  LEFT JOIN pages p ON p.id = g.page_id
  WHERE g.group_id = p_group_id AND g.tenant_id = app.current_tenant()
$$;

-- Intern: Audit-Eintrag aus einer Funktion heraus.
CREATE FUNCTION app.audit(p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
                          p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_log (tenant_id, actor_id, action, target_type, target_id, details)
  VALUES (app.current_tenant(), p_actor_id, p_action, p_target_type, p_target_id, p_details)
$$;

-- Audit-Eintrag aus der API (z. B. export.created). Handelnde Person ist immer die angemeldete.
-- Nur für Aktionen, die die API selbst ausführt (Bereiche invite und export); was die
-- Funktionen der Datenbank schreiben (grant.changed, space.viewed_as …), ließe sich sonst mit
-- echten Einträgen verwechseln (REVIEW.md, R-09). Neue Bereiche der API hier ergänzen.
CREATE FUNCTION app.audit_event(p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
                                p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF p_action IS NULL OR p_action !~ '^(invite|export)\.[a-z_]{1,50}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('audit_event: Aktion %s ist der Datenbank vorbehalten oder unbekannt', p_action);
  END IF;
  PERFORM app.audit(p_actor_id, p_action, p_target_type, p_target_id, p_details);
END $$;

