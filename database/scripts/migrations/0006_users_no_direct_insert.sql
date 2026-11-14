-- =============================================================================
-- Migration 0006: wiki_app legt keine Personen mehr direkt an (REVIEW.md, R-06)
-- Neue Personen kommen nur über Einladungen (app.accept_invite) oder app.create_tenant;
-- die API hat users seit den Einladungen nie mehr direkt beschrieben. Das Recht hätte bei
-- einem Fehler in der API erlaubt, Personen mit beliebigem Login (idp_subject) anzulegen und
-- so ohne Einladung in den Mandanten zu kommen. Gleicher Stand wie in schema/80_rls.sql und
-- schema/90_privileges.sql (geprüft von schema_migrations_test.sh).
-- =============================================================================

DROP POLICY write_insert ON users;
REVOKE INSERT ON users FROM wiki_app;
