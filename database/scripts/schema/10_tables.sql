-- =============================================================================
-- NoteFieber: Tabellen und Indexe
-- Mandanten, Personen, Workspaces (wie TalkFieber) und die Wiki-Tabellen.
-- Teil von schema.sql: nur über schema.sql einspielen (Reihenfolge, eine Transaktion).
-- =============================================================================

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

-- Gruppen gehören dem Wiki. Quelle (source):
--   local   in der Oberfläche angelegt (app.create_group)
--   import  vom Confluence-Import angelegt, external_id = Gruppenname in Confluence (optional)
--   idp     aus dem Login-Token übernommen (app.sync_user_groups), external_id = Schlüssel im Login-Dienst
--   scim    später per SCIM geliefert, external_id = SCIM-ID
-- Mitglieder von local- und import-Gruppen pflegt das Wiki (app.add_group_member …), die von
-- idp- und scim-Gruppen ihre Quelle. Namen sind nicht eindeutig erzwungen.
CREATE TABLE groups (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  source       text NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'import', 'idp', 'scim')),
  external_id  text CHECK (length(external_id) BETWEEN 1 AND 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (source <> 'local' OR external_id IS NULL),
  CHECK (source NOT IN ('idp', 'scim') OR external_id IS NOT NULL),
  UNIQUE (tenant_id, source, external_id),
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

-- Aktueller Inhalt: Yjs-Zustand plus abgeleitete Fassungen (BlockNote-JSON, Klartext).
-- Geschrieben vom Collab-Server.
CREATE TABLE page_contents (
  page_id               uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL,
  ydoc                  bytea NOT NULL,               -- Yjs: encodeStateAsUpdate
  -- BlockNote-Dokument (Array von Blöcken) für Export, Import und einen späteren Editorwechsel.
  -- NULL = nicht vorhanden (zu groß oder nicht erzeugt); dann gilt nur ydoc.
  content_json          jsonb DEFAULT '[]'::jsonb
                          CHECK (content_json IS NULL OR (jsonb_typeof(content_json) = 'array'
                                 AND pg_column_size(content_json) <= 20000000)),
  plain_text            text NOT NULL DEFAULT '' CHECK (length(plain_text) <= 2000000),
  editors_since_version uuid[] NOT NULL DEFAULT '{}', -- für die Autorenliste der nächsten Version
  updated_at            timestamptz NOT NULL DEFAULT now(), -- letztes Speichern des Yjs-Zustands
  -- true = content_json und plain_text passen nicht mehr zu ydoc (Collab-Server hat
  -- gespeichert, der Worker hat noch nicht abgeleitet; app.store_ydoc, app.store_derived)
  derived_stale         boolean NOT NULL DEFAULT false,
  FOREIGN KEY (page_id, tenant_id) REFERENCES pages (id, tenant_id) ON DELETE CASCADE,
  CHECK (octet_length(ydoc) <= 50000000)              -- 50 MB pro Seite, darüber Alarm
);
-- Arbeit für den Worker (app.pages_to_derive): veraltete Seiten, Seiten ohne Yjs-Zustand
CREATE INDEX page_contents_stale   ON page_contents (updated_at) WHERE derived_stale;
CREATE INDEX page_contents_no_ydoc ON page_contents (updated_at)
  WHERE ydoc = '\x0000'::bytea AND content_json <> '[]'::jsonb;

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
  content_json  jsonb                       -- BlockNote-Dokument wie in page_contents, NULL = nicht vorhanden
                  CHECK (content_json IS NULL OR (jsonb_typeof(content_json) = 'array'
                         AND pg_column_size(content_json) <= 20000000)),
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

-- Sitzungen der API (Login über OIDC, docs/CONCEPTS.md Abschnitt 5). Das Cookie im Browser
-- enthält ein zufälliges Token; hier steht nur sein SHA-256-Hash. Abmelden und Deaktivieren
-- löschen die Zeile und wirken damit sofort. Schreiben nur über app.create_session,
-- app.end_session und app.set_user_active.
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_agent  text CHECK (length(user_agent) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- ID-Token aus dem Login, nur als id_token_hint fürs Abmelden beim Login-Dienst (sonst
  -- beendet Zitadel seine Sitzung erst nach einer Kontenauswahl). Der Browser sieht es nie.
  id_token    text CHECK (length(id_token) <= 10000),
  CHECK (expires_at > created_at),
  FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX sessions_by_user ON sessions (user_id);
