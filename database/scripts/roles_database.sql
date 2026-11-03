-- Rollen und Datenbank für die lokale Entwicklung. Als Superuser ausführen:
--   psql -U postgres -f roles_database.sql
-- Danach das Schema als Eigentümer einspielen, nie als postgres:
--   psql -U wiki_owner -d wiki -f schema/schema.sql
-- Passwörter gehören nicht in dieses Skript. Lokal setzen mit: \password wiki_owner
--
-- Gleiches Muster wie bei TalkFieber (chat_owner, chat_app, chat_worker):
-- wiki_owner besitzt Tabellen und Funktionen und führt nur Migrationen aus.
-- Die App verbindet sich nie als wiki_owner, sondern mit einer Login-Rolle aus
-- wiki_app (API) oder wiki_worker (Collab-Server, Jobs). Siehe Hinweise am Ende von schema.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_owner') THEN
    CREATE ROLE wiki_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_app') THEN
    CREATE ROLE wiki_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_worker') THEN
    CREATE ROLE wiki_worker NOLOGIN;
  END IF;
END $$;

-- Für SET ROLE in schema_test.sql
GRANT wiki_app, wiki_worker TO wiki_owner;

-- DROP DATABASE IF EXISTS wiki;

-- Eigene Datenbank im selben CloudNativePG-Cluster wie TalkFieber (Datenbank "chat")
-- und Zitadel. Sortierung nach Zeichencode, damit Fractional-Index-Positionen
-- (pages.position) byteweise sortieren.
CREATE DATABASE wiki
    WITH
    OWNER = wiki_owner
    ENCODING = 'UTF8'
    TEMPLATE = template0
    LOCALE_PROVIDER = 'builtin'
    LOCALE = 'C'
    BUILTIN_LOCALE = 'C.UTF-8';

-- ltree und pg_trgm sind "trusted" Extensions, der Datenbank-Eigentümer darf sie anlegen.
