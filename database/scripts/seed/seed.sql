-- =============================================================================
-- Testdaten für die lokale Entwicklung (nicht für Server mit echten Kunden).
-- Aufruf nach roles_database.sql und schema.sql, als wiki_owner und mit psql:
--   psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f seed.sql
-- Läuft in einer Transaktion: Entweder ist danach alles da oder nichts. Ein zweiter Lauf
-- bricht ab (Mandant alpenwerk vorhanden); zum Neuaufsetzen die Datenbank zurücksetzen
-- (docs/LOCAL_SETUP.md, Abschnitt 4, „Datenbank zurücksetzen“).
--
-- Wie die Tests geht das Skript über die Funktionen in app, jeweils als die handelnde
-- Person (wiki_app). Nur den Seiteninhalt schreibt es direkt als wiki_worker, so wie es
-- später Collab-Server und Import tun:
--   - content_json (BlockNote-Dokument) und plain_text sind gefüllt, ydoc bleibt leer
--     ('\x0000'). Beim ersten Öffnen baut der Collab-Server das Yjs-Dokument aus
--     content_json (CLAUDE.md Abschnitt 6, Schritt 3).
--   - page_search baut das Skript so, wie es der Worker täte; die Suche geht also sofort.
--   - Die Ereignisse bleiben unveröffentlicht in der Outbox, bis ein Worker läuft.
--
-- Inhalt (passend zum Prototyp in prototype/pages und zu den Beispielen in CONCEPTS.md):
--   Mandant Alpenwerk GmbH (alpenwerk), Workspace „Alpenwerk“
--     Peter Forster      Organisations-Admin, Owner, Gruppe Geschäftsleitung
--     Lukas Gruber    Mitglied, Gruppe Entwicklung
--     Sophie Bauer    Mitglied, Gruppe Entwicklung
--     Markus Wagner   Mitglied, Gruppe Entwicklung
--     Max Mustermann  Mitglied, Gruppe Vertrieb
--     Elena Novak     Gast (Agentur Nord), sieht nur „Kampagne Frühjahr“
--   Spaces
--     ENTW Entwicklung   alle lesen, Gruppe Entwicklung bearbeitet; Baum wie im Prototyp,
--                        „Personalplanung 2027“ nur für Peter und Lukas, Kommentare,
--                        zwei Versionen von „Datenmodell“, „Alte Notizen“ im Papierkorb
--     VERT Vertrieb      von Max angelegt, alle kommentieren; „Kampagne Frühjahr“ mit Elena
--     PERS Personal      privat, nur Peter
--     ALT  Altes Intranet archiviert (nur lesbar)
--   Mandant Nordlicht GmbH (nordlicht) mit Eva Fischer und Space DOKU, zum Prüfen der
--   Mandantentrennung
--
-- Login: Mandanten und Personen tragen dieselben festen IDs wie in der lokalen Zitadel-
-- Instanz (tenants.idp_org_id = Organisation, users.idp_subject = Person). Die legt
-- docker/zitadel/init.mjs an; beide Dateien zusammen ändern (docs/LOCAL_SETUP.md
-- Abschnitt 6). Gruppen gehören dem Wiki (Quelle local) und stehen nur hier, nicht in
-- Zitadel. E-Mail-Adressen unter example, damit nie echte Post rausgeht.
-- =============================================================================
\set QUIET on
\pset tuples_only on
\set ON_ERROR_STOP on
BEGIN;
SET client_min_messages = notice;
SET ROLE wiki_app;

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
GRANT SELECT, INSERT ON ids TO wiki_worker;

-- Hilfen: Kontext setzen, IDs nachschlagen
CREATE FUNCTION pg_temp.ctx(p_tenant uuid, p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.tenant_id', coalesce(p_tenant::text, ''), false),
         set_config('app.user_id',   coalesce(p_user::text, ''), false)
$$;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = p $$;

-- BlockNote-Dokument aus Absätzen; '## Text' wird eine Überschrift (Ebene 2)
CREATE FUNCTION pg_temp.doc(p_paras text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(
           jsonb_build_object(
             'id', gen_random_uuid(),
             'type', CASE WHEN t LIKE '## %' THEN 'heading' ELSE 'paragraph' END,
             'props', jsonb_build_object('textColor', 'default', 'backgroundColor', 'default',
                                         'textAlignment', 'left')
                      || CASE WHEN t LIKE '## %' THEN '{"level": 2}'::jsonb ELSE '{}'::jsonb END,
             'content', jsonb_build_array(jsonb_build_object(
                          'type', 'text', 'text', regexp_replace(t, '^## ', ''), 'styles', '{}'::jsonb)),
             'children', '[]'::jsonb)
           ORDER BY n), '[]'::jsonb)
  FROM unnest(p_paras) WITH ORDINALITY AS u(t, n)
$$;

-- Inhalt einer Seite schreiben, wie es der Collab-Server täte (nur als wiki_worker)
CREATE FUNCTION pg_temp.fill(p_page uuid, p_editor uuid, p_paras text[]) RETURNS void LANGUAGE sql AS $$
  UPDATE page_contents
  SET content_json = pg_temp.doc(p_paras),
      plain_text = array_to_string(ARRAY(SELECT regexp_replace(t, '^## ', '') FROM unnest(p_paras) AS t), E'\n'),
      editors_since_version = ARRAY(SELECT DISTINCT e FROM unnest(editors_since_version || p_editor) AS e ORDER BY e),
      updated_at = now()
  WHERE page_id = p_page;
  UPDATE pages SET updated_by = p_editor, updated_at = now() WHERE id = p_page;
$$;

-- Nicht doppelt einspielen
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.resolve_tenant('alpenwerk')) THEN
    RAISE EXCEPTION 'Testdaten sind schon eingespielt (Mandant alpenwerk vorhanden). Zum Neuaufsetzen die Datenbank zurücksetzen, siehe docs/LOCAL_SETUP.md.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Mandanten
-- -----------------------------------------------------------------------------
DO $$
DECLARE t uuid;
BEGIN
  t := app.create_tenant('alpenwerk', 'Alpenwerk GmbH', 'eu-central',
                         'peter.forster@alpenwerk.example', 'Peter Forster',
                         p_admin_idp_subject => 'user-peter-forster', p_idp_org_id => 'org-alpenwerk',
                         p_workspace_slug => 'alpenwerk', p_workspace_name => 'Alpenwerk');
  INSERT INTO ids SELECT 't1', t;
  INSERT INTO ids SELECT 'peter', id FROM users WHERE email = 'peter.forster@alpenwerk.example';
  INSERT INTO ids SELECT 'ws1', id FROM workspaces WHERE tenant_id = t;

  t := app.create_tenant('nordlicht', 'Nordlicht GmbH', 'eu-central',
                         'eva.fischer@nordlicht.example', 'Eva Fischer',
                         p_admin_idp_subject => 'user-eva-fischer', p_idp_org_id => 'org-nordlicht',
                         p_workspace_slug => 'nordlicht', p_workspace_name => 'Nordlicht');
  INSERT INTO ids SELECT 't2', t;
  INSERT INTO ids SELECT 'eva', id FROM users WHERE email = 'eva.fischer@nordlicht.example';
  INSERT INTO ids SELECT 'ws2', id FROM workspaces WHERE tenant_id = t;
END $$;

-- -----------------------------------------------------------------------------
-- Personen und Gruppen bei Alpenwerk (Peter nimmt sie in den Workspace auf)
-- -----------------------------------------------------------------------------
-- Die Personen legt der Eigentümer direkt an: wiki_app darf das nicht, neue Personen kommen
-- in Wirklichkeit nur über Einladungen (app.accept_invite). Die Aufnahme in den Workspace
-- geht trotzdem über app.add_workspace_member im Namen von Peter.
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter')); END $$;
RESET ROLE;
DO $$
DECLARE r record; u uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('lukas',  'lukas.gruber@alpenwerk.example',    'Lukas Gruber',   'member', false),
      ('sophie', 'sophie.bauer@alpenwerk.example',    'Sophie Bauer',   'member', false),
      ('markus', 'markus.wagner@alpenwerk.example',   'Markus Wagner',  'member', false),
      ('max',    'max.mustermann@alpenwerk.example',  'Max Mustermann', 'member', false),
      ('elena',  'elena.novak@agentur-nord.example',  'Elena Novak',    'guest',  true)
    ) AS v (k, email, name, ws_role, external)
  LOOP
    u := uuidv7();
    INSERT INTO users (id, tenant_id, idp_subject, email, display_name, is_external)
    VALUES (u, app.current_tenant(), 'user-' || replace(split_part(r.email, '@', 1), '.', '-'),
            r.email, r.name, r.external);
    INSERT INTO ids VALUES (r.k, u);
    PERFORM app.add_workspace_member(pg_temp.id('ws1'), u, r.ws_role, pg_temp.id('peter'));
  END LOOP;
END $$;
SET ROLE wiki_app;

-- Gruppen im Wiki (Quelle local), angelegt und befüllt von Peter als Organisations-Admin
DO $$
DECLARE r record; g uuid; m text;
BEGIN
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
  FOR r IN SELECT * FROM (VALUES
      ('grp_gl',   'Geschäftsleitung', ARRAY['peter']),
      ('grp_entw', 'Entwicklung',      ARRAY['lukas', 'sophie', 'markus']),
      ('grp_vert', 'Vertrieb',         ARRAY['max'])
    ) AS v (k, name, members)
  LOOP
    g := app.create_group(r.name, pg_temp.id('peter'));
    INSERT INTO ids VALUES (r.k, g);
    FOREACH m IN ARRAY r.members LOOP
      PERFORM app.add_group_member(g, pg_temp.id(m), pg_temp.id('peter'));
    END LOOP;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Space ENTW (wie im Prototyp)
-- -----------------------------------------------------------------------------
DO $$
DECLARE s uuid; h uuid; a uuid; b uuid; p uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'ENTW', 'Entwicklung', pg_temp.id('peter'), 'viewer',
                        'Architektur, Abläufe und Betrieb des Entwicklungsteams');
  SELECT home_page_id INTO h FROM spaces WHERE id = s;
  INSERT INTO ids VALUES ('entw', s), ('entw_home', h);
  PERFORM app.set_grant(s, NULL, 'group', NULL, pg_temp.id('grp_entw'), 'editor', pg_temp.id('peter'));

  a := app.create_page(s, h, 'Architektur', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('arch', a),
    ('dm',     app.create_page(s, a, 'Datenmodell', pg_temp.id('peter'))),
    ('rechte', app.create_page(s, a, 'Rechte-Konzept', pg_temp.id('peter'))),
    ('release', app.create_page(s, h, 'Release-Prozess', pg_temp.id('peter')));
  b := app.create_page(s, h, 'Betrieb', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('betrieb', b),
    ('backup', app.create_page(s, b, 'Backups und Wiederherstellung', pg_temp.id('peter')));
  p := app.create_page(s, b, 'Personalplanung 2027', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('personal', p),
    ('notizen', app.create_page(s, h, 'Alte Notizen', pg_temp.id('peter')));

  -- Personalplanung: eigene Rechte, nur Peter (Admin) und Lukas (Bereitschaftsplan)
  PERFORM app.set_page_inheritance(p, false, pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, p, 'workspace', NULL, NULL, NULL, pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, p, 'group', NULL, pg_temp.id('grp_entw'), NULL, pg_temp.id('peter'));
  PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('lukas'), NULL, 'editor', pg_temp.id('peter'));
END $$;

-- Kommentare (Textstellen-Anker brauchen eine Yjs-Position, daher Seitenkommentare)
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie')); END $$;
DO $$
DECLARE c uuid;
BEGIN
  c := app.add_comment(pg_temp.id('dm'),
         '„Jede Tabelle trägt tenant_id“: Gilt das auch für page_links? Dort hängen zwei Seiten dran.',
         pg_temp.id('sophie'));
  INSERT INTO ids VALUES ('kommentar_dm', c);
END $$;
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas')); END $$;
DO $$ BEGIN PERFORM app.add_comment(pg_temp.id('dm'), 'Ja, ergänzt. Der Schematest prüft jetzt alle Tabellen.', pg_temp.id('lukas'), NULL, pg_temp.id('kommentar_dm')); END $$;
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('markus')); END $$;
DO $$
DECLARE c uuid;
BEGIN
  c := app.add_comment(pg_temp.id('release'), 'Brauchen wir für pilot zwei Freigaben im Review?', pg_temp.id('markus'));
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
  PERFORM app.add_comment(pg_temp.id('release'), 'Nein, eine Freigabe reicht.', pg_temp.id('peter'), NULL, c);
  PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('markus'));
  PERFORM app.set_comment_resolved(c, pg_temp.id('markus'), true);
END $$;

-- Lukas räumt auf: „Alte Notizen“ in den Papierkorb
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas')); END $$;
DO $$ BEGIN PERFORM app.trash_page(pg_temp.id('notizen'), pg_temp.id('lukas')); END $$;

-- -----------------------------------------------------------------------------
-- Space VERT (Max), mit Freigabe für den Gast Elena
-- -----------------------------------------------------------------------------
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max')); END $$;
DO $$
DECLARE s uuid; h uuid; k uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'VERT', 'Vertrieb', pg_temp.id('max'), 'commenter',
                        'Angebote, Kunden und Kampagnen');
  SELECT home_page_id INTO h FROM spaces WHERE id = s;
  INSERT INTO ids VALUES ('vert', s), ('vert_home', h),
    ('angebote', app.create_page(s, h, 'Angebote 2027', pg_temp.id('max')));
  k := app.create_page(s, h, 'Kampagne Frühjahr', pg_temp.id('max'));
  INSERT INTO ids VALUES ('kampagne', k);
  PERFORM app.set_page_inheritance(k, false, pg_temp.id('max'));
  PERFORM app.set_grant(NULL, k, 'user', pg_temp.id('elena'), NULL, 'commenter', pg_temp.id('max'));
END $$;
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('elena')); END $$;
DO $$ BEGIN PERFORM app.add_comment(pg_temp.id('kampagne'), 'Die Entwürfe für die Plakate kommen bis Freitag.', pg_temp.id('elena')); END $$;

-- -----------------------------------------------------------------------------
-- Space PERS (privat, nur Peter) und ALT (archiviert)
-- -----------------------------------------------------------------------------
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter')); END $$;
DO $$
DECLARE s uuid; h uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'PERS', 'Personal', pg_temp.id('peter'), NULL, 'Nur für die Geschäftsleitung');
  SELECT home_page_id INTO h FROM spaces WHERE id = s;
  INSERT INTO ids VALUES ('pers', s), ('pers_home', h),
    ('urlaub',   app.create_page(s, h, 'Urlaubsregelung', pg_temp.id('peter'))),
    ('gehalt',   app.create_page(s, h, 'Gehaltsbänder 2027', pg_temp.id('peter')));

  s := app.create_space(pg_temp.id('ws1'), 'ALT', 'Altes Intranet', pg_temp.id('peter'), 'viewer', 'Archiv, nur noch lesbar');
  SELECT home_page_id INTO h FROM spaces WHERE id = s;
  INSERT INTO ids VALUES ('alt', s), ('alt_home', h),
    ('telefon', app.create_page(s, h, 'Telefonliste (veraltet)', pg_temp.id('peter')));
  PERFORM app.archive_space(s, true, pg_temp.id('peter'));
END $$;

-- -----------------------------------------------------------------------------
-- Nordlicht: ein zweiter Mandant, den bei Alpenwerk niemand sieht
-- -----------------------------------------------------------------------------
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t2'), pg_temp.id('eva')); END $$;
DO $$
DECLARE s uuid; h uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws2'), 'DOKU', 'Dokumentation', pg_temp.id('eva'));
  SELECT home_page_id INTO h FROM spaces WHERE id = s;
  INSERT INTO ids VALUES ('doku', s), ('doku_home', h),
    ('handbuch', app.create_page(s, h, 'Handbuch', pg_temp.id('eva')));
END $$;

-- -----------------------------------------------------------------------------
-- Inhalte, Versionen und Suchindex (als wiki_worker, wie Collab-Server und Worker)
-- -----------------------------------------------------------------------------
RESET ROLE;
SET ROLE wiki_worker;
DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t1'), NULL); END $$;
DO $$
BEGIN
  -- ENTW (Texte aus dem Prototyp)
  PERFORM pg_temp.fill(pg_temp.id('entw_home'), pg_temp.id('peter'), ARRAY[
    'Hier dokumentiert das Entwicklungsteam von Alpenwerk Architektur, Abläufe und Betrieb.',
    'Neue Seiten bitte unter dem passenden Bereich anlegen. Seiten mit eigenen Rechten sind mit einem Schloss markiert.']);
  PERFORM pg_temp.fill(pg_temp.id('arch'), pg_temp.id('lukas'), ARRAY[
    'Frontend, API und Collab-Server laufen als eigene Prozesse. PostgreSQL ist die einzige Wahrheit für Struktur, Rechte und Inhalt.']);
  -- Datenmodell: erster Stand von Sophie und Lukas, daraus Version 1, dann ein zweiter Stand
  PERFORM pg_temp.fill(pg_temp.id('dm'), pg_temp.id('sophie'), ARRAY[
    '## Grundsätze',
    'Jede Tabelle trägt tenant_id und hat Row Level Security.']);
  PERFORM pg_temp.fill(pg_temp.id('dm'), pg_temp.id('lukas'), ARRAY[
    '## Grundsätze',
    'Jede Tabelle trägt tenant_id und hat Row Level Security.',
    'IDs sind UUIDv7 und werden mit uuidv7() erzeugt.']);
  PERFORM app.create_version(pg_temp.id('dm'), 'auto');
  PERFORM pg_temp.fill(pg_temp.id('dm'), pg_temp.id('sophie'), ARRAY[
    '## Grundsätze',
    'Jede Tabelle trägt tenant_id und hat Row Level Security, auch page_links.',
    'IDs sind UUIDv7 und werden mit uuidv7() erzeugt.',
    '## Seitenbaum',
    'parent_id, path (ltree) und position (Fractional Index) bilden den Baum.']);
  PERFORM pg_temp.fill(pg_temp.id('rechte'), pg_temp.id('peter'), ARRAY[
    'Rechte werden am Space vergeben und an Seiten vererbt. Eine Seite kann die Vererbung kappen und eigene Rechte bekommen.']);
  PERFORM pg_temp.fill(pg_temp.id('release'), pg_temp.id('markus'), ARRAY[
    'Jeder Merge rollt automatisch nach staging aus. Für pilot braucht es eine Freigabe im Review.']);
  PERFORM pg_temp.fill(pg_temp.id('betrieb'), pg_temp.id('lukas'), ARRAY[
    'Alles zum Cluster auf dem VPS: Backups, Überwachung und Bereitschaft.']);
  PERFORM pg_temp.fill(pg_temp.id('backup'), pg_temp.id('lukas'), ARRAY[
    'CloudNativePG sichert laufend in einen S3-Speicher bei einem anderen Anbieter. Die Wiederherstellung wird einmal pro Quartal geprobt.']);
  PERFORM pg_temp.fill(pg_temp.id('personal'), pg_temp.id('peter'), ARRAY[
    'Bereitschaftsplan und Personalplanung für 2027. Diese Seite sehen nur ausgewählte Personen.']);
  PERFORM pg_temp.fill(pg_temp.id('notizen'), pg_temp.id('lukas'), ARRAY[
    'Notizen aus dem Kick-off, inzwischen in die richtigen Seiten übertragen.']);

  -- VERT
  PERFORM pg_temp.fill(pg_temp.id('vert_home'), pg_temp.id('max'), ARRAY[
    'Angebote, Kunden und Kampagnen des Vertriebs. Kommentieren dürfen alle bei Alpenwerk.']);
  PERFORM pg_temp.fill(pg_temp.id('angebote'), pg_temp.id('max'), ARRAY[
    'Preisliste und Vorlagen für Angebote 2027.']);
  PERFORM pg_temp.fill(pg_temp.id('kampagne'), pg_temp.id('max'), ARRAY[
    '## Gemeinsam mit der Agentur Nord',
    'Zielgruppen, Termine und Freigaben für die Frühjahrskampagne. Elena Novak von der Agentur Nord kann hier kommentieren.']);

  -- PERS und ALT
  PERFORM pg_temp.fill(pg_temp.id('pers_home'), pg_temp.id('peter'), ARRAY[
    'Personalthemen der Geschäftsleitung. Dieser Space ist privat.']);
  PERFORM pg_temp.fill(pg_temp.id('urlaub'), pg_temp.id('peter'), ARRAY[
    'Urlaub bitte spätestens vier Wochen vorher im Team abstimmen.']);
  PERFORM pg_temp.fill(pg_temp.id('gehalt'), pg_temp.id('peter'), ARRAY[
    'Gehaltsbänder 2027 je Stufe, vertraulich.']);
  PERFORM pg_temp.fill(pg_temp.id('alt_home'), pg_temp.id('peter'), ARRAY[
    'Das alte Intranet ist archiviert und nur noch lesbar.']);
  PERFORM pg_temp.fill(pg_temp.id('telefon'), pg_temp.id('peter'), ARRAY[
    'Diese Liste wird nicht mehr gepflegt. Aktuelle Durchwahlen stehen im Login-Dienst.']);
END $$;

-- Suchindex wie der Worker (Titel stärker gewichtet); Seiten im Papierkorb gehören nicht hinein
INSERT INTO page_search (page_id, tenant_id, space_id, tsv)
SELECT p.id, p.tenant_id, p.space_id,
       setweight(to_tsvector('german', p.title), 'A') || setweight(to_tsvector('german', c.plain_text), 'B')
FROM pages p JOIN page_contents c ON c.page_id = p.id
WHERE p.deleted_at IS NULL;

DO $$ BEGIN PERFORM pg_temp.ctx(pg_temp.id('t2'), NULL); END $$;
DO $$
BEGIN
  PERFORM pg_temp.fill(pg_temp.id('doku_home'), pg_temp.id('eva'), ARRAY[
    'Dokumentation der Nordlicht GmbH. Bei Alpenwerk ist davon nichts zu sehen.']);
  PERFORM pg_temp.fill(pg_temp.id('handbuch'), pg_temp.id('eva'), ARRAY[
    'Das Handbuch beschreibt Abläufe und Zuständigkeiten.']);
END $$;
INSERT INTO page_search (page_id, tenant_id, space_id, tsv)
SELECT p.id, p.tenant_id, p.space_id,
       setweight(to_tsvector('german', p.title), 'A') || setweight(to_tsvector('german', c.plain_text), 'B')
FROM pages p JOIN page_contents c ON c.page_id = p.id
WHERE p.deleted_at IS NULL;

RESET ROLE;

-- -----------------------------------------------------------------------------
-- Übersicht
-- -----------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'Testdaten eingespielt:';
  FOR r IN
    SELECT t.slug, count(DISTINCT u.id) AS personen, count(DISTINCT s.id) AS spaces,
           count(DISTINCT p.id) AS seiten
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id
    LEFT JOIN spaces s ON s.tenant_id = t.id
    LEFT JOIN pages p ON p.tenant_id = t.id
    WHERE t.slug IN ('alpenwerk', 'nordlicht')
    GROUP BY t.slug ORDER BY t.slug
  LOOP
    RAISE NOTICE '  %: % Personen, % Spaces, % Seiten', r.slug, r.personen, r.spaces, r.seiten;
  END LOOP;
END $$;

COMMIT;
\echo 'Testdaten eingespielt (Alpenwerk und Nordlicht).'
