-- =============================================================================
-- Migration 0013: Ereignisse sofort an den Collab-Server (ARCHITECTURE_REVIEW.md, A-08; E04-05
-- bis E04-07)
--   - Trigger outbox_notify: jedes Ereignis in der Outbox auch als NOTIFY nf_events, nur mit
--     Mandant, Space und Art. Der Collab-Server prüft damit offene Verbindungen neu.
--   - app.end_session meldet die beendete Sitzung als NOTIFY nf_sessions, damit offene Editoren
--     in anderen Tabs schließen.
-- Gleicher Text wie in schema/30_triggers.sql und schema/40_functions_tenants.sql (geprüft von
-- schema_migrations_test.sh). Rechte wie bei den übrigen Triggerfunktionen; end_session behält
-- seine (CREATE OR REPLACE).
-- =============================================================================

CREATE FUNCTION app.notify_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('nf_events', json_build_object(
    'tenant', NEW.tenant_id,
    'space',  split_part(NEW.subject, '.', 5),   -- t.<tenant>.wiki.s.<space> (app.emit)
    'type',   NEW.event_type)::text);
  RETURN NULL;
END $$;

CREATE TRIGGER outbox_notify AFTER INSERT ON outbox
  FOR EACH ROW EXECUTE FUNCTION app.notify_outbox();

GRANT EXECUTE ON FUNCTION app.notify_outbox() TO wiki_app, wiki_worker;

CREATE OR REPLACE FUNCTION app.end_session(p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_id     uuid;
  v_tenant uuid;
  v_user   uuid;
BEGIN
  DELETE FROM sessions WHERE token_hash = p_token_hash RETURNING id, tenant_id, user_id INTO v_id, v_tenant, v_user;
  IF NOT FOUND THEN RETURN false; END IF;
  -- app.audit nimmt den Mandanten aus dem Kontext; hier gibt es keinen, also direkt
  INSERT INTO audit_log (tenant_id, actor_id, action, target_type, target_id)
  VALUES (v_tenant, v_user, 'session.ended', 'user', v_user);
  PERFORM pg_notify('nf_sessions', json_build_object('tenant', v_tenant, 'session', v_id)::text);
  RETURN true;
END $$;
