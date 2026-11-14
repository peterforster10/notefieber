-- =============================================================================
-- Migration 0005: Gruppen aus dem Login-Dienst gleicht nur wiki_worker ab (REVIEW.md, R-02)
-- app.sync_user_groups prüft nur, dass die Person sich selbst einträgt. Für wiki_app hieße
-- das: jede angemeldete Person könnte sich in jede Gruppe mit Quelle idp eintragen und
-- bekäme deren Rechte. Die Funktion ist derzeit ungenutzt (Zitadel liefert keine Gruppen);
-- wer sie mit einem geprüften Gruppen-Claim aufruft, wird mit E03 entschieden.
-- Gleiche Rechte wie in schema/90_privileges.sql (geprüft von schema_migrations_test.sh).
-- =============================================================================

REVOKE EXECUTE ON FUNCTION app.sync_user_groups(uuid, text[], text[]) FROM wiki_app;
