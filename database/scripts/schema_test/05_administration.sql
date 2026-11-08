-- =============================================================================
-- Tests 21–24: Verwaltung: Mitglieder entfernen, letzter Owner, Organisations-Admin, Archiv
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: lukas peter sophie t1 ws1
-- Legt Testdaten an: priv
-- =============================================================================

-- 21. Aus dem Workspace entfernt: persönliche Rechte weg, nichts mehr sichtbar
SELECT app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('sophie'), pg_temp.id('peter'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM grants WHERE user_id = pg_temp.id('sophie')) = 0, 'Rechte bleiben';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('sophie'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages) = 0, 'entfernte Person sieht Seiten';
  RAISE NOTICE 'OK 21 Aus dem Workspace entfernt: Rechte weg, Seiten unsichtbar';
END $$;

-- 22. Letzter Owner und letzter Organisations-Admin bleiben
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  BEGIN
    PERFORM app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('peter'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letzter Owner entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.set_user_role(pg_temp.id('peter'), 'member', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letzter Organisations-Admin herabgestuft';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  RAISE NOTICE 'OK 22 Letzter Owner und letzter Organisations-Admin geschützt';
END $$;

-- 23. Organisations-Admin: kein automatischer Lesezugriff, aber Wiederherstellung von Rechten
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE s uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'PRIV', 'Privat', pg_temp.id('lukas'), NULL);
  INSERT INTO ids VALUES ('priv', s);
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM spaces WHERE id = pg_temp.id('priv')) = 0, 'Org-Admin sieht privaten Space';
  PERFORM app.set_grant(pg_temp.id('priv'), NULL, 'user', pg_temp.id('peter'), NULL, 'admin', pg_temp.id('peter'));
  ASSERT (SELECT count(*) FROM spaces WHERE id = pg_temp.id('priv')) = 1, 'Wiederherstellung wirkt nicht';
  ASSERT (SELECT count(*) FROM audit_log WHERE action = 'grant.changed' AND target_id = pg_temp.id('priv')) = 1,
    'Wiederherstellung nicht im Audit-Log';
  RAISE NOTICE 'OK 23 Organisations-Admin liest nicht automatisch, kann Rechte aber nachvollziehbar wiederherstellen';
END $$;

-- 24. Archivierte Spaces sind nur noch lesbar
SELECT app.archive_space(pg_temp.id('priv'), true, pg_temp.id('peter'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.space_role(pg_temp.id('priv')) = 'viewer', 'archivierter Space nicht nur lesbar';
  ASSERT app.page_role((SELECT home_page_id FROM spaces WHERE id = pg_temp.id('priv'))) = 'viewer',
    'Seite im archivierten Space nicht nur lesbar';
  PERFORM app.create_page(pg_temp.id('priv'), NULL, 'Neu', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: Seite in archiviertem Space';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK 24 Archivierte Spaces sind nur lesbar';
END $$;
