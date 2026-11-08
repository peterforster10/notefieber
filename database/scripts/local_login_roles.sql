-- Login-Rollen für die Apps, nur für die lokale Entwicklung. Als Superuser ausführen, nach
-- roles_database.sql (beim ersten Start von compose.yaml automatisch):
--   docker exec nf-pg18 psql -U postgres -d wiki -v ON_ERROR_STOP=1 -f /scripts/local_login_roles.sql
-- Ein zweiter Lauf schadet nicht: Er legt nur Fehlendes an und setzt die Passwörter neu.
--
-- Jede App bekommt eine eigene Login-Rolle in genau einer Gruppenrolle, nie wiki_owner
-- (CLAUDE.md, Abschnitt 11; die Apps prüfen das beim Start selbst):
--   wiki_api     API             IN ROLE wiki_app
--   wiki_collab  Collab-Server   IN ROLE wiki_worker
--   wiki_jobs    Worker          IN ROLE wiki_worker
-- Die Passwörter sind bekannte Standardwerte für den eigenen Rechner (wie POSTGRES_PASSWORD
-- in compose.yaml) und stehen auch in .env.example. Andere Werte: psql -v api_password=…
-- Auf dem Server legt sie der Betrieb mit Secrets an, nie mit diesem Skript.
\set ON_ERROR_STOP on
\if :{?api_password}
\else
  \set api_password 'api-lokal'
\endif
\if :{?collab_password}
\else
  \set collab_password 'collab-lokal'
\endif
\if :{?jobs_password}
\else
  \set jobs_password 'jobs-lokal'
\endif

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS IN ROLE %I', r.login, r.grp)
FROM (VALUES ('wiki_api', 'wiki_app'), ('wiki_collab', 'wiki_worker'), ('wiki_jobs', 'wiki_worker')) AS r (login, grp)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.login)
\gexec

SELECT format('ALTER ROLE %I PASSWORD %L', r.login, r.pw)
FROM (VALUES ('wiki_api', :'api_password'), ('wiki_collab', :'collab_password'), ('wiki_jobs', :'jobs_password')) AS r (login, pw)
\gexec

-- Verbinden dürfen sie nur mit der Datenbank wiki (CONNECT hat PUBLIC standardmäßig)
GRANT CONNECT ON DATABASE wiki TO wiki_api, wiki_collab, wiki_jobs;
