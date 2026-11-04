-- =============================================================================
-- NoteFieber (Wiki, Confluence-Alternative): Datenbankschema
-- PostgreSQL 18 (nutzt das eingebaute uuidv7()), Extensions ltree und pg_trgm
-- Stand: 03.11.2026, passend zu CLAUDE.md Abschnitt 8
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
--                  Seiten gar nicht direkt: Titel über Yjs (store_content), Reihenfolge
--                  über app.move_page.
--   wiki_worker  – Collab-Server (Yjs speichern), Suchindex, Import, Outbox.
--                  Unterliegt nur der Mandantentrennung.
--
-- Pro Transaktion setzt die App:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
--   SELECT set_config('app.user_id',   '<uuid>', true);   -- nur wiki_app
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE SCHEMA IF NOT EXISTS app;

-- -----------------------------------------------------------------------------
-- Rollen (NOLOGIN; Login-Rollen werden ihnen per GRANT zugeordnet)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_app') THEN
    CREATE ROLE wiki_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wiki_worker') THEN
    CREATE ROLE wiki_worker NOLOGIN;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Kontext- und Hilfsfunktionen
-- -----------------------------------------------------------------------------
CREATE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Rollen als Rang: 0 = kein Zugriff, 1 viewer, 2 commenter, 3 editor, 4 admin
CREATE FUNCTION app.role_rank(p_role text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'viewer' THEN 1 WHEN 'commenter' THEN 2
                     WHEN 'editor' THEN 3 WHEN 'admin' THEN 4 ELSE 0 END
$$;

CREATE FUNCTION app.rank_role(p_rank integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_rank WHEN 1 THEN 'viewer' WHEN 2 THEN 'commenter'
                     WHEN 3 THEN 'editor' WHEN 4 THEN 'admin' END
$$;

-- ltree-Label aus einer UUID (ohne Bindestriche)
CREATE FUNCTION app.page_label(p_id uuid) RETURNS ltree
LANGUAGE sql IMMUTABLE AS $$
  SELECT text2ltree(replace(p_id::text, '-', ''))
$$;

-- Position hinter p_after, wie generateKeyBetween(p_after, null) im npm-Paket
-- fractional-indexing (Ziffern 0-9A-Za-z, byteweise sortiert). Zählt den ganzzahligen
-- Teil hoch (a0, a1 … az, b00 …), statt Zeichen anzuhängen; Schlüssel bleiben kurz.
-- NULL = erste Position (a0).
CREATE FUNCTION app.next_position(p_after text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  c_digits constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_head text;
  v_len  integer;   -- Länge des ganzzahligen Teils inklusive Kopfzeichen
  v_digs text;
  v_d    integer;
BEGIN
  IF p_after IS NULL THEN RETURN 'a0'; END IF;
  v_head := left(p_after, 1);
  IF v_head COLLATE "C" BETWEEN 'a' AND 'z' THEN
    v_len := ascii(v_head) - ascii('a') + 2;
  ELSIF v_head COLLATE "C" BETWEEN 'A' AND 'Z' THEN
    v_len := ascii('Z') - ascii(v_head) + 2;
  ELSE
    v_len := 0;
  END IF;
  IF v_len = 0 OR length(p_after) < v_len THEN
    RAISE EXCEPTION 'next_position: ungültige Position %', p_after;
  END IF;

  v_digs := substr(p_after, 2, v_len - 1);
  FOR i IN REVERSE length(v_digs)..1 LOOP
    v_d := strpos(c_digits, substr(v_digs, i, 1));      -- 1 bis 62
    IF v_d < 62 THEN
      RETURN v_head || overlay(v_digs PLACING substr(c_digits, v_d + 1, 1) FROM i FOR 1);
    END IF;
    v_digs := overlay(v_digs PLACING '0' FROM i FOR 1);  -- Übertrag
  END LOOP;

  -- Alle Ziffern übergelaufen: nächstes Kopfzeichen
  IF v_head = 'Z' THEN RETURN 'a0'; END IF;
  IF v_head = 'z' THEN RAISE EXCEPTION 'next_position: keine Position mehr frei'; END IF;
  v_head := chr(ascii(v_head) + 1);
  IF v_head COLLATE "C" > 'a' THEN
    RETURN v_head || v_digs || '0';          -- positive Zahlen: eine Ziffer mehr
  END IF;
  RETURN v_head || left(v_digs, -1);         -- negative Zahlen: eine Ziffer weniger
END $$;

-- Läuft der Aufruf als Hintergrunddienst (Collab-Server, Worker)?
CREATE FUNCTION app.is_worker() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT pg_has_role(current_user, 'wiki_worker', 'MEMBER')
     AND NOT pg_has_role(current_user, 'wiki_app', 'MEMBER')
$$;

-- =============================================================================
-- Tabellen: Mandanten, Personen, Workspaces (gleiches Modell wie TalkFieber)
-- =============================================================================

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  region      text NOT NULL DEFAULT 'eu-central',
  plan        text NOT NULL DEFAULT 'pilot',
  idp_org_id  text UNIQUE,                -- Organisation in Zitadel, wie in TalkFieber
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  idp_subject    text,                      -- Person in Zitadel
  email          text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  display_name   text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('org_admin', 'member')),
  is_external    boolean NOT NULL DEFAULT false,
  locale         text NOT NULL DEFAULT 'de' CHECK (length(locale) BETWEEN 2 AND 35),
  time_zone      text NOT NULL DEFAULT 'Europe/Vienna' CHECK (length(time_zone) BETWEEN 1 AND 64),
  avatar_file_id uuid,                      -- Fremdschlüssel unten, nach der Tabelle files
  created_at     timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  UNIQUE (id, tenant_id)
);
CREATE UNIQUE INDEX users_email_per_tenant ON users (tenant_id, lower(email));
-- Pro Mandant eindeutig, nicht global: Dieselbe Person aus Zitadel (z. B. ein Gast oder
-- Dienstleister) kann in mehreren Mandanten ein eigenes Konto haben. Die API sucht beim
-- Login deshalb immer nach (tenant_id, idp_subject).
CREATE UNIQUE INDEX users_idp_subject      ON users (tenant_id, idp_subject) WHERE idp_subject IS NOT NULL;

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  slug        text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, slug),
  UNIQUE (id, tenant_id)
);

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  role         text NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tenant_id)      REFERENCES users (id, tenant_id)      ON DELETE CASCADE
);
CREATE INDEX workspace_members_by_user ON workspace_members (user_id);

-- Gruppen aus dem Login-Dienst (Zitadel), beim Login synchronisiert.
CREATE TABLE groups (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  idp_group_id text NOT NULL CHECK (length(idp_group_id) BETWEEN 1 AND 200),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idp_group_id),
  UNIQUE (id, tenant_id)
);

CREATE TABLE group_members (
  group_id  uuid NOT NULL,
  user_id   uuid NOT NULL,
  tenant_id uuid NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, tenant_id) REFERENCES groups (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tenant_id)  REFERENCES users (id, tenant_id)  ON DELETE CASCADE
);
CREATE INDEX group_members_by_user ON group_members (user_id);

CREATE TABLE invites (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL,
  workspace_id uuid NOT NULL,
  email        text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'guest')),
  token_hash   text NOT NULL UNIQUE,       -- nur der Hash des Einladungslinks
  invited_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by, tenant_id)   REFERENCES users (id, tenant_id)
);

-- =============================================================================
-- Tabellen: Wiki
-- =============================================================================

-- Space = Confluence-Bereich. Einheit für Rechte und Import.
CREATE TABLE spaces (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  workspace_id uuid NOT NULL,
  key          text NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9]{1,31}$'),   -- wie Confluence-Space-Keys
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description  text CHECK (length(description) <= 2000),
  home_page_id uuid,                        -- Fremdschlüssel unten, nach der Tabelle pages
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,                 -- archiviert = nur noch lesbar
  UNIQUE (tenant_id, key),
  UNIQUE (id, tenant_id),
  FOREIGN KEY (workspace_id, tenant_id) REFERENCES workspaces (id, tenant_id),
  FOREIGN KEY (created_by, tenant_id)   REFERENCES users (id, tenant_id)
);

-- Seitenbaum: parent_id für Integrität, path (ltree) für schnelle Teilbäume und Rechte.
-- path und parent_id ändert nur app.move_page.
CREATE TABLE pages (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id     uuid NOT NULL,
  space_id      uuid NOT NULL,
  parent_id     uuid,
  path          ltree NOT NULL,             -- vom Trigger gesetzt
  -- Fractional Index (fractional-indexing): Das Kopfzeichen bestimmt die Länge des ganzzahligen
  -- Teils (a = 2 … z = 27, Z = 2 … A = 27). Unter Geschwistern nicht eindeutig (die App sieht
  -- eingeschränkte Geschwister nicht), sortieren mit ORDER BY position, id.
  position      text NOT NULL COLLATE "C"
                CHECK (position ~ '^[A-Za-z][0-9A-Za-z]{1,63}$'
                       AND length(position) >= CASE WHEN ascii(position) >= 97 THEN ascii(position) - 95
                                                    ELSE 92 - ascii(position) END),
  title         text NOT NULL DEFAULT '' CHECK (length(title) <= 255),
  inherit_perms boolean NOT NULL DEFAULT true,   -- false = eigene Rechte (Vererbung gekappt)
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,                -- Papierkorb
  deleted_by    uuid,
  trash_root_id uuid,                       -- welche Seite in den Papierkorb gelegt wurde
  UNIQUE (id, tenant_id),
  UNIQUE (id, space_id),
  FOREIGN KEY (space_id, tenant_id)  REFERENCES spaces (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id, space_id)  REFERENCES pages (id, space_id) ON DELETE CASCADE,  -- Eltern im selben Space
  FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id),
  FOREIGN KEY (updated_by, tenant_id) REFERENCES users (id, tenant_id),
  FOREIGN KEY (deleted_by, tenant_id) REFERENCES users (id, tenant_id),
  CHECK (parent_id IS DISTINCT FROM id),
  CHECK ((deleted_at IS NULL) = (trash_root_id IS NULL))
);
CREATE INDEX pages_path      ON pages USING gist (path);
CREATE INDEX pages_children  ON pages (space_id, parent_id, position);
CREATE INDEX pages_title_trgm ON pages USING gin (title gin_trgm_ops);
CREATE INDEX pages_trash     ON pages (trash_root_id) WHERE trash_root_id IS NOT NULL;

ALTER TABLE spaces ADD FOREIGN KEY (home_page_id, id) REFERENCES pages (id, space_id);

-- Aktueller Inhalt: Yjs-Zustand plus abgeleiteter Klartext. Geschrieben vom Collab-Server.
CREATE TABLE page_contents (
  page_id               uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL,
  ydoc                  bytea NOT NULL,               -- Yjs: encodeStateAsUpdate
  plain_text            text NOT NULL DEFAULT '' CHECK (length(plain_text) <= 2000000),
  editors_since_version uuid[] NOT NULL DEFAULT '{}', -- für die Autorenliste der nächsten Version
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (page_id, tenant_id) REFERENCES pages (id, tenant_id) ON DELETE CASCADE,
  CHECK (octet_length(ydoc) <= 50000000)              -- 50 MB pro Seite, darüber Alarm
);

-- Versionshistorie: Snapshots, nie überschrieben.
CREATE TABLE page_versions (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id     uuid NOT NULL,
  page_id       uuid NOT NULL,
  version       integer NOT NULL CHECK (version >= 1),
  kind          text NOT NULL CHECK (kind IN ('auto', 'manual', 'restore', 'import')),
  restored_from integer,                    -- bei kind = restore
  title         text NOT NULL CHECK (length(title) <= 255),
  ydoc          bytea NOT NULL,
  plain_text    text NOT NULL DEFAULT '',
  author_ids    uuid[] NOT NULL DEFAULT '{}',
  created_by    uuid,                       -- wer manuell gespeichert oder wiederhergestellt hat
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version),
  FOREIGN KEY (page_id, tenant_id)    REFERENCES pages (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id),
  CHECK ((kind = 'restore') = (restored_from IS NOT NULL)),
  CHECK (restored_from < version),
  FOREIGN KEY (page_id, restored_from) REFERENCES page_versions (page_id, version)   -- nur vorhandene Versionen
);

-- Suchindex, gepflegt vom Worker (Titel stärker gewichtet als Text).
CREATE TABLE page_search (
  page_id    uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  space_id   uuid NOT NULL,
  tsv        tsvector NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (page_id, tenant_id) REFERENCES pages (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX page_search_tsv   ON page_search USING gin (tsv);
CREATE INDEX page_search_space ON page_search (space_id);

-- Verlinkungen zwischen Seiten, für Rückverweise und kaputte Links. Gepflegt vom Worker.
CREATE TABLE page_links (
  from_page_id uuid NOT NULL,
  to_page_id   uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  PRIMARY KEY (from_page_id, to_page_id),
  FOREIGN KEY (from_page_id, tenant_id) REFERENCES pages (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (to_page_id, tenant_id)   REFERENCES pages (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX page_links_to ON page_links (to_page_id);

-- Rechte: entweder auf einen Space oder auf eine Seite mit gekappter Vererbung.
-- Subjekt: eine Person, eine Gruppe oder "alle Mitglieder des Workspaces" (ohne Gäste).
CREATE TABLE grants (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL,
  space_id     uuid,
  page_id      uuid,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'group', 'workspace')),
  user_id      uuid,
  group_id     uuid,
  role         text NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'admin')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (space_id, tenant_id)   REFERENCES spaces (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (page_id, tenant_id)    REFERENCES pages (id, tenant_id)  ON DELETE CASCADE,
  FOREIGN KEY (user_id, tenant_id)    REFERENCES users (id, tenant_id)  ON DELETE CASCADE,
  FOREIGN KEY (group_id, tenant_id)   REFERENCES groups (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id),
  CHECK ((space_id IS NULL) <> (page_id IS NULL)),
  CHECK ((subject_type = 'user')  = (user_id IS NOT NULL)),
  CHECK ((subject_type = 'group') = (group_id IS NOT NULL)),
  CHECK (subject_type <> 'workspace' OR role <> 'admin')   -- Admins immer namentlich oder als Gruppe
);
CREATE UNIQUE INDEX grants_one_per_subject ON grants (
  coalesce(space_id, page_id), subject_type,
  coalesce(user_id, group_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX grants_by_user  ON grants (user_id)  WHERE user_id IS NOT NULL;
CREATE INDEX grants_by_group ON grants (group_id) WHERE group_id IS NOT NULL;

-- Kommentare: Seitenkommentare (anchor NULL) und Kommentare an Textstellen
-- (anchor = relative Yjs-Position). Antworten nur eine Ebene tief.
CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL,
  page_id     uuid NOT NULL,
  parent_id   uuid,
  author_id   uuid,
  body        text CHECK (length(body) BETWEEN 1 AND 10000),
  anchor      jsonb CHECK (octet_length(anchor::text) <= 2000),   -- relative Yjs-Position, klein
  resolved_at timestamptz,
  resolved_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  UNIQUE (id, tenant_id),
  UNIQUE (id, page_id),
  FOREIGN KEY (page_id, tenant_id)     REFERENCES pages (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id, page_id)     REFERENCES comments (id, page_id) ON DELETE CASCADE,
  FOREIGN KEY (author_id, tenant_id)   REFERENCES users (id, tenant_id),
  FOREIGN KEY (resolved_by, tenant_id) REFERENCES users (id, tenant_id),
  CHECK (deleted_at IS NULL OR body IS NULL),            -- DSGVO: gelöscht heißt Inhalt weg
  CHECK (deleted_at IS NOT NULL OR body IS NOT NULL),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  CHECK (parent_id IS NULL OR anchor IS NULL)             -- Antworten erben den Anker
);
CREATE INDEX comments_by_page ON comments (page_id, created_at);

-- Dateien: Anhänge einer Seite oder Profilbilder. Inhalt liegt in Garage (S3).
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  page_id     uuid,                         -- NULL bei Profilbildern und Import-Archiven
  uploaded_by uuid,
  storage_key text NOT NULL UNIQUE,
  file_name   text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  mime        text NOT NULL CHECK (length(mime) BETWEEN 1 AND 255),
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  scan_status text NOT NULL DEFAULT 'pending'
                CHECK (scan_status IN ('pending', 'clean', 'infected', 'error')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (page_id, tenant_id)     REFERENCES pages (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by, tenant_id) REFERENCES users (id, tenant_id)
);
CREATE INDEX files_by_page   ON files (page_id) WHERE page_id IS NOT NULL;
CREATE INDEX files_name_trgm ON files USING gin (file_name gin_trgm_ops);

ALTER TABLE users ADD FOREIGN KEY (avatar_file_id, tenant_id) REFERENCES files (id, tenant_id);

-- Confluence-Import: ein Lauf pro hochgeladenem Space-Export.
CREATE TABLE imports (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL,
  space_id    uuid NOT NULL,
  source      text NOT NULL DEFAULT 'confluence' CHECK (source IN ('confluence')),
  file_id     uuid NOT NULL,                -- das hochgeladene Export-Archiv
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done', 'failed', 'rolled_back')),
  dry_run     boolean NOT NULL DEFAULT true,
  report      jsonb NOT NULL DEFAULT '{}'::jsonb    -- übernommen, übersprungen, Makros als Platzhalter
                CHECK (pg_column_size(report) <= 10000000),
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz,
  UNIQUE (id, tenant_id),
  FOREIGN KEY (space_id, tenant_id)   REFERENCES spaces (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (file_id, tenant_id)    REFERENCES files (id, tenant_id),
  FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id)
);

-- Zuordnung Confluence-ID -> neue Seite. Macht Importe wiederholbar und Links umschreibbar.
CREATE TABLE import_items (
  import_id uuid NOT NULL,
  source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
  tenant_id uuid NOT NULL,
  page_id   uuid,
  status    text NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'skipped', 'placeholder', 'failed')),
  note      text CHECK (length(note) <= 2000),
  PRIMARY KEY (import_id, source_id),
  FOREIGN KEY (import_id, tenant_id) REFERENCES imports (id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (page_id, tenant_id)   REFERENCES pages (id, tenant_id) ON DELETE SET NULL (page_id)
);

-- Outbox-Pattern: in derselben Transaktion wie die Änderung geschrieben.
-- Subjects: t.<tenant>.wiki.s.<space> – TalkFieber kann sie später abonnieren.
CREATE TABLE outbox (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  subject      text NOT NULL,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

-- Nur Anfügen: wiki_app und wiki_worker haben kein UPDATE/DELETE.
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  actor_id    uuid,
  action      text NOT NULL,               -- z. B. grant.changed, page.trashed, export.created
  target_type text NOT NULL,
  target_id   uuid,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_by_tenant ON audit_log (tenant_id, created_at DESC);

-- =============================================================================
-- Rechte auflösen
-- SECURITY DEFINER: Die Funktionen lesen grants, pages und spaces ohne RLS, damit die
-- Leseregeln auf pages und spaces sie aufrufen können (sonst Endlosschleife). Der
-- Mandant wird deshalb überall ausdrücklich geprüft.
-- =============================================================================

-- Höchster Rang aus den Grants eines Objekts (Space ODER Seite) für eine Person.
CREATE FUNCTION app.grant_rank(p_space_id uuid, p_page_id uuid, p_user_id uuid, p_ws_role text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(max(app.role_rank(g.role)), 0)
  FROM grants g
  WHERE g.tenant_id = app.current_tenant()
    AND (g.space_id = p_space_id OR g.page_id = p_page_id)
    AND (   (g.subject_type = 'user' AND g.user_id = p_user_id)
         OR (g.subject_type = 'group' AND EXISTS (
               SELECT 1 FROM group_members gm WHERE gm.group_id = g.group_id AND gm.user_id = p_user_id))
         OR (g.subject_type = 'workspace' AND p_ws_role IS DISTINCT FROM 'guest'))
$$;

-- Rolle einer Person im Workspace eines Spaces (NULL = kein Mitglied oder deaktiviert).
CREATE FUNCTION app.space_ws_role(p_space_id uuid, p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT wm.role
  FROM spaces s
  JOIN workspace_members wm ON wm.workspace_id = s.workspace_id AND wm.user_id = p_user_id
  JOIN users u ON u.id = p_user_id AND u.deactivated_at IS NULL
  WHERE s.id = p_space_id AND s.tenant_id = app.current_tenant()
$$;

-- Rang auf einem Space bzw. einer Seite für eine beliebige Person: intern (Funktionen,
-- Worker, z. B. für Benachrichtigungen). wiki_app nutzt die Varianten mit einem Argument
-- weiter unten; sie gelten immer für die angemeldete Person, damit die API nicht die
-- Rechte anderer abfragen kann.

-- Rang auf einem Space. Archivierte Spaces sind höchstens lesbar.
CREATE FUNCTION app.space_rank(p_space_id uuid, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_ws_role  text;
  v_rank     integer;
  v_archived boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  v_ws_role := app.space_ws_role(p_space_id, p_user_id);
  IF v_ws_role IS NULL THEN RETURN 0; END IF;
  v_rank := app.grant_rank(p_space_id, NULL, p_user_id, v_ws_role);
  SELECT archived_at IS NOT NULL INTO v_archived FROM spaces WHERE id = p_space_id;
  IF v_archived THEN v_rank := least(v_rank, 1); END IF;
  RETURN v_rank;
END $$;

-- Rang auf einer Seite: Rechte kommen von der nächsten Seite oberhalb (oder der Seite
-- selbst) mit gekappter Vererbung, sonst vom Space.
CREATE FUNCTION app.page_rank(p_page_id uuid, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_page    pages%ROWTYPE;
  v_ws_role text;
  v_source  uuid;
  v_rank    integer;
  v_archived boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = app.current_tenant();
  IF NOT FOUND THEN RETURN 0; END IF;
  v_ws_role := app.space_ws_role(v_page.space_id, p_user_id);
  IF v_ws_role IS NULL THEN RETURN 0; END IF;

  SELECT id INTO v_source FROM pages
  WHERE space_id = v_page.space_id AND path @> v_page.path AND NOT inherit_perms
  ORDER BY nlevel(path) DESC LIMIT 1;

  IF v_source IS NULL THEN
    v_rank := app.grant_rank(v_page.space_id, NULL, p_user_id, v_ws_role);
  ELSE
    v_rank := app.grant_rank(NULL, v_source, p_user_id, v_ws_role);
  END IF;
  SELECT archived_at IS NOT NULL INTO v_archived FROM spaces WHERE id = v_page.space_id;
  IF v_archived THEN v_rank := least(v_rank, 1); END IF;
  RETURN v_rank;
END $$;

-- Rang der angemeldeten Person (für Leseregeln, API und require_*).
CREATE FUNCTION app.page_rank(p_page_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.page_rank(p_page_id, app.current_user_id())
$$;

CREATE FUNCTION app.space_rank(p_space_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.space_rank(p_space_id, app.current_user_id())
$$;

-- Lesbare Rolle für die App (viewer, commenter, editor, admin oder NULL).
CREATE FUNCTION app.page_role(p_page_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT app.rank_role(app.page_rank(p_page_id)) $$;

CREATE FUNCTION app.space_role(p_space_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT app.rank_role(app.space_rank(p_space_id)) $$;

-- =============================================================================
-- Interne Prüfungen
-- =============================================================================

CREATE FUNCTION app.require_actor(p_actor_id uuid) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_actor_id IS DISTINCT FROM app.current_user_id() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Handelnde Person ist nicht die angemeldete Person';
  END IF;
END $$;

CREATE FUNCTION app.require_page(p_page_id uuid, p_actor_id uuid, p_min_role text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);   -- danach ist p_actor_id die angemeldete Person
  IF app.page_rank(p_page_id) < app.role_rank(p_min_role) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Für diese Seite ist die Rolle %s nötig', p_min_role);
  END IF;
END $$;

CREATE FUNCTION app.require_space(p_space_id uuid, p_actor_id uuid, p_min_role text)
RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF app.space_rank(p_space_id) < app.role_rank(p_min_role) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Für diesen Space ist die Rolle %s nötig', p_min_role);
  END IF;
END $$;

CREATE FUNCTION app.require_worker() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT app.is_worker() THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur für Hintergrunddienste (wiki_worker)';
  END IF;
END $$;

CREATE FUNCTION app.is_org_admin(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND tenant_id = app.current_tenant()
                 AND role = 'org_admin' AND deactivated_at IS NULL)
$$;

-- Darf die Person Mitglieder und Einladungen dieses Workspaces verwalten?
-- (Organisations-Admin oder aktiver Owner/Admin des Workspaces)
CREATE FUNCTION app.is_workspace_admin(p_workspace_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT app.is_org_admin(p_user_id) OR EXISTS (
    SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id AND u.deactivated_at IS NULL
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = p_user_id
      AND wm.tenant_id = app.current_tenant() AND wm.role IN ('owner', 'admin'))
$$;

-- Hat ein Space bzw. eine Seite mit gekappter Vererbung (p_object_id) noch einen wirksamen
-- Admin? Zählt: Grant für eine aktive Person oder für eine Gruppe mit mindestens einem
-- aktiven Mitglied ("alle im Workspace" kann nicht Admin sein). Ohne Mandantenfilter, damit
-- der Trigger beim Commit unabhängig vom Kontext prüft (die IDs sind eindeutig).
CREATE FUNCTION app.has_admin(p_object_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM grants g
    WHERE coalesce(g.space_id, g.page_id) = p_object_id AND g.role = 'admin'
      AND (   (g.subject_type = 'user' AND EXISTS (
                 SELECT 1 FROM users u WHERE u.id = g.user_id AND u.deactivated_at IS NULL))
           OR (g.subject_type = 'group' AND EXISTS (
                 SELECT 1 FROM group_members gm JOIN users u ON u.id = gm.user_id
                 WHERE gm.group_id = g.group_id AND u.deactivated_at IS NULL))))
$$;

-- Woher hat eine Seite ihre Rechte? Nächste Seite oberhalb (oder die Seite selbst) mit
-- gekappter Vererbung, NULL = vom Space.
CREATE FUNCTION app.perm_source(p_page_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.id
  FROM pages p
  JOIN pages s ON s.space_id = p.space_id AND s.path @> p.path AND NOT s.inherit_perms
  WHERE p.id = p_page_id AND p.tenant_id = app.current_tenant()
  ORDER BY nlevel(s.path) DESC
  LIMIT 1
$$;

-- Seitenbaum eines Spaces sperren (über die Zeile in spaces). Verschieben, Papierkorb und
-- Vererbung sperren exklusiv, neue Seiten geteilt. So laufen Änderungen am Baum pro Space
-- nacheinander: keine Zyklen durch gleichzeitiges Verschieben, keine veralteten Pfade,
-- keine neuen Seiten unter Seiten, die gerade in den Papierkorb wandern.
CREATE FUNCTION app.lock_tree(p_space_id uuid, p_exclusive boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_exclusive THEN
    PERFORM 1 FROM spaces WHERE id = p_space_id FOR NO KEY UPDATE;
  ELSE
    PERFORM 1 FROM spaces WHERE id = p_space_id FOR SHARE;
  END IF;
END $$;

-- Event in die Outbox, Subject t.<tenant>.wiki.s.<space>
-- Intern: nur aus Funktionen heraus (wiki_app darf die Outbox nicht direkt beschreiben).
CREATE FUNCTION app.emit(p_tenant_id uuid, p_space_id uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO outbox (tenant_id, subject, event_type, payload)
  VALUES (p_tenant_id, 't.' || p_tenant_id || '.wiki.s.' || p_space_id, p_type, p_payload)
$$;

-- Dasselbe Event an jeden Space eines Workspaces (p_workspace_id) bzw. aller Workspaces,
-- in denen die Person Mitglied ist (p_workspace_id NULL). Für Ereignisse, nach denen der
-- Collab-Server Verbindungen einer Person trennen muss.
CREATE FUNCTION app.emit_user_spaces(p_user_id uuid, p_workspace_id uuid, p_type text, p_payload jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO outbox (tenant_id, subject, event_type, payload)
  SELECT s.tenant_id, 't.' || s.tenant_id || '.wiki.s.' || s.id, p_type, p_payload
  FROM spaces s
  WHERE s.tenant_id = app.current_tenant()
    AND (s.workspace_id = p_workspace_id
         OR (p_workspace_id IS NULL AND s.workspace_id IN (
               SELECT wm.workspace_id FROM workspace_members wm WHERE wm.user_id = p_user_id)))
$$;

-- Intern: Audit-Eintrag aus einer Funktion heraus.
CREATE FUNCTION app.audit(p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
                          p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_log (tenant_id, actor_id, action, target_type, target_id, details)
  VALUES (app.current_tenant(), p_actor_id, p_action, p_target_type, p_target_id, p_details)
$$;

-- Audit-Eintrag aus der API (z. B. export.created). Handelnde Person ist immer die angemeldete.
CREATE FUNCTION app.audit_event(p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
                                p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  PERFORM app.audit(p_actor_id, p_action, p_target_type, p_target_id, p_details);
END $$;

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
-- Nicht abgedeckt: Deaktivieren und Gruppenaustritt ändern keine Grants. Dann hilft der
-- Organisations-Admin (app.set_grant), siehe CLAUDE.md Abschnitt 8.
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

-- =============================================================================
-- Abfragen vor der Anmeldung (Mandant noch unbekannt), wie bei TalkFieber
-- =============================================================================

CREATE FUNCTION app.resolve_tenant(p_slug text)
RETURNS TABLE (tenant_id uuid, name text, idp_org_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT t.id, t.name, t.idp_org_id FROM tenants t
  WHERE t.slug = p_slug AND t.deleted_at IS NULL
$$;

CREATE FUNCTION app.find_invite(p_token_hash text)
RETURNS TABLE (tenant_id uuid, tenant_name text, workspace_name text, email text,
               role text, invited_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT i.tenant_id, t.name, w.name, i.email, i.role, u.display_name
  FROM invites i
  JOIN tenants t ON t.id = i.tenant_id
  JOIN workspaces w ON w.id = i.workspace_id
  LEFT JOIN users u ON u.id = i.invited_by
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
$$;

-- =============================================================================
-- Abläufe: Mandanten und Personen
-- =============================================================================

-- Mandant + erster Workspace + erste Person als Organisations-Admin und Owner.
-- p_tenant_id: dieselbe ID wie in TalkFieber verwenden, wenn der Kunde dort schon existiert.
CREATE FUNCTION app.create_tenant(
  p_slug text, p_name text, p_region text,
  p_admin_email text, p_admin_name text, p_admin_idp_subject text DEFAULT NULL,
  p_workspace_slug text DEFAULT 'main', p_workspace_name text DEFAULT NULL,
  p_idp_org_id text DEFAULT NULL, p_tenant_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, uuidv7());
  v_ws     uuid := uuidv7();
  v_user   uuid := uuidv7();
BEGIN
  PERFORM set_config('app.tenant_id', v_tenant::text, true);

  INSERT INTO tenants (id, slug, name, region, idp_org_id)
  VALUES (v_tenant, p_slug, p_name, p_region, p_idp_org_id);
  INSERT INTO workspaces (id, tenant_id, slug, name)
  VALUES (v_ws, v_tenant, p_workspace_slug, coalesce(p_workspace_name, p_name));
  INSERT INTO users (id, tenant_id, idp_subject, email, display_name, role)
  VALUES (v_user, v_tenant, p_admin_idp_subject, p_admin_email, p_admin_name, 'org_admin');
  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (v_ws, v_user, v_tenant, 'owner');

  PERFORM app.audit(v_user, 'tenant.created', 'tenant', v_tenant);
  RETURN v_tenant;
END $$;

-- SECURITY DEFINER, weil wiki_app Mitgliedschaften nicht direkt schreiben darf.
CREATE FUNCTION app.accept_invite(p_token_hash text, p_display_name text, p_idp_subject text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_inv    invites%ROWTYPE;
  v_user   uuid;
  v_deact  timestamptz;
BEGIN
  SELECT * INTO v_inv FROM invites
  WHERE token_hash = p_token_hash AND tenant_id = v_tenant
    AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_invite: Einladung ungültig oder abgelaufen';
  END IF;

  SELECT id, deactivated_at INTO v_user, v_deact FROM users
  WHERE tenant_id = v_tenant AND lower(email) = lower(v_inv.email);
  IF v_deact IS NOT NULL THEN
    RAISE EXCEPTION 'accept_invite: Person ist deaktiviert';
  END IF;
  IF v_user IS NULL THEN
    v_user := uuidv7();
    INSERT INTO users (id, tenant_id, idp_subject, email, display_name, is_external)
    VALUES (v_user, v_tenant, p_idp_subject, v_inv.email, p_display_name, v_inv.role = 'guest');
  END IF;

  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (v_inv.workspace_id, v_user, v_tenant, v_inv.role)
  ON CONFLICT DO NOTHING;
  UPDATE invites SET accepted_at = now() WHERE id = v_inv.id;

  PERFORM app.audit(v_user, 'invite.accepted', 'workspace', v_inv.workspace_id);
  RETURN v_user;
END $$;

-- Gruppen beim Login aus dem Token übernehmen (Zitadel-Gruppen oder Rollen).
-- SECURITY DEFINER, weil wiki_app Gruppen und Mitgliedschaften nicht direkt schreiben darf.
CREATE FUNCTION app.sync_user_groups(p_user_id uuid, p_idp_group_ids text[], p_names text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_actor(p_user_id);
  IF cardinality(p_idp_group_ids) IS DISTINCT FROM cardinality(p_names) THEN
    RAISE EXCEPTION 'sync_user_groups: IDs und Namen passen nicht zusammen';
  END IF;

  -- ON CONFLICT: Zwei gleichzeitige Logins mit derselben neuen Gruppe scheitern sonst
  -- an der Eindeutigkeit (groups und group_members haben keine Leseregel, siehe CLAUDE.md).
  INSERT INTO groups (tenant_id, idp_group_id, name)
  SELECT v_tenant, g.gid, g.gname FROM unnest(p_idp_group_ids, p_names) AS g (gid, gname)
  ON CONFLICT (tenant_id, idp_group_id) DO NOTHING;

  UPDATE groups x SET name = g.gname
  FROM unnest(p_idp_group_ids, p_names) AS g (gid, gname)
  WHERE x.tenant_id = v_tenant AND x.idp_group_id = g.gid AND x.name <> g.gname;

  DELETE FROM group_members gm USING groups x
  WHERE gm.group_id = x.id AND gm.user_id = p_user_id AND x.tenant_id = v_tenant
    AND x.idp_group_id <> ALL (array_remove(coalesce(p_idp_group_ids, '{}'), NULL));   -- NULL würde nichts löschen

  INSERT INTO group_members (group_id, user_id, tenant_id)
  SELECT x.id, p_user_id, v_tenant FROM groups x
  WHERE x.tenant_id = v_tenant AND x.idp_group_id = ANY (p_idp_group_ids)
  ON CONFLICT (group_id, user_id) DO NOTHING;
END $$;

-- Person aus einem Workspace entfernen: Ihre persönlichen Grants auf dessen Spaces und
-- Seiten fallen weg. Abgelehnt, wenn sie dadurch irgendwo letzter Admin war. Das Event
-- member.removed lässt den Collab-Server ihre offenen Verbindungen trennen.
-- SECURITY DEFINER, weil auch Seiten betroffen sind, die die handelnde Person nicht
-- sieht. Der Mandant wird deshalb ausdrücklich geprüft.
CREATE FUNCTION app.remove_workspace_member(p_workspace_id uuid, p_user_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_admin_objects uuid[];
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF p_user_id <> p_actor_id AND NOT app.is_workspace_admin(p_workspace_id, p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen Personen aus einem Workspace entfernen';
  END IF;

  DELETE FROM workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN; END IF;

  WITH removed AS (
    DELETE FROM grants g
    WHERE g.tenant_id = v_tenant AND g.user_id = p_user_id
      AND (   g.space_id IN (SELECT id FROM spaces WHERE workspace_id = p_workspace_id)
           OR g.page_id IN (SELECT p.id FROM pages p JOIN spaces s ON s.id = p.space_id
                            WHERE s.workspace_id = p_workspace_id))
    RETURNING coalesce(g.space_id, g.page_id) AS object_id, g.role)
  SELECT array_agg(object_id) FILTER (WHERE role = 'admin') INTO v_admin_objects FROM removed;

  IF EXISTS (SELECT 1 FROM unnest(v_admin_objects) AS o WHERE NOT app.has_admin(o)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Die Person ist letzter Admin eines Spaces oder einer eingeschränkten Seite, zuerst einen anderen Admin bestimmen';
  END IF;

  PERFORM app.emit_user_spaces(p_user_id, p_workspace_id, 'member.removed',
    jsonb_build_object('user', p_user_id, 'workspace', p_workspace_id));
  PERFORM app.audit(p_actor_id, 'member.removed', 'workspace', p_workspace_id,
                    jsonb_build_object('user_id', p_user_id));
END $$;

-- Prüft, ob die handelnde Person einer anderen diese Workspace-Rolle geben darf.
-- Owner vergeben nur Owner und Organisations-Admins.
CREATE FUNCTION app.require_member_admin(p_workspace_id uuid, p_actor_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_workspace_admin(p_workspace_id, p_actor_id)
     OR (p_role = 'owner' AND NOT app.is_org_admin(p_actor_id) AND NOT EXISTS (
           SELECT 1 FROM workspace_members
           WHERE workspace_id = p_workspace_id AND user_id = p_actor_id
             AND tenant_id = app.current_tenant() AND role = 'owner')) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen Mitglieder verwalten, Owner nur Owner';
  END IF;
END $$;

-- Person in einen Workspace aufnehmen (ohne Einladung, z. B. bestehende Personen des Mandanten).
CREATE FUNCTION app.add_workspace_member(p_workspace_id uuid, p_user_id uuid, p_role text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_member_admin(p_workspace_id, p_actor_id, p_role);
  INSERT INTO workspace_members (workspace_id, user_id, tenant_id, role)
  VALUES (p_workspace_id, p_user_id, v_tenant, p_role);
  PERFORM app.audit(p_actor_id, 'member.added', 'workspace', p_workspace_id,
                    jsonb_build_object('user_id', p_user_id, 'role', p_role));
END $$;

-- Rolle im Workspace ändern. member.changed, weil z. B. ein Wechsel zu guest den Zugriff
-- über "alle im Workspace" beendet.
CREATE FUNCTION app.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_old    text;
BEGIN
  PERFORM app.require_member_admin(p_workspace_id, p_actor_id, p_role);
  SELECT role INTO v_old FROM workspace_members
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'set_workspace_member_role: Person ist kein Mitglied'; END IF;
  IF v_old = p_role THEN RETURN; END IF;
  IF v_old = 'owner' THEN
    PERFORM app.require_member_admin(p_workspace_id, p_actor_id, 'owner');
  END IF;

  UPDATE workspace_members SET role = p_role
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND tenant_id = v_tenant;

  PERFORM app.emit_user_spaces(p_user_id, p_workspace_id, 'member.changed',
    jsonb_build_object('user', p_user_id, 'workspace', p_workspace_id, 'role', p_role));
  PERFORM app.audit(p_actor_id, 'member.role_changed', 'workspace', p_workspace_id,
                    jsonb_build_object('user_id', p_user_id, 'from', v_old, 'to', p_role));
END $$;

-- Organisations-Rolle ändern (nur Organisations-Admins). Der Trigger schützt den letzten.
CREATE FUNCTION app.set_user_role(p_user_id uuid, p_role text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_org_admin(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Organisations-Admins dürfen Rollen ändern';
  END IF;
  UPDATE users SET role = p_role WHERE id = p_user_id AND tenant_id = app.current_tenant();
  IF NOT FOUND THEN RAISE EXCEPTION 'set_user_role: Person nicht gefunden'; END IF;
  PERFORM app.audit(p_actor_id, 'user.role_changed', 'user', p_user_id, jsonb_build_object('role', p_role));
END $$;

-- Person deaktivieren oder wieder aktivieren (nur Organisations-Admins). Beim Deaktivieren
-- trennt der Collab-Server ihre Verbindungen (user.deactivated). Ihre Grants bleiben, zählen
-- aber nicht mehr als Admin (app.has_admin).
CREATE FUNCTION app.set_user_active(p_user_id uuid, p_active boolean, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT app.is_org_admin(p_actor_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Organisations-Admins dürfen Personen deaktivieren';
  END IF;
  UPDATE users SET deactivated_at = CASE WHEN p_active THEN NULL ELSE now() END
  WHERE id = p_user_id AND tenant_id = app.current_tenant()
    AND (deactivated_at IS NULL) <> p_active;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT p_active THEN
    PERFORM app.emit_user_spaces(p_user_id, NULL, 'user.deactivated', jsonb_build_object('user', p_user_id));
  END IF;
  PERFORM app.audit(p_actor_id, CASE WHEN p_active THEN 'user.reactivated' ELSE 'user.deactivated' END,
                    'user', p_user_id);
END $$;

-- =============================================================================
-- Abläufe: Spaces und Rechte
-- =============================================================================

-- Space + Startseite + Ersteller als Space-Admin.
-- p_workspace_access: Rolle für alle Workspace-Mitglieder (ohne Gäste), NULL = keine.
-- SECURITY DEFINER, weil wiki_app Spaces, Grants und Seiten nicht direkt schreiben darf.
CREATE FUNCTION app.create_space(
  p_workspace_id uuid, p_key text, p_name text, p_actor_id uuid,
  p_workspace_access text DEFAULT 'viewer', p_description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_space  uuid := uuidv7();
  v_home   uuid := uuidv7();
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF NOT EXISTS (SELECT 1 FROM workspace_members
                 WHERE workspace_id = p_workspace_id AND user_id = p_actor_id
                   AND tenant_id = v_tenant AND role <> 'guest') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Workspace-Mitglieder (ohne Gäste) dürfen Spaces anlegen';
  END IF;
  IF p_workspace_access IS NOT NULL AND p_workspace_access NOT IN ('viewer', 'commenter', 'editor') THEN
    RAISE EXCEPTION 'create_space: ungültiger Zugriff für den Workspace: %', p_workspace_access;
  END IF;

  -- Kein RETURNING: Der neue Space ist erst nach dem Grant lesbar.
  INSERT INTO spaces (id, tenant_id, workspace_id, key, name, description, created_by)
  VALUES (v_space, v_tenant, p_workspace_id, upper(btrim(p_key)), btrim(p_name), p_description, p_actor_id);
  INSERT INTO grants (tenant_id, space_id, subject_type, user_id, role, created_by)
  VALUES (v_tenant, v_space, 'user', p_actor_id, 'admin', p_actor_id);
  IF p_workspace_access IS NOT NULL THEN
    INSERT INTO grants (tenant_id, space_id, subject_type, role, created_by)
    VALUES (v_tenant, v_space, 'workspace', p_workspace_access, p_actor_id);
  END IF;

  INSERT INTO pages (id, tenant_id, space_id, position, title, created_by, updated_by)
  VALUES (v_home, v_tenant, v_space, 'a0', btrim(p_name), p_actor_id, p_actor_id);
  INSERT INTO page_contents (page_id, tenant_id, ydoc) VALUES (v_home, v_tenant, '\x0000'::bytea);
  UPDATE spaces SET home_page_id = v_home WHERE id = v_space;

  PERFORM app.emit(v_tenant, v_space, 'space.created',
    jsonb_build_object('id', v_space, 'key', upper(btrim(p_key)), 'name', btrim(p_name), 'home_page', v_home));
  PERFORM app.audit(p_actor_id, 'space.created', 'space', v_space);
  RETURN v_space;
END $$;

-- Recht setzen oder entfernen (p_role NULL). Auf Seiten nur mit gekappter Vererbung.
-- Erlaubt für Admins des Objekts, Space-Admins und Organisations-Admins (Wiederherstellung).
-- SECURITY DEFINER, weil Space- und Organisations-Admins eingeschränkte Seiten nicht sehen müssen.
CREATE FUNCTION app.set_grant(
  p_space_id uuid, p_page_id uuid, p_subject_type text, p_user_id uuid, p_group_id uuid,
  p_role text, p_actor_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant   uuid := app.current_tenant();
  v_space    uuid := p_space_id;
  v_page     pages%ROWTYPE;
  v_allowed  boolean;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF (p_space_id IS NULL) = (p_page_id IS NULL) THEN
    RAISE EXCEPTION 'set_grant: genau ein Space oder eine Seite angeben';
  END IF;
  IF p_role IS NOT NULL AND app.role_rank(p_role) = 0 THEN
    RAISE EXCEPTION 'set_grant: ungültige Rolle %', p_role;
  END IF;
  IF p_subject_type = 'workspace' AND p_role = 'admin' THEN
    RAISE EXCEPTION 'set_grant: Alle im Workspace können nicht Admin sein, Admins namentlich oder als Gruppe vergeben';
  END IF;

  -- Objekt sperren: Zwei Admins, die sich gleichzeitig gegenseitig entfernen, laufen
  -- nacheinander, und der zweite scheitert an der Prüfung unten.
  IF p_page_id IS NOT NULL THEN
    SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'set_grant: Seite nicht gefunden'; END IF;
    IF v_page.inherit_perms THEN
      RAISE EXCEPTION 'set_grant: Die Seite erbt ihre Rechte, zuerst die Vererbung kappen';
    END IF;
    v_space := v_page.space_id;
    v_allowed := app.page_rank(p_page_id, p_actor_id) = 4;
  ELSE
    PERFORM 1 FROM spaces WHERE id = p_space_id AND tenant_id = v_tenant FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'set_grant: Space nicht gefunden';
    END IF;
    v_allowed := false;
  END IF;
  v_allowed := v_allowed OR app.space_rank(v_space, p_actor_id) = 4 OR app.is_org_admin(p_actor_id);
  IF NOT v_allowed THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen Rechte ändern';
  END IF;

  -- Nur beim Vergeben: Grants deaktivierter oder entfernter Personen lassen sich löschen.
  IF p_role IS NOT NULL AND p_subject_type = 'user' AND app.space_ws_role(v_space, p_user_id) IS NULL THEN
    RAISE EXCEPTION 'set_grant: Person ist kein aktives Mitglied des Workspaces';
  END IF;

  DELETE FROM grants
  WHERE tenant_id = v_tenant
    AND coalesce(space_id, page_id) = coalesce(p_space_id, p_page_id)
    AND subject_type = p_subject_type
    AND user_id IS NOT DISTINCT FROM p_user_id AND group_id IS NOT DISTINCT FROM p_group_id;
  IF p_role IS NOT NULL THEN
    INSERT INTO grants (tenant_id, space_id, page_id, subject_type, user_id, group_id, role, created_by)
    VALUES (v_tenant, p_space_id, p_page_id, p_subject_type, p_user_id, p_group_id, p_role, p_actor_id);
  END IF;

  -- Sofort prüfen (verständlicher Fehler); der Trigger admin_remains prüft beim Commit noch einmal.
  IF NOT app.has_admin(coalesce(p_space_id, p_page_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'restrict_violation',
      MESSAGE = 'Mindestens ein aktiver Admin muss bleiben';
  END IF;

  PERFORM app.emit(v_tenant, v_space, 'grant.changed',
    jsonb_build_object('space', p_space_id, 'page', p_page_id, 'subject_type', p_subject_type,
                       'user', p_user_id, 'group', p_group_id, 'role', p_role));
  PERFORM app.audit(p_actor_id, 'grant.changed', CASE WHEN p_page_id IS NULL THEN 'space' ELSE 'page' END,
    coalesce(p_space_id, p_page_id),
    jsonb_build_object('subject_type', p_subject_type, 'user_id', p_user_id,
                       'group_id', p_group_id, 'role', p_role));
END $$;

-- Vererbung kappen oder wiederherstellen. Beim Kappen werden die bisher geltenden
-- Rechte auf die Seite kopiert und die handelnde Person wird Admin der Seite.
-- Danach lassen sich die Rechte mit app.set_grant einschränken.
CREATE FUNCTION app.set_page_inheritance(p_page_id uuid, p_inherit boolean, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_source uuid;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  -- Baum exklusiv sperren: move_page berechnet die Rechtequelle aus inherit_perms.
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'set_page_inheritance: Seite nicht gefunden'; END IF;
  IF v_page.inherit_perms = p_inherit THEN RETURN; END IF;
  IF NOT (app.page_rank(p_page_id, p_actor_id) = 4
          OR app.space_rank(v_page.space_id, p_actor_id) = 4
          OR app.is_org_admin(p_actor_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen die Vererbung ändern';
  END IF;

  IF NOT p_inherit THEN
    -- Bisher geltende Quelle: nächste eingeschränkte Seite oberhalb oder der Space
    SELECT id INTO v_source FROM pages
    WHERE space_id = v_page.space_id AND path @> v_page.path AND id <> p_page_id AND NOT inherit_perms
    ORDER BY nlevel(path) DESC LIMIT 1;

    INSERT INTO grants (tenant_id, page_id, subject_type, user_id, group_id, role, created_by)
    SELECT v_tenant, p_page_id, g.subject_type, g.user_id, g.group_id, g.role, p_actor_id
    FROM grants g
    WHERE (v_source IS NULL AND g.space_id = v_page.space_id) OR g.page_id = v_source;

    DELETE FROM grants WHERE page_id = p_page_id AND subject_type = 'user' AND user_id = p_actor_id;
    INSERT INTO grants (tenant_id, page_id, subject_type, user_id, role, created_by)
    VALUES (v_tenant, p_page_id, 'user', p_actor_id, 'admin', p_actor_id);
  ELSE
    DELETE FROM grants WHERE page_id = p_page_id;
  END IF;

  UPDATE pages SET inherit_perms = p_inherit WHERE id = p_page_id;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.permissions_changed',
    jsonb_build_object('id', p_page_id, 'inherit', p_inherit));
  PERFORM app.audit(p_actor_id, CASE WHEN p_inherit THEN 'page.inheritance_restored'
                                     ELSE 'page.inheritance_cut' END, 'page', p_page_id);
END $$;

-- Name und Beschreibung eines Spaces ändern (Space-Admins).
CREATE FUNCTION app.update_space(p_space_id uuid, p_name text, p_description text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_space(p_space_id, p_actor_id, 'admin');
  UPDATE spaces SET name = btrim(p_name), description = p_description
  WHERE id = p_space_id AND tenant_id = v_tenant;
  PERFORM app.emit(v_tenant, p_space_id, 'space.updated',
    jsonb_build_object('id', p_space_id, 'name', btrim(p_name)));
  PERFORM app.audit(p_actor_id, 'space.updated', 'space', p_space_id);
END $$;

-- Space archivieren (nur noch lesbar) oder zurückholen. Erlaubt für Space-Admins (auch
-- im archivierten Space, dort gilt sonst höchstens viewer) und Organisations-Admins.
-- space.archived lässt den Collab-Server offene Verbindungen schreibgeschützt neu aufbauen.
CREATE FUNCTION app.archive_space(p_space_id uuid, p_archived boolean, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_ws_role text;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  v_ws_role := app.space_ws_role(p_space_id, p_actor_id);
  IF NOT ((v_ws_role IS NOT NULL AND app.grant_rank(p_space_id, NULL, p_actor_id, v_ws_role) = 4)
          OR app.is_org_admin(p_actor_id)) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur Admins dürfen einen Space archivieren';
  END IF;

  UPDATE spaces SET archived_at = CASE WHEN p_archived THEN now() END
  WHERE id = p_space_id AND tenant_id = v_tenant AND (archived_at IS NOT NULL) <> p_archived;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM app.emit(v_tenant, p_space_id, 'space.archived',
    jsonb_build_object('id', p_space_id, 'archived', p_archived));
  PERFORM app.audit(p_actor_id, CASE WHEN p_archived THEN 'space.archived' ELSE 'space.unarchived' END,
                    'space', p_space_id);
END $$;

-- =============================================================================
-- Abläufe: Seiten
-- =============================================================================

-- Seite anlegen. p_position kommt aus der App (npm-Paket "fractional-indexing");
-- NULL hängt die Seite hinter alle Geschwister (app.next_position).
-- SECURITY DEFINER, weil wiki_app Seiten und Inhalt nicht direkt einfügen darf.
CREATE FUNCTION app.create_page(
  p_space_id uuid, p_parent_id uuid, p_title text, p_actor_id uuid, p_position text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   uuid := uuidv7();
  v_pos    text := p_position;
BEGIN
  IF p_parent_id IS NULL THEN
    PERFORM app.require_space(p_space_id, p_actor_id, 'editor');
  ELSE
    PERFORM app.require_page(p_parent_id, p_actor_id, 'editor');
    IF NOT EXISTS (SELECT 1 FROM pages WHERE id = p_parent_id AND space_id = p_space_id
                   AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'create_page: Elternseite fehlt oder liegt in einem anderen Space';
    END IF;
  END IF;
  -- Erst nach der Sperre prüfen, ob die Elternseite gerade in den Papierkorb gewandert ist
  PERFORM app.lock_tree(p_space_id, false);
  IF EXISTS (SELECT 1 FROM pages WHERE id = p_parent_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'create_page: Die Elternseite liegt im Papierkorb';
  END IF;
  IF EXISTS (SELECT 1 FROM spaces WHERE id = p_space_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'create_page: Der Space ist archiviert';
  END IF;

  IF v_pos IS NULL THEN
    -- Über alle Geschwister, auch eingeschränkte und im Papierkorb (läuft als Eigentümer)
    v_pos := app.next_position((SELECT max(position COLLATE "C") FROM pages
                                WHERE space_id = p_space_id AND parent_id IS NOT DISTINCT FROM p_parent_id));
  END IF;

  INSERT INTO pages (id, tenant_id, space_id, parent_id, position, title, created_by, updated_by)
  VALUES (v_page, v_tenant, p_space_id, p_parent_id, v_pos, btrim(coalesce(p_title, '')), p_actor_id, p_actor_id);
  INSERT INTO page_contents (page_id, tenant_id, ydoc) VALUES (v_page, v_tenant, '\x0000'::bytea);

  PERFORM app.emit(v_tenant, p_space_id, 'page.created',
    jsonb_build_object('id', v_page, 'parent', p_parent_id, 'title', btrim(coalesce(p_title, '')),
                       'position', v_pos, 'by', p_actor_id));
  RETURN v_page;
END $$;

-- Seite (mit Teilbaum) verschieben, innerhalb desselben Spaces.
-- SECURITY DEFINER, weil der Teilbaum eingeschränkte Seiten enthalten kann, die die
-- handelnde Person nicht sieht; deren path muss trotzdem mitwandern.
-- Ändert sich dadurch, woher die Seite ihre Rechte hat (app.perm_source), gilt:
--   - Aus einer Seite mit eigenen Rechten heraus nur als Admin dieser Seite (sonst könnte
--     ein Editor eingeschränkte Inhalte für den ganzen Space freigeben).
--   - Hinein genügt editor auf dem Ziel.
--   - Es folgt page.permissions_changed, damit der Collab-Server Verbindungen neu prüft.
CREATE FUNCTION app.move_page(p_page_id uuid, p_new_parent_id uuid, p_position text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant     uuid := app.current_tenant();
  v_page       pages%ROWTYPE;
  v_parent     pages%ROWTYPE;
  v_new_path   ltree;
  v_old_source uuid;
  v_new_source uuid;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  IF p_position IS NULL OR p_position !~ '^[A-Za-z][0-9A-Za-z]{1,63}$' THEN
    RAISE EXCEPTION 'move_page: ungültige Position';
  END IF;
  -- Erst sperren, dann alles lesen und prüfen: Pfade und Rechte sind danach aktuell.
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_page.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'move_page: Seite liegt im Papierkorb';
  END IF;
  v_old_source := app.perm_source(p_page_id);

  IF p_new_parent_id IS NULL THEN
    PERFORM app.require_space(v_page.space_id, p_actor_id, 'editor');
    v_new_path := app.page_label(p_page_id);
    v_new_source := NULL;
  ELSE
    SELECT * INTO v_parent FROM pages WHERE id = p_new_parent_id AND tenant_id = v_tenant;
    IF NOT FOUND OR v_parent.space_id <> v_page.space_id THEN
      RAISE EXCEPTION 'move_page: Ziel liegt nicht im selben Space';
    END IF;
    IF v_parent.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'move_page: Ziel liegt im Papierkorb';
    END IF;
    IF v_parent.path <@ v_page.path THEN
      RAISE EXCEPTION 'move_page: Eine Seite kann nicht unter sich selbst verschoben werden';
    END IF;
    PERFORM app.require_page(p_new_parent_id, p_actor_id, 'editor');
    v_new_path := v_parent.path || app.page_label(p_page_id);
    v_new_source := app.perm_source(p_new_parent_id);
  END IF;

  -- Eine Seite mit eigenen Rechten bleibt ihre eigene Quelle, mitsamt erbender Unterseiten.
  IF NOT v_page.inherit_perms THEN
    v_new_source := v_old_source;
  END IF;
  IF v_old_source IS NOT NULL AND v_old_source IS DISTINCT FROM v_new_source
     AND app.page_rank(v_old_source, p_actor_id) < 4 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Die Seite verlässt einen Bereich mit eigenen Rechten, dafür ist dort die Rolle admin nötig';
  END IF;

  UPDATE pages
  SET path = v_new_path || CASE WHEN nlevel(path) > nlevel(v_page.path)
                                THEN subpath(path, nlevel(v_page.path)) ELSE ''::ltree END
  WHERE space_id = v_page.space_id AND path <@ v_page.path;
  UPDATE pages SET parent_id = p_new_parent_id, position = p_position,
                   updated_at = now(), updated_by = p_actor_id
  WHERE id = p_page_id;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.moved',
    jsonb_build_object('id', p_page_id, 'from_parent', v_page.parent_id,
                       'to_parent', p_new_parent_id, 'position', p_position));
  IF v_old_source IS DISTINCT FROM v_new_source THEN
    PERFORM app.emit(v_tenant, v_page.space_id, 'page.permissions_changed',
      jsonb_build_object('id', p_page_id, 'reason', 'moved',
                         'from_source', v_old_source, 'to_source', v_new_source));
  END IF;
  PERFORM app.audit(p_actor_id, 'page.moved', 'page', p_page_id,
    jsonb_build_object('from_parent', v_page.parent_id, 'to_parent', p_new_parent_id,
                       'from_source', v_old_source, 'to_source', v_new_source));
END $$;

-- Seite mit Teilbaum in den Papierkorb. Abgelehnt, wenn darunter eine Seite liegt,
-- die die handelnde Person nicht bearbeiten darf. Die Startseite bleibt.
CREATE FUNCTION app.trash_page(p_page_id uuid, p_actor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_count  integer;
BEGIN
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_page.deleted_at IS NOT NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM spaces WHERE home_page_id = p_page_id) THEN
    RAISE EXCEPTION 'trash_page: Die Startseite eines Spaces kann nicht gelöscht werden';
  END IF;
  IF EXISTS (SELECT 1 FROM pages
             WHERE space_id = v_page.space_id AND path <@ v_page.path AND deleted_at IS NULL
               AND app.page_rank(id, p_actor_id) < 3) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Unter dieser Seite liegen Seiten, die du nicht bearbeiten darfst';
  END IF;

  UPDATE pages SET deleted_at = now(), deleted_by = p_actor_id, trash_root_id = p_page_id
  WHERE space_id = v_page.space_id AND path <@ v_page.path AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.trashed',
    jsonb_build_object('id', p_page_id, 'count', v_count));
  PERFORM app.audit(p_actor_id, 'page.trashed', 'page', p_page_id, jsonb_build_object('count', v_count));
  RETURN v_count;
END $$;

-- Aus dem Papierkorb holen: genau die Seiten, die gemeinsam gelöscht wurden.
CREATE FUNCTION app.restore_page(p_page_id uuid, p_actor_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_page   pages%ROWTYPE;
  v_count  integer;
BEGIN
  PERFORM app.lock_tree((SELECT space_id FROM pages WHERE id = p_page_id AND tenant_id = v_tenant), true);
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  SELECT * INTO v_page FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_page.trash_root_id IS DISTINCT FROM p_page_id THEN
    RAISE EXCEPTION 'restore_page: Nur die Seite, die gelöscht wurde, lässt sich wiederherstellen';
  END IF;
  IF EXISTS (SELECT 1 FROM pages WHERE id = v_page.parent_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'restore_page: Zuerst die Elternseite wiederherstellen';
  END IF;

  UPDATE pages SET deleted_at = NULL, deleted_by = NULL, trash_root_id = NULL
  WHERE trash_root_id = p_page_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM app.emit(v_tenant, v_page.space_id, 'page.restored',
    jsonb_build_object('id', p_page_id, 'count', v_count));
  PERFORM app.audit(p_actor_id, 'page.restored', 'page', p_page_id, jsonb_build_object('count', v_count));
  RETURN v_count;
END $$;

-- =============================================================================
-- Abläufe: Inhalt und Versionen (Collab-Server und Worker)
-- =============================================================================

-- Yjs-Zustand speichern. Nur Hintergrunddienste: Der Collab-Server prüft die Rechte
-- beim Verbindungsaufbau über die API und speichert gebündelt (entprellt).
-- Der Titel lebt im Yjs-Dokument (Y.Text "title") und kommt nur über diese Funktion in
-- pages.title. Deshalb muss der Collab-Server bei einem frischen Dokument (ydoc = '\x0000')
-- in onLoadDocument zuerst pages.title in Y.Text "title" schreiben, sonst überschreibt das
-- erste Speichern den Titel mit einem leeren (CLAUDE.md Abschnitt 6).
-- Titel und Klartext werden gekürzt statt abgelehnt: Ein Fehler hier hieße, dass der
-- Collab-Server die Änderungen gar nicht mehr speichern kann.
CREATE FUNCTION app.store_content(
  p_page_id uuid, p_ydoc bytea, p_plain_text text, p_title text, p_editor_ids uuid[]
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
  v_space  uuid;
  v_title  text;
BEGIN
  PERFORM app.require_worker();
  SELECT space_id, coalesce(left(btrim(p_title), 255), title) INTO v_space, v_title
  FROM pages WHERE id = p_page_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_content: Seite fehlt oder liegt im Papierkorb';
  END IF;

  UPDATE page_contents
  SET ydoc = p_ydoc, plain_text = left(coalesce(p_plain_text, ''), 2000000), updated_at = now(),
      editors_since_version = ARRAY(SELECT DISTINCT e FROM unnest(editors_since_version || p_editor_ids) AS e
                                    WHERE e IS NOT NULL ORDER BY e)
  WHERE page_id = p_page_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store_content: Inhalt der Seite fehlt';
  END IF;

  UPDATE pages
  SET title = v_title, updated_at = now(),
      updated_by = coalesce(p_editor_ids[cardinality(p_editor_ids)], updated_by)
  WHERE id = p_page_id;

  PERFORM app.emit(v_tenant, v_space, 'page.updated',
    jsonb_build_object('id', p_page_id, 'title', v_title, 'editors', to_jsonb(p_editor_ids)));
END $$;

-- Version anlegen: automatisch (Worker, nach Ruhepause), manuell, beim Wiederherstellen
-- oder beim Import. Das eigentliche Wiederherstellen rechnet der Collab-Server in Yjs
-- (alter Stand als neues Update), danach ruft er diese Funktion mit kind = restore.
-- Intern: Snapshot des aktuellen Inhalts als nächste Version. Nicht für wiki_app
-- ausführbar; Aufrufer sind create_version (Worker) und save_version (geprüft).
CREATE FUNCTION app.insert_version(p_page_id uuid, p_kind text, p_actor_id uuid, p_restored_from integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_content page_contents%ROWTYPE;
  v_title   text;
  v_version integer;
BEGIN
  -- Versionsnummern serialisieren
  SELECT title INTO v_title FROM pages WHERE id = p_page_id AND tenant_id = v_tenant FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'create_version: Seite nicht gefunden'; END IF;
  SELECT * INTO v_content FROM page_contents WHERE page_id = p_page_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'create_version: Inhalt nicht gefunden'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM page_versions WHERE page_id = p_page_id;

  INSERT INTO page_versions (tenant_id, page_id, version, kind, restored_from, title, ydoc,
                             plain_text, author_ids, created_by)
  VALUES (v_tenant, p_page_id, v_version, p_kind, p_restored_from, v_title, v_content.ydoc,
          v_content.plain_text, v_content.editors_since_version, p_actor_id);
  UPDATE page_contents SET editors_since_version = '{}' WHERE page_id = p_page_id;
  RETURN v_version;
END $$;

-- Manuelle Version durch eine Person (Editor). SECURITY DEFINER, weil wiki_app Versionen
-- nicht direkt schreiben darf (sonst ließen sich fremde Inhalte als Version unterschieben).
CREATE FUNCTION app.save_version(p_page_id uuid, p_actor_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM app.require_page(p_page_id, p_actor_id, 'editor');
  RETURN app.insert_version(p_page_id, 'manual', p_actor_id, NULL);
END $$;

CREATE FUNCTION app.create_version(
  p_page_id uuid, p_kind text, p_actor_id uuid DEFAULT NULL, p_restored_from integer DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  IF p_kind = 'manual' THEN
    RETURN app.save_version(p_page_id, p_actor_id);
  END IF;
  PERFORM app.require_worker();
  RETURN app.insert_version(p_page_id, p_kind, p_actor_id, p_restored_from);
END $$;

-- Verlinkungen einer Seite ersetzen (Worker, nach dem Speichern).
CREATE FUNCTION app.replace_page_links(p_page_id uuid, p_to_page_ids uuid[])
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := app.current_tenant();
BEGIN
  PERFORM app.require_worker();
  DELETE FROM page_links WHERE from_page_id = p_page_id;
  INSERT INTO page_links (from_page_id, to_page_id, tenant_id)
  SELECT p_page_id, t, v_tenant FROM (SELECT DISTINCT unnest(p_to_page_ids) AS t) x
  WHERE t <> p_page_id AND EXISTS (SELECT 1 FROM pages WHERE id = t);
END $$;

-- =============================================================================
-- Abläufe: Kommentare
-- =============================================================================

-- Kommentare schreibt wiki_app nur über diese Funktionen (SECURITY DEFINER, Rechte und
-- Mandant werden ausdrücklich geprüft).
CREATE FUNCTION app.add_comment(
  p_page_id uuid, p_body text, p_actor_id uuid, p_anchor jsonb DEFAULT NULL, p_parent_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_tenant  uuid := app.current_tenant();
  v_comment uuid := uuidv7();
  v_space   uuid;
BEGIN
  PERFORM app.require_page(p_page_id, p_actor_id, 'commenter');
  IF EXISTS (SELECT 1 FROM pages WHERE id = p_page_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'add_comment: Die Seite liegt im Papierkorb';
  END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM comments WHERE id = p_parent_id AND page_id = p_page_id AND tenant_id = v_tenant
         AND parent_id IS NULL) THEN
    RAISE EXCEPTION 'add_comment: Antworten nur auf Kommentare derselben Seite, eine Ebene tief';
  END IF;
  SELECT space_id INTO v_space FROM pages WHERE id = p_page_id AND tenant_id = v_tenant;

  INSERT INTO comments (id, tenant_id, page_id, parent_id, author_id, body, anchor)
  VALUES (v_comment, v_tenant, p_page_id, p_parent_id, p_actor_id, p_body,
          CASE WHEN p_parent_id IS NULL THEN p_anchor END);

  -- Eine Antwort öffnet einen erledigten Thread wieder
  IF p_parent_id IS NOT NULL THEN
    UPDATE comments SET resolved_at = NULL, resolved_by = NULL
    WHERE id = p_parent_id AND resolved_at IS NOT NULL;
  END IF;

  PERFORM app.emit(v_tenant, v_space, 'comment.created',
    jsonb_build_object('id', v_comment, 'page', p_page_id, 'parent', p_parent_id, 'author', p_actor_id));
  RETURN v_comment;
END $$;

CREATE FUNCTION app.set_comment_resolved(p_comment_id uuid, p_actor_id uuid, p_resolved boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_c comments%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM comments WHERE id = p_comment_id AND tenant_id = app.current_tenant();
  IF NOT FOUND THEN RAISE EXCEPTION 'set_comment_resolved: Kommentar nicht gefunden'; END IF;
  IF v_c.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'set_comment_resolved: Nur ganze Threads lassen sich erledigen';
  END IF;
  PERFORM app.require_page(v_c.page_id, p_actor_id, 'commenter');
  UPDATE comments
  SET resolved_at = CASE WHEN p_resolved THEN now() END,
      resolved_by = CASE WHEN p_resolved THEN p_actor_id END
  WHERE id = p_comment_id;
END $$;

-- Eigenen Kommentar bearbeiten (mindestens commenter auf der Seite).
CREATE FUNCTION app.edit_comment(p_comment_id uuid, p_body text, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_c comments%ROWTYPE;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  SELECT * INTO v_c FROM comments WHERE id = p_comment_id AND tenant_id = app.current_tenant();
  IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'edit_comment: Kommentar nicht gefunden oder gelöscht';
  END IF;
  IF v_c.author_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'insufficient_privilege',
      MESSAGE = 'Nur eigene Kommentare lassen sich bearbeiten';
  END IF;
  PERFORM app.require_page(v_c.page_id, p_actor_id, 'commenter');
  UPDATE comments SET body = p_body, edited_at = now() WHERE id = p_comment_id;
END $$;

-- Kommentar löschen: Inhalt wird überschrieben. Eigene mit Leserecht auf der Seite,
-- fremde nur als Admin der Seite (bei eingeschränkten Seiten deren Admin, sonst Space-Admin).
CREATE FUNCTION app.delete_comment(p_comment_id uuid, p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_c comments%ROWTYPE;
BEGIN
  PERFORM app.require_actor(p_actor_id);
  SELECT * INTO v_c FROM comments WHERE id = p_comment_id AND tenant_id = app.current_tenant();
  IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF v_c.author_id IS DISTINCT FROM p_actor_id THEN
    PERFORM app.require_page(v_c.page_id, p_actor_id, 'admin');
    PERFORM app.audit(p_actor_id, 'comment.deleted', 'comment', p_comment_id);
  ELSE
    PERFORM app.require_page(v_c.page_id, p_actor_id, 'viewer');
  END IF;
  UPDATE comments SET body = NULL, deleted_at = now() WHERE id = p_comment_id;
END $$;

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

-- =============================================================================
-- Row Level Security
-- =============================================================================

-- 1. Mandantentrennung auf jeder Tabelle (für wiki_app und wiki_worker)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'workspaces', 'workspace_members', 'groups', 'group_members', 'invites',
    'spaces', 'pages', 'page_contents', 'page_versions', 'page_search', 'page_links',
    'grants', 'comments', 'files', 'imports', 'import_items', 'outbox', 'audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app.current_tenant()) '
      'WITH CHECK (tenant_id = app.current_tenant())', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app.current_tenant()) WITH CHECK (id = app.current_tenant());

-- 2. Leserechte für Anfragen von Personen (nur wiki_app)
--    Seiten: mindestens viewer, nach Vererbung aufgelöst
CREATE POLICY read_access ON pages AS RESTRICTIVE FOR SELECT TO wiki_app
USING (app.page_rank(id) >= 1);

--    Spaces: Rolle im Space, oder mindestens eine lesbare Seite darin (für die Brotkrume)
CREATE POLICY read_access ON spaces AS RESTRICTIVE FOR SELECT TO wiki_app
USING (app.space_rank(id) >= 1 OR EXISTS (SELECT 1 FROM pages p WHERE p.space_id = spaces.id));

--    Alles, was an einer Seite hängt, ist nur mit ihr sichtbar
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['page_contents', 'page_versions', 'page_search', 'comments']
  LOOP
    EXECUTE format(
      'CREATE POLICY read_access ON %I AS RESTRICTIVE FOR SELECT TO wiki_app '
      'USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = %I.page_id))', t, t);
  END LOOP;
END $$;

--    Verlinkungen: nur, wenn beide Seiten lesbar sind (sonst verrät der Titel etwas)
CREATE POLICY read_access ON page_links AS RESTRICTIVE FOR SELECT TO wiki_app
USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = page_links.from_page_id)
   AND EXISTS (SELECT 1 FROM pages p WHERE p.id = page_links.to_page_id));

--    Rechte: sichtbar, wer das Objekt lesen darf
CREATE POLICY read_access ON grants AS RESTRICTIVE FOR SELECT TO wiki_app
USING ((space_id IS NOT NULL AND app.space_rank(space_id) >= 1)
    OR (page_id IS NOT NULL AND app.page_rank(page_id) >= 1));

--    Dateien: an lesbaren Seiten, eigene Uploads oder Profilbilder (nie ein Anhang, auch
--    wenn jemand ihn als Profilbild einträgt)
CREATE POLICY read_access ON files AS RESTRICTIVE FOR SELECT TO wiki_app
USING (
  uploaded_by = app.current_user_id()
  OR (page_id IS NOT NULL AND EXISTS (SELECT 1 FROM pages p WHERE p.id = files.page_id))
  OR (page_id IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.avatar_file_id = files.id))
);

--    Audit-Log: nur Organisations-Admins
CREATE POLICY read_access ON audit_log AS RESTRICTIVE FOR SELECT TO wiki_app
USING (app.is_org_admin(app.current_user_id()));

--    Importe: eigene oder als Space-Admin
CREATE POLICY read_access ON imports AS RESTRICTIVE FOR SELECT TO wiki_app
USING (created_by = app.current_user_id() OR app.space_rank(space_id) = 4);
CREATE POLICY read_access ON import_items AS RESTRICTIVE FOR SELECT TO wiki_app
USING (EXISTS (SELECT 1 FROM imports i WHERE i.id = import_items.import_id));

-- 3. Direkte Schreibzugriffe von wiki_app (siehe Abschnitt Rechte: nur diese Tabellen
--    und Spalten). Alles andere läuft über die Funktionen oben.
--    Personen: neu nur als einfaches, aktives Mitglied (Anlegen beim ersten Login);
--    ändern nur das eigene Profil oder als Organisations-Admin. Profilbild nur eine eigene
--    Datei ohne Seite. Rolle und Deaktivieren: app.set_user_role, app.set_user_active.
CREATE POLICY write_insert ON users AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (role = 'member' AND deactivated_at IS NULL AND avatar_file_id IS NULL);
CREATE POLICY write_update ON users AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (id = app.current_user_id() OR app.is_org_admin(app.current_user_id()))
WITH CHECK (avatar_file_id IS NULL OR EXISTS (
  SELECT 1 FROM files f WHERE f.id = users.avatar_file_id AND f.page_id IS NULL AND f.uploaded_by = users.id));

--    Workspaces: anlegen nur Organisations-Admins, ändern auch Owner und Admins
CREATE POLICY write_insert ON workspaces AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (app.is_org_admin(app.current_user_id()));
CREATE POLICY write_update ON workspaces AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (app.is_workspace_admin(id, app.current_user_id()));

--    Einladungen: nur wer den Workspace verwaltet, eingeladen wird im eigenen Namen
CREATE POLICY write_access ON invites AS RESTRICTIVE FOR ALL TO wiki_app
USING (app.is_workspace_admin(workspace_id, app.current_user_id()))
WITH CHECK (app.is_workspace_admin(workspace_id, app.current_user_id()));
CREATE POLICY write_insert ON invites AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (invited_by = app.current_user_id());

--    Dateien: Upload im eigenen Namen, ungeprüft (scan_status setzt der Worker), an einer
--    Seite nur als editor. Löschen (deleted_at) durch Hochladende oder Editoren der Seite.
CREATE POLICY write_insert ON files AS RESTRICTIVE FOR INSERT TO wiki_app
WITH CHECK (uploaded_by = app.current_user_id() AND scan_status = 'pending'
            AND (page_id IS NULL OR app.page_rank(page_id) >= 3));
CREATE POLICY write_update ON files AS RESTRICTIVE FOR UPDATE TO wiki_app
USING (uploaded_by = app.current_user_id() OR (page_id IS NOT NULL AND app.page_rank(page_id) >= 3));

-- =============================================================================
-- Rechte
-- =============================================================================
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
-- Auch künftige Funktionen (Migrationen von wiki_owner) sind nicht von selbst ausführbar,
-- sondern werden ausdrücklich an wiki_app bzw. wiki_worker freigegeben. Global statt
-- IN SCHEMA app: Ein REVOKE pro Schema hebt das globale EXECUTE für PUBLIC nicht auf.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app TO wiki_app, wiki_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO wiki_app, wiki_worker;

-- Interne Bausteine: nur aus Funktionen heraus, die als Eigentümer laufen, bzw. vom Worker.
-- Sonst könnte wiki_app Events und Audit-Einträge fälschen, Versionen ohne Prüfung anlegen
-- oder die Rechte anderer Personen abfragen.
REVOKE EXECUTE ON FUNCTION
  app.emit(uuid, uuid, text, jsonb),
  app.emit_user_spaces(uuid, uuid, text, jsonb),
  app.audit(uuid, text, text, uuid, jsonb),
  app.insert_version(uuid, text, uuid, integer),
  app.lock_tree(uuid, boolean),
  app.page_rank(uuid, uuid),
  app.space_rank(uuid, uuid),
  app.grant_rank(uuid, uuid, uuid, text),
  app.space_ws_role(uuid, uuid),
  app.has_admin(uuid),
  app.perm_source(uuid)
FROM wiki_app;

-- wiki_app: Lesen, was die Regeln freigeben. Die Outbox liest nur der Worker.
GRANT SELECT ON
  tenants, users, workspaces, workspace_members, groups, group_members, invites,
  spaces, pages, page_contents, page_versions, page_search, page_links, grants, comments,
  files, imports, import_items, audit_log
TO wiki_app;

-- wiki_app: direkt schreiben nur hier, jeweils durch die Regeln oben abgesichert.
-- Rechte, Mitgliedschaften, Gruppen, Spaces, Seitenbaum, Inhalt, Versionen, Kommentare,
-- Import, Suchindex, Verlinkungen, Outbox und Audit-Log nur über Funktionen.
GRANT INSERT ON users TO wiki_app;
GRANT UPDATE (display_name, locale, time_zone, avatar_file_id) ON users TO wiki_app;
GRANT INSERT, UPDATE (slug, name, archived_at) ON workspaces TO wiki_app;
GRANT INSERT, UPDATE, DELETE ON invites TO wiki_app;
GRANT INSERT, UPDATE (deleted_at) ON files TO wiki_app;

-- wiki_worker: Collab-Server, Suchindex, Import, Outbox. Unterliegt nur der Mandantentrennung.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, users, workspaces, workspace_members, groups, group_members, invites,
  spaces, page_contents, page_versions, page_search, page_links, grants, comments,
  files, imports, import_items
TO wiki_worker;
-- pages: path, parent_id, space_id und Papierkorb ändern nur die Funktionen
GRANT SELECT, INSERT ON pages TO wiki_worker;
GRANT UPDATE (title, position, inherit_perms, updated_at, updated_by) ON pages TO wiki_worker;
GRANT DELETE ON pages TO wiki_worker;                       -- endgültiges Löschen aus dem Papierkorb
GRANT SELECT, INSERT, UPDATE ON outbox TO wiki_worker;      -- Worker veröffentlicht Events
GRANT SELECT, INSERT ON audit_log TO wiki_worker;           -- nur Anfügen

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
--   Papierkorb und Vererbung, geteilt für neue Seiten. Prüfung: schema_concurrency_test.sh.
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
