-- =============================================================================
-- Migration 0011: Rechtequelle über die IDs im Pfad (ARCHITECTURE_REVIEW.md, A-01)
-- app.page_rank, app.perm_source und app.view_as suchten die nächste Seite mit eigenen
-- Rechten mit path @> im ganzen Space. Die Leseregel auf pages ruft page_rank pro Zeile auf.
-- Die Vorfahren stehen mit ihren IDs im Pfad; jetzt über den Primärschlüssel: gleiche
-- Ergebnisse (gegen die alte Fassung auf 10.000 Seiten geprüft), unabhängig von Größe und
-- Statistik des Baums, der Seitenbaum mit 10.000 Seiten etwa doppelt so schnell.
-- Gleicher Text wie in schema/20_functions_base.sql und schema/50_functions_spaces.sql
-- (geprüft von schema_migrations_test.sh). Die Rechte bleiben (CREATE OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION app.page_rank(p_page_id uuid, p_user_id uuid)
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

  -- Die Vorfahren stehen mit ihren IDs im Pfad: über den Primärschlüssel nachschlagen statt
  -- im Baum zu suchen (path @>). Gleiche Ergebnisse, unabhängig von Größe und Statistik des
  -- Baums; der Seitenbaum mit 10.000 Seiten etwa doppelt so schnell (ARCHITECTURE_REVIEW.md, A-01).
  SELECT s.id INTO v_source
  FROM unnest(string_to_array(ltree2text(v_page.path), '.')) WITH ORDINALITY AS a (label, n)
  JOIN pages s ON s.id = a.label::uuid
  WHERE NOT s.inherit_perms
  ORDER BY a.n DESC LIMIT 1;

  IF v_source IS NULL THEN
    v_rank := app.grant_rank(v_page.space_id, NULL, p_user_id, v_ws_role);
  ELSE
    v_rank := app.grant_rank(NULL, v_source, p_user_id, v_ws_role);
  END IF;
  SELECT archived_at IS NOT NULL INTO v_archived FROM spaces WHERE id = v_page.space_id;
  IF v_archived THEN v_rank := least(v_rank, 1); END IF;
  RETURN v_rank;
END $$;

CREATE OR REPLACE FUNCTION app.perm_source(p_page_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.id
  FROM pages p
  CROSS JOIN LATERAL unnest(string_to_array(ltree2text(p.path), '.')) WITH ORDINALITY AS a (label, n)
  JOIN pages s ON s.id = a.label::uuid AND NOT s.inherit_perms
  WHERE p.id = p_page_id AND p.tenant_id = app.current_tenant()
  ORDER BY a.n DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app.view_as(p_space_id uuid, p_user_id uuid, p_actor_id uuid)
RETURNS TABLE (page_id uuid, parent_id uuid, path ltree, "position" text, title text,
               inherit_perms boolean, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_ws_role text;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id = p_space_id AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'view_as: Space nicht gefunden';
  END IF;
  v_ws_role := app.space_ws_role(p_space_id, p_actor_id);
  IF NOT ((v_ws_role IS NOT NULL AND app.grant_rank(p_space_id, NULL, p_actor_id, v_ws_role) = 4)
          OR app.is_org_admin(p_actor_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins des Spaces dürfen ansehen, was andere sehen';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user_id AND u.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'view_as: Person nicht gefunden';
  END IF;

  PERFORM app.audit(p_actor_id, 'space.viewed_as', 'space', p_space_id,
                    jsonb_build_object('user_id', p_user_id));

  RETURN QUERY
  SELECT p.id, p.parent_id, p.path, p.position, p.title, p.inherit_perms,
         app.rank_role(app.page_rank(p.id, p_user_id))
  FROM pages p
  CROSS JOIN LATERAL (SELECT app.perm_source(p.id) AS source) src
  WHERE p.space_id = p_space_id AND p.tenant_id = v_tenant AND p.deleted_at IS NULL
    AND (src.source IS NULL
         OR (v_ws_role IS NOT NULL AND app.grant_rank(NULL, src.source, p_actor_id, v_ws_role) = 4))
  ORDER BY p.position, p.id;
END $$;
