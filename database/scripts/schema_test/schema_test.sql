-- =============================================================================
-- Funktionstest für das Schema (database/scripts/schema). Läuft als wiki_app (bzw.
-- wiki_worker), damit RLS greift.
-- Aufruf auf einer Datenbank mit eingespieltem Schema, als wiki_owner und mit psql:
--   psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f schema_test.sql
-- Alles läuft in einer Transaktion, die am Ende zurückgerollt wird: wiederholbar, und die
-- Datenbank bleibt leer. Deshalb prüft Test 33 den Trigger admin_remains mit
-- SET CONSTRAINTS ALL IMMEDIATE statt beim Commit.
-- Gleichzeitige Sitzungen (Sperren im Seitenbaum) prüft schema_concurrency_test.sh.
--
-- Diese Datei richtet Transaktion, Einstellungen und Hilfen ein und bindet die Tests mit
-- \ir ein. Die Teile bauen aufeinander auf und laufen nur in dieser Reihenfolge: Spätere
-- Tests nutzen Mandanten, Personen und Seiten aus früheren (Kopf jedes Teils: „Nutzt“ und
-- „Legt an“). Einen Teil nie allein ausführen.
--
--   01_basics.sql             Tests  1–5   Mandanten, Personen, Space, Seitenbaum
--   02_permissions.sql        Tests  6–12  Leser, Gruppen, Vererbung, Sichtbarkeit, Verschieben, Papierkorb
--   03_content_comments.sql   Tests 13–14  Inhalt, Versionen, Kommentare
--   04_isolation.sql          Tests 15–20  Mandantentrennung, Outbox, Audit-Log, RLS, Handeln für andere
--   05_administration.sql     Tests 21–24  Mitglieder, letzter Owner, Organisations-Admin, Archiv
--   06_import_limits.sql      Tests 25–28  Import, Verweise über Grenzen, Einladungen, Eingabegrenzen
--   07_write_paths.sql        Tests 29–35  Vererbung, direkte Zugriffe, Verschieben, letzter Admin, Events
--   08_titles_positions.sql   Tests 36–37  Titel aus Yjs, Positionen
--   09_users_rules.sql        Tests 38–42  Personen, Gäste, Deaktivierte, kleine Regeln, Funktionsrechte
--   10_view_as.sql            Test  43     „Ansehen als …“
--   11_content_json.sql       Test  44     BlockNote-JSON neben dem Yjs-Zustand
--   12_groups.sql             Tests 45–46  Gruppen im Wiki, letzter Admin über Gruppe, Quellen
--   13_sessions.sql           Tests 47–48  Sitzungen der API, Abmelden, Deaktivieren, Ablauf
--   14_invites.sql            Test  49     Einladung annehmen: Login verknüpfen, fremdes Login
--   15_admin_workspace.sql    Test  50     Wirksamer Admin nur mit Mitgliedschaft im Workspace
--   16_invites_login.sql      Test  51     Einladung annehmen: Login vor E-Mail
--   17_visibility_people.sql  Test  52     Wer sieht welche Personen, Workspaces und Gruppen
--   18_session_id_token.sql   Test  53     ID-Token an der Sitzung fürs Abmelden beim Login-Dienst
--
-- Testdaten: Die erfundene Firma Alpenwerk (Mandant t1) mit Peter (Organisations-Admin),
-- Lukas, Max, Sophie und dem Gast Elena, dazu Eva im zweiten Mandanten (t2). IDs liegen
-- in der Tabelle ids und werden mit pg_temp.id('name') nachgeschlagen; pg_temp.ctx setzt
-- Mandant und Person. Jeder Teil beginnt und endet als wiki_app.
--
-- Neue Tests: hinten an den passenden Teil oder als neuer Teil am Ende (dann eine \ir-Zeile
-- unten ergänzen). Nummern fortlaufend weiterzählen.
-- =============================================================================
\set QUIET on
\pset tuples_only on
BEGIN;
SET client_min_messages = notice;
SET plpgsql.check_asserts = on;   -- sonst würden ASSERTs je nach Konfiguration still übersprungen

-- Personen für die Testdaten anlegen. In Wirklichkeit kommen sie nur über Einladungen
-- (app.accept_invite, Test 49) oder app.create_tenant; wiki_app darf Personen nicht direkt
-- anlegen (REVIEW.md, R-06). Deshalb als Eigentümer (SECURITY DEFINER, angelegt vor
-- SET ROLE), freigegeben für wiki_app.
CREATE FUNCTION pg_temp.new_user(p_tenant uuid, p_email text, p_name text,
                                 p_subject text DEFAULT NULL, p_external boolean DEFAULT false)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.users (tenant_id, idp_subject, email, display_name, is_external)
  VALUES (p_tenant, p_subject, p_email, p_name, p_external)
  RETURNING id
$$;
GRANT EXECUTE ON FUNCTION pg_temp.new_user(uuid, text, text, text, boolean) TO wiki_app;

SET ROLE wiki_app;

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
GRANT SELECT, INSERT ON ids TO wiki_worker;

-- Hilfsfunktionen: Kontext setzen, IDs nachschlagen
CREATE FUNCTION pg_temp.ctx(p_tenant uuid, p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.tenant_id', coalesce(p_tenant::text, ''), false),
         set_config('app.user_id',   coalesce(p_user::text, ''), false)
$$;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = p $$;

\ir 01_basics.sql
\ir 02_permissions.sql
\ir 03_content_comments.sql
\ir 04_isolation.sql
\ir 05_administration.sql
\ir 06_import_limits.sql
\ir 07_write_paths.sql
\ir 08_titles_positions.sql
\ir 09_users_rules.sql
\ir 10_view_as.sql
\ir 11_content_json.sql
\ir 12_groups.sql
\ir 13_sessions.sql
\ir 14_invites.sql
\ir 15_admin_workspace.sql
\ir 16_invites_login.sql
\ir 17_visibility_people.sql
\ir 18_session_id_token.sql

RESET ROLE;
ROLLBACK;
\echo 'Alle Tests bestanden (zurückgerollt, die Datenbank ist unverändert).'
