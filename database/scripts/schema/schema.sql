-- =============================================================================
-- NoteFieber (Wiki, Confluence-Alternative): Datenbankschema
-- PostgreSQL 18 (nutzt das eingebaute uuidv7()), Extensions ltree und pg_trgm
-- Passend zu CLAUDE.md Abschnitt 8 und docs/SCHEMA.md. Änderungen kommen zusätzlich als
-- Migration in ../migrations/ (Stand dort, siehe migrations.applied).
--
-- Einstieg: Diese Datei bindet die Teile in fester Reihenfolge in EINER Transaktion ein
-- (psql \ir, relativ zu dieser Datei). Einspielen immer mit psql und als wiki_owner:
--   psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f schema.sql
-- Die Teile nicht einzeln einspielen. Die Reihenfolge ist nötig: SQL-Funktionen, Trigger
-- und Regeln verweisen beim Anlegen auf Tabellen und Funktionen aus früheren Teilen.
--
--   00_setup.sql                 Erweiterungen, Schema app, Prüfung der Rollen
--   10_tables.sql                alle Tabellen und Indexe
--   20_functions_base.sql        Kontext, Rechte auflösen, Prüfungen, Ereignisse, Sperren
--   30_triggers.sql              Trigger (Pfad, letzter Owner/Organisations-Admin/Admin)
--   40_functions_tenants.sql     vor dem Login, Mandanten, Personen, Workspaces, Gruppen
--   50_functions_spaces.sql      Spaces, Rechte, Vererbung
--   60_functions_pages.sql       Seitenbaum, Papierkorb
--   70_functions_content.sql     Inhalt (Collab-Server), Versionen, Verlinkungen
--   72_functions_comments.sql    Kommentare
--   74_functions_import.sql      Import
--   80_rls.sql                   Row Level Security
--   90_privileges.sql            Rechte an Schemas, Funktionen und Tabellen
--
-- Die Rollen und die Datenbank legt ../roles_database.sql an (als Superuser, vorher).
--
-- Konventionen wie bei TalkFieber:
--   - Jede Tabelle hat tenant_id und Row Level Security.
--   - tenant_id ist in beiden Produkten dieselbe UUID (eine Zitadel-Organisation
--     = ein Mandant). app.create_tenant nimmt die ID deshalb optional entgegen.
--   - Schreibende Abläufe laufen über Funktionen im Schema app.
--
-- Rollen:
--   Eigentümer   – wer dieses Skript ausführt (wiki_owner). Besitzt alle Tabellen.
--   wiki_app     – API bei Anfragen von Personen. Unterliegt Mandantentrennung
--                  UND Leserechten (Space- und Seitenrechte). Schreibt fast nur über
--                  die Funktionen in app; direkt nur dort, wo eine Regel die Zeile
--                  absichert (eigenes Profil, Einladungen, Workspaces, Anhänge).
--                  Seiten gar nicht direkt: Titel über Yjs (store_ydoc), Reihenfolge
--                  über app.move_page.
--   wiki_worker  – Collab-Server (Yjs speichern), Suchindex, Import, Outbox.
--                  Unterliegt nur der Mandantentrennung.
--
-- Pro Transaktion setzt die App:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
--   SELECT set_config('app.user_id',   '<uuid>', true);   -- nur wiki_app
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

\ir 00_setup.sql
\ir 10_tables.sql
\ir 20_functions_base.sql
\ir 30_triggers.sql
\ir 40_functions_tenants.sql
\ir 50_functions_spaces.sql
\ir 60_functions_pages.sql
\ir 70_functions_content.sql
\ir 72_functions_comments.sql
\ir 74_functions_import.sql
\ir 80_rls.sql
\ir 90_privileges.sql

COMMIT;

-- =============================================================================
-- Hinweise
-- - Die Eigentümer-Rolle umgeht RLS. Die App darf sich NIE als Eigentümer verbinden.
--   CloudNativePG richtet standardmäßig einen Nutzer ein, dem die Datenbank gehört.
--   Dieser führt nur Migrationen aus.
-- - wiki_app schreibt nur über die Funktionen in app (SECURITY DEFINER, prüfen Rechte und
--   Mandant selbst) und direkt nur in die wenigen Spalten aus dem Abschnitt Rechte, jeweils
--   mit Regel. Wer eine neue Tabelle oder Spalte anlegt, entscheidet das ausdrücklich.
-- - Neue SECURITY-DEFINER-Funktionen: Mandant in jeder Abfrage prüfen (RLS greift nicht),
--   require_actor bzw. require_page/require_space zuerst, nie require_worker (current_user
--   ist dort der Eigentümer).
-- - Änderungen am Seitenbaum sperren den Space (app.lock_tree): exklusiv für Verschieben,
--   Papierkorb und Vererbung, geteilt für neue Seiten. Prüfung: ../schema_test/schema_concurrency_test.sh.
-- - Neue Funktionen sind für niemanden ausführbar (Default Privileges), bis die Migration
--   sie ausdrücklich an wiki_app und/oder wiki_worker freigibt. Interne Bausteine nur an
--   wiki_worker oder gar nicht.
-- - Seiten im Papierkorb bleiben für Leser lesbar (Papierkorb-Ansicht). Seitenbaum, Suche
--   und Verlinkungen filtern deleted_at IS NULL; der Worker entfernt sie aus page_search.
-- - Leseregel auf pages ruft app.page_rank pro Zeile auf. Für große Seitenbäume später
--   eine vom Worker gepflegte Tabelle mit effektiven Rechten (siehe CLAUDE.md Abschnitt 8).
-- - Der Outbox-Publisher sortiert nach id (uuidv7), nicht nach created_at.
-- - Login-Rollen anlegen, z. B.:
--     CREATE ROLE wiki_api    LOGIN PASSWORD '…' IN ROLE wiki_app;
--     CREATE ROLE wiki_collab LOGIN PASSWORD '…' IN ROLE wiki_worker;
--     CREATE ROLE wiki_jobs   LOGIN PASSWORD '…' IN ROLE wiki_worker;
-- - Endgültiges Löschen aus dem Papierkorb (z. B. nach 30 Tagen) macht ein Worker-Job.
-- =============================================================================
