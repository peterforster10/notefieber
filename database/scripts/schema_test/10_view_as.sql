-- =============================================================================
-- Test 43: „Ansehen als …“ (app.view_as)
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: entw geh home luk lukas max peter t1
-- Legt Testdaten an: lukas_privat lukas_privat_kind
-- =============================================================================

-- 43. „Ansehen als …“: nur für Admins, dieselben Rollen wie page_rank, nur Struktur,
--     Seiten mit eigenen Rechten nur für deren Admins, jeder Aufruf im Audit-Log
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  PERFORM * FROM app.view_as(pg_temp.id('entw'), pg_temp.id('lukas'), pg_temp.id('max'));
  RAISE EXCEPTION 'FEHLER: Nicht-Admin sieht, was andere sehen';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- Lukas wird Admin des Spaces und legt eine Seite mit eigenen Rechten an, auf der Peter
-- nicht Admin ist (alle im Workspace, also auch Max, dürfen sie weiter lesen).
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.set_grant(pg_temp.id('entw'), NULL, 'user', pg_temp.id('lukas'), NULL, 'admin', pg_temp.id('peter'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE p uuid; k uuid;
BEGIN
  p := app.create_page(pg_temp.id('entw'), pg_temp.id('home'), 'Lukas privat', pg_temp.id('lukas'));
  PERFORM app.set_page_inheritance(p, false, pg_temp.id('lukas'));
  PERFORM app.set_grant(NULL, p, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('lukas'));
  k := app.create_page(pg_temp.id('entw'), p, 'Lukas privat, Unterseite', pg_temp.id('lukas'));
  INSERT INTO ids VALUES ('lukas_privat', p), ('lukas_privat_kind', k);
END $$;

-- Peter (Admin des Spaces) sieht den Space so, wie Max ihn sieht
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
CREATE TEMP TABLE va_max AS
  SELECT * FROM app.view_as(pg_temp.id('entw'), pg_temp.id('max'), pg_temp.id('peter'));

-- Als Max gegenprüfen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE privat ltree;
BEGIN
  ASSERT (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
          WHERE attrelid = 'va_max'::regclass AND attnum > 0 AND NOT attisdropped)
       = ARRAY['page_id', 'parent_id', 'path', 'position', 'title', 'inherit_perms', 'role'],
    'view_as liefert mehr als Struktur und Rolle';
  ASSERT NOT EXISTS (SELECT 1 FROM va_max v WHERE v.role IS DISTINCT FROM app.page_role(v.page_id)),
    'Rolle weicht von page_rank ab';
  -- Seiten, die Max nicht sieht, stehen mit Rolle NULL drin (dafür ist das Werkzeug da)
  ASSERT EXISTS (SELECT 1 FROM va_max WHERE page_id = pg_temp.id('geh') AND role IS NULL),
    'eingeschränkte Seite fehlt oder hat eine Rolle';
  -- Seiten mit eigenen Rechten, die Peter nicht verwaltet, fehlen samt Unterseiten,
  -- auch wenn Max sie lesen darf
  ASSERT app.page_role(pg_temp.id('lukas_privat_kind')) = 'viewer', 'Voraussetzung: Max liest Lukas privat';
  ASSERT NOT EXISTS (SELECT 1 FROM va_max WHERE page_id IN (pg_temp.id('lukas_privat'), pg_temp.id('lukas_privat_kind'))),
    'Seite ohne Admin-Recht der handelnden Person sichtbar';
  -- Alles andere, was Max im Space liest, steht mit Rolle drin; der Papierkorb fehlt
  SELECT path INTO privat FROM pages WHERE id = pg_temp.id('lukas_privat');
  ASSERT (SELECT count(*) FROM va_max WHERE role IS NOT NULL)
       = (SELECT count(*) FROM pages WHERE space_id = pg_temp.id('entw') AND deleted_at IS NULL AND NOT path <@ privat),
    'nicht alle für Max lesbaren Seiten enthalten';
  ASSERT NOT EXISTS (SELECT 1 FROM va_max v JOIN pages p ON p.id = v.page_id WHERE p.deleted_at IS NOT NULL),
    'Seiten im Papierkorb enthalten';
END $$;

-- Lukas sieht seine Seite, aber nicht die Gehälter (dort ist er nur editor)
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT (SELECT role FROM app.view_as(pg_temp.id('entw'), pg_temp.id('max'), pg_temp.id('lukas'))
          WHERE page_id = pg_temp.id('lukas_privat_kind')) = 'viewer', 'eigene Seite fehlt';
  ASSERT NOT EXISTS (SELECT 1 FROM app.view_as(pg_temp.id('entw'), pg_temp.id('max'), pg_temp.id('lukas'))
                     WHERE page_id = pg_temp.id('geh')), 'Seite ohne Admin-Recht sichtbar';
END $$;

-- Organisations-Admins dürfen auch ohne Rolle im Space (Peters Zugang zu LUK hängt nur an
-- ihrer Rolle als Organisations-Admin), und jeder Aufruf steht im Audit-Log
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  ASSERT app.space_role(pg_temp.id('luk')) IS NULL, 'Voraussetzung: Peter hat keine Rolle in LUK';
  ASSERT (SELECT count(*) FROM app.view_as(pg_temp.id('luk'), pg_temp.id('max'), pg_temp.id('peter'))
          WHERE role IS NULL) >= 1, 'Organisations-Admin kann nicht ansehen';
  ASSERT (SELECT count(*) FROM audit_log WHERE action = 'space.viewed_as'
          AND details->>'user_id' = pg_temp.id('max')::text) = 4, 'nicht jeder Aufruf im Audit-Log';
  ASSERT EXISTS (SELECT 1 FROM audit_log WHERE action = 'space.viewed_as'
                 AND actor_id = pg_temp.id('lukas') AND target_id = pg_temp.id('entw')), 'Aufruf von Lukas fehlt';
  RAISE NOTICE 'OK 43 „Ansehen als …“: nur Admins, Rollen wie page_rank, nur Struktur, im Audit-Log';
END $$;
