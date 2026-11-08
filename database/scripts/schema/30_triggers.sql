-- =============================================================================
-- NoteFieber: Trigger
-- Pfad im Seitenbaum, letzter Owner, letzter Organisations-Admin, letzter Admin.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- Trigger
-- =============================================================================

-- path aus der Elternseite ableiten. SECURITY DEFINER, weil die Elternseite für
-- die einfügende Person nicht sichtbar sein muss (z. B. beim Import).
-- Sperrt den Baum geteilt: Läuft gerade ein Verschieben im Space, wartet das Einfügen
-- und liest danach den neuen Pfad der Elternseite.
CREATE FUNCTION app.set_page_path() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_parent_path ltree;
BEGIN
  PERFORM app.lock_tree(NEW.space_id, false);
  IF NEW.parent_id IS NULL THEN
    NEW.path := app.page_label(NEW.id);
  ELSE
    SELECT path INTO v_parent_path FROM pages
    WHERE id = NEW.parent_id AND tenant_id = NEW.tenant_id AND space_id = NEW.space_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'set_page_path: Elternseite nicht gefunden';
    END IF;
    NEW.path := v_parent_path || app.page_label(NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER set_page_path BEFORE INSERT ON pages
  FOR EACH ROW EXECUTE FUNCTION app.set_page_path();

-- Jeder Workspace behält mindestens einen aktiven Owner.
CREATE FUNCTION app.protect_last_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
    PERFORM 1 FROM workspaces WHERE id = OLD.workspace_id FOR NO KEY UPDATE;
    IF FOUND AND NOT EXISTS (
         SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = OLD.workspace_id AND wm.role = 'owner'
           AND wm.user_id <> OLD.user_id AND u.deactivated_at IS NULL) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        MESSAGE = 'Der letzte Owner eines Workspaces kann nicht entfernt werden';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_last_owner BEFORE UPDATE OF role OR DELETE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION app.protect_last_owner();

-- Jeder Mandant behält mindestens einen aktiven Organisations-Admin.
CREATE FUNCTION app.protect_last_org_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'org_admin' AND OLD.deactivated_at IS NULL
     AND (TG_OP = 'DELETE' OR NEW.role <> 'org_admin' OR NEW.deactivated_at IS NOT NULL) THEN
    PERFORM 1 FROM tenants WHERE id = OLD.tenant_id FOR NO KEY UPDATE;
    IF FOUND AND NOT EXISTS (
         SELECT 1 FROM users
         WHERE tenant_id = OLD.tenant_id AND role = 'org_admin'
           AND id <> OLD.id AND deactivated_at IS NULL) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'restrict_violation',
        MESSAGE = 'Der letzte Organisations-Admin kann nicht entfernt werden';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_last_org_admin BEFORE UPDATE OF role, deactivated_at OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION app.protect_last_org_admin();

-- Jeder Space und jede Seite mit gekappter Vererbung behält mindestens einen wirksamen
-- Admin (app.has_admin). Rückfallebene für alle Wege an app.set_grant vorbei (Worker,
-- Löschen von Personen); geprüft beim Commit, damit "erst löschen, dann neu anlegen"
-- in einer Transaktion geht. Ausgenommen: Objekt gelöscht oder Seite erbt wieder.
-- Austritt aus einer im Wiki gepflegten Gruppe prüft app.remove_group_member selbst.
-- Nicht abgedeckt: Deaktivieren und Gruppenwechsel aus dem Login-Dienst ändern keine Grants.
-- Dann hilft der Organisations-Admin (app.set_grant), siehe CLAUDE.md Abschnitt 8.
CREATE FUNCTION app.check_admin_remains() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_object uuid := coalesce(OLD.space_id, OLD.page_id);
BEGIN
  IF OLD.role <> 'admin' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM spaces WHERE id = v_object)
     AND NOT EXISTS (SELECT 1 FROM pages WHERE id = v_object AND NOT inherit_perms) THEN
    RETURN NULL;
  END IF;
  IF NOT app.has_admin(v_object) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Mindestens ein Admin muss bleiben';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER admin_remains AFTER DELETE OR UPDATE OF role ON grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_admin_remains();
