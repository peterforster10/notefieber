-- =============================================================================
-- Tests 29–35: Schreibwege und Admins: Vererbung, direkte Zugriffe, Verschieben, letzter Admin, Events
-- Teil von schema_test.sql: nur über schema_test.sql ausführen. Die Teile bauen
-- aufeinander auf (gemeinsame Testdaten, eine Transaktion, Reihenfolge fest).
-- Nutzt Testdaten aus früheren Teilen: arch c1 entw f_geh f_imp geh geh27 grp_dev home lukas lukas_page max peter priv sophie t1 ws1
-- Legt Testdaten an: c_peter luk ops
-- =============================================================================

-- 29. Vererbung ändern nur Admins, und nur über app.set_page_inheritance
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  ASSERT app.page_role(pg_temp.id('geh')) = 'editor', 'Voraussetzung: Lukas ist Editor der Gehälter';
  BEGIN
    UPDATE pages SET inherit_perms = true WHERE id = pg_temp.id('geh');
    RAISE EXCEPTION 'FEHLER: Editor hebt Einschränkung direkt auf';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE pages SET inherit_perms = false WHERE id = pg_temp.id('lukas_page');
    RAISE EXCEPTION 'FEHLER: Editor kappt Vererbung direkt';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.set_page_inheritance(pg_temp.id('geh'), true, pg_temp.id('lukas'));
    RAISE EXCEPTION 'FEHLER: Editor hebt Einschränkung über Funktion auf';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 29 Vererbung ändern nur Admins, nie direkt';
END $$;

-- 30. Kein Weg an den Funktionen vorbei: Ein Leser schreibt nichts direkt, was Rechte,
--     Inhalte, Import, Events oder das Audit-Log berührt
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
DECLARE
  t uuid := pg_temp.id('t1'); m uuid := pg_temp.id('max');
  v_sql text; n int;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    format('INSERT INTO grants (tenant_id, space_id, subject_type, user_id, role) VALUES (%L, %L, ''user'', %L, ''admin'')', t, pg_temp.id('entw'), m),
    format('DELETE FROM grants WHERE space_id = %L', pg_temp.id('entw')),
    format('UPDATE users SET role = ''org_admin'' WHERE id = %L', m),
    format('UPDATE users SET deactivated_at = now() WHERE id = %L', pg_temp.id('peter')),
    format('INSERT INTO users (tenant_id, email, display_name, role) VALUES (%L, ''boss@x.example'', ''Boss'', ''org_admin'')', t),
    format('UPDATE workspace_members SET role = ''owner'' WHERE user_id = %L', m),
    format('INSERT INTO group_members (group_id, user_id, tenant_id) VALUES (%L, %L, %L)', pg_temp.id('grp_dev'), m, t),
    format('INSERT INTO page_versions (tenant_id, page_id, version, kind, title, ydoc) VALUES (%L, %L, 99, ''manual'', ''x'', ''\x01''::bytea)', t, pg_temp.id('geh')),
    format('INSERT INTO page_contents (page_id, tenant_id, ydoc) VALUES (%L, %L, ''\x00''::bytea)', pg_temp.id('home'), t),
    format('INSERT INTO imports (tenant_id, space_id, file_id, dry_run, created_by) VALUES (%L, %L, %L, false, %L)', t, pg_temp.id('entw'), pg_temp.id('f_imp'), m),
    format('UPDATE spaces SET archived_at = NULL WHERE id = %L', pg_temp.id('priv')),
    format('UPDATE comments SET body = ''geändert'' WHERE id = %L', pg_temp.id('c1')),
    format('INSERT INTO outbox (tenant_id, subject, event_type, payload) VALUES (%L, ''x'', ''import.requested'', ''{}'')', t),
    format('INSERT INTO audit_log (tenant_id, actor_id, action, target_type) VALUES (%L, %L, ''x'', ''x'')', t, pg_temp.id('peter')),
    format('UPDATE tenants SET idp_org_id = ''fremd'' WHERE id = %L', t),
    format('INSERT INTO page_search (page_id, tenant_id, space_id, tsv) VALUES (%L, %L, %L, ''x'')', pg_temp.id('home'), t, pg_temp.id('entw')),
    format('INSERT INTO files (tenant_id, page_id, uploaded_by, storage_key, file_name, mime, size_bytes) VALUES (%L, %L, %L, ''k-x'', ''x'', ''x'', 1)', t, pg_temp.id('geh'), m),
    format('INSERT INTO files (tenant_id, uploaded_by, storage_key, file_name, mime, size_bytes, scan_status) VALUES (%L, %L, ''k-y'', ''x'', ''x'', 1, ''clean'')', t, m),
    format('UPDATE files SET scan_status = ''clean'' WHERE uploaded_by = %L', m),
    format('UPDATE users SET avatar_file_id = %L WHERE id = %L', pg_temp.id('f_geh'), m),
    format('INSERT INTO invites (tenant_id, workspace_id, email, role, token_hash, invited_by, expires_at) VALUES (%L, %L, ''zweit@x.example'', ''admin'', ''h-max'', %L, now() + interval ''1 day'')', t, pg_temp.id('ws1'), m)
  ] LOOP
    BEGIN
      EXECUTE v_sql;
      RAISE EXCEPTION 'FEHLER: direkt geschrieben: %', v_sql;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;

  -- Erlaubt bleibt das eigene Profil, fremde Profile nicht
  UPDATE users SET display_name = 'Max M.' WHERE id = m;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'eigenes Profil nicht änderbar';
  UPDATE users SET display_name = 'Gekapert' WHERE id = pg_temp.id('peter');
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'fremdes Profil änderbar';
  ASSERT (SELECT count(*) FROM audit_log) = 0, 'Audit-Log für Mitglieder lesbar';
  RAISE NOTICE 'OK 30 Kein direkter Weg an den Funktionen vorbei (Rechte, Inhalte, Import, Events, Audit)';
END $$;

-- 31. Verschieben aus einem eingeschränkten Bereich nur als dessen Admin, hinein als Editor
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  PERFORM app.move_page(pg_temp.id('geh27'), pg_temp.id('home'), 'a5', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: Editor holt Seite aus eingeschränktem Bereich';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
SELECT app.move_page(pg_temp.id('geh27'), pg_temp.id('home'), 'a5', pg_temp.id('peter'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('geh27')) = 1, 'vom Admin freigegebene Seite unsichtbar';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
SELECT app.move_page(pg_temp.id('geh27'), pg_temp.id('geh'), 'a0', pg_temp.id('lukas'));
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('max'));
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pages WHERE id = pg_temp.id('geh27')) = 0, 'Seite nach Verschieben in den Bereich sichtbar';
  RAISE NOTICE 'OK 31 Aus eingeschränkten Bereichen verschieben nur deren Admins';
END $$;

-- 32. Deaktivierte Admins zählen nicht, ihre Rechte lassen sich entfernen
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE s uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'OPS', 'Betrieb', pg_temp.id('peter'), NULL);
  INSERT INTO ids VALUES ('ops', s);
  PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('max'), NULL, 'admin', pg_temp.id('peter'));
  PERFORM app.set_user_active(pg_temp.id('max'), false, pg_temp.id('peter'));
  BEGIN
    PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('peter'), NULL, NULL, pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letzter aktiver Admin entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('max'), NULL, NULL, pg_temp.id('peter'));
  ASSERT NOT EXISTS (SELECT 1 FROM grants WHERE space_id = s AND user_id = pg_temp.id('max')),
    'Recht der deaktivierten Person nicht entfernbar';
  BEGIN
    PERFORM app.set_grant(s, NULL, 'user', pg_temp.id('max'), NULL, 'viewer', pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: Recht an deaktivierte Person vergeben';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%kein aktives Mitglied%' THEN RAISE; END IF;
  END;
  PERFORM app.set_user_active(pg_temp.id('max'), true, pg_temp.id('peter'));
  RAISE NOTICE 'OK 32 Deaktivierte Admins zählen nicht, ihre Rechte lassen sich entfernen';
END $$;

-- 33. Letzter Admin bleibt: beim Entfernen aus dem Workspace und als Rückfallebene im Trigger
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
DECLARE s uuid;
BEGIN
  s := app.create_space(pg_temp.id('ws1'), 'LUK', 'Lukas', pg_temp.id('lukas'), NULL);
  INSERT INTO ids VALUES ('luk', s);
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  BEGIN
    PERFORM app.remove_workspace_member(pg_temp.id('ws1'), pg_temp.id('lukas'), pg_temp.id('peter'));
    RAISE EXCEPTION 'FEHLER: letzter Admin eines Spaces aus dem Workspace entfernt';
  EXCEPTION WHEN restrict_violation THEN NULL;
  END;
  ASSERT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = pg_temp.id('ws1') AND user_id = pg_temp.id('lukas')),
    'Mitgliedschaft trotz Fehler entfernt';
END $$;
RESET ROLE;
SET ROLE wiki_worker;
SELECT pg_temp.ctx(pg_temp.id('t1'), NULL);
DO $$
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;   -- der Trigger prüft sonst erst beim Commit
  DELETE FROM grants WHERE space_id = pg_temp.id('luk') AND role = 'admin';
  RAISE EXCEPTION 'FEHLER: letzter Admin direkt gelöscht';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'OK 33 Letzter Admin bleibt, auch beim Entfernen aus dem Workspace und an Funktionen vorbei';
END $$;

-- 34. Entzogene Rechte erreichen den Collab-Server als Event
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'member.removed'
                 AND payload->>'user' = pg_temp.id('sophie')::text
                 AND subject = 't.' || pg_temp.id('t1') || '.wiki.s.' || pg_temp.id('entw')), 'member.removed fehlt';
  ASSERT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'user.deactivated'
                 AND payload->>'user' = pg_temp.id('max')::text), 'user.deactivated fehlt';
  ASSERT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'space.archived'
                 AND payload->>'id' = pg_temp.id('priv')::text), 'space.archived fehlt';
  ASSERT (SELECT count(*) FROM outbox WHERE event_type = 'page.permissions_changed'
          AND payload->>'id' = pg_temp.id('geh27')::text) = 2, 'page.permissions_changed beim Verschieben fehlt';
  ASSERT NOT EXISTS (SELECT 1 FROM outbox WHERE event_type = 'page.permissions_changed'
                     AND payload->>'id' = pg_temp.id('arch')::text), 'Event ohne Änderung der Rechtequelle';
  RAISE NOTICE 'OK 34 Events für entfernte Mitglieder, Deaktivieren, Archivieren und Verschieben';
END $$;
RESET ROLE;
SET ROLE wiki_app;

-- 35. Kommentare bearbeiten nur Autoren, fremde löschen nur Admins der Seite
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
DECLARE c uuid;
BEGIN
  c := app.add_comment(pg_temp.id('arch'), 'Erster Entwurf', pg_temp.id('peter'));
  INSERT INTO ids VALUES ('c_peter', c);
  PERFORM app.edit_comment(c, 'Zweiter Entwurf', pg_temp.id('peter'));
  ASSERT (SELECT body FROM comments WHERE id = c) = 'Zweiter Entwurf', 'Bearbeiten wirkt nicht';
  ASSERT (SELECT edited_at FROM comments WHERE id = c) IS NOT NULL, 'edited_at fehlt';
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('lukas'));
DO $$
BEGIN
  PERFORM app.edit_comment(pg_temp.id('c_peter'), 'Fremd geändert', pg_temp.id('lukas'));
  RAISE EXCEPTION 'FEHLER: fremder Kommentar bearbeitet';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
SELECT pg_temp.ctx(pg_temp.id('t1'), pg_temp.id('peter'));
DO $$
BEGIN
  PERFORM app.delete_comment(pg_temp.id('c1'), pg_temp.id('peter'));   -- Space-Admin, Kommentar von Sophie
  ASSERT (SELECT deleted_at FROM comments WHERE id = pg_temp.id('c1')) IS NOT NULL, 'Admin kann nicht löschen';
  RAISE NOTICE 'OK 35 Kommentare bearbeiten nur Autoren, fremde löschen nur Admins der Seite';
END $$;
