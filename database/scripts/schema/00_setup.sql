-- =============================================================================
-- NoteFieber: Erweiterungen und Schema app
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

-- Die Rollen legt roles_database.sql an (als Superuser). wiki_owner darf keine Rollen
-- anlegen; fehlen sie, bricht das Einspielen hier mit einer klaren Meldung ab.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_worker') THEN
    RAISE EXCEPTION 'Rollen wiki_app und wiki_worker fehlen: zuerst roles_database.sql ausführen';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE SCHEMA IF NOT EXISTS app;
