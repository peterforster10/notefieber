-- =============================================================================
-- NoteFieber: Import
-- Confluence-Import starten; den Lauf selbst macht der Worker.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- =============================================================================
-- Abläufe: Import
-- =============================================================================

-- Import anlegen (Probelauf oder echt). Den Lauf selbst macht der Worker.
-- SECURITY DEFINER, weil wiki_app Importe nicht direkt anlegen darf (der Worker führt
-- aus, was in imports steht).
CREATE FUNCTION app.start_import(p_space_id uuid, p_file_id uuid, p_actor_id uuid, p_dry_run boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_import uuid := uuidv7();
BEGIN
  PERFORM app.require_space(p_space_id, p_actor_id, 'admin');
  IF NOT EXISTS (SELECT 1 FROM files WHERE id = p_file_id AND tenant_id = v_tenant
                 AND uploaded_by = p_actor_id AND scan_status = 'clean' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'start_import: Datei fehlt, gehört jemand anderem oder ist nicht geprüft';
  END IF;
  INSERT INTO imports (id, tenant_id, space_id, file_id, dry_run, created_by)
  VALUES (v_import, v_tenant, p_space_id, p_file_id, p_dry_run, p_actor_id);
  PERFORM app.emit(v_tenant, p_space_id, 'import.requested',
    jsonb_build_object('id', v_import, 'dry_run', p_dry_run));
  PERFORM app.audit(p_actor_id, 'import.started', 'space', p_space_id,
    jsonb_build_object('import_id', v_import, 'dry_run', p_dry_run));
  RETURN v_import;
END $$;
