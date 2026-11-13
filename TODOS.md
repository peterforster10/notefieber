# TODOs

Offene Punkte aus der letzten Konsistenzprüfung. Erledigte Punkte abhaken und danach löschen;
Entscheidungen wandern in die `CLAUDE.md`.

Quelle: [REVIEW.md](REVIEW.md) vom 12. November 2026. Befund, Beleg und Fundstellen stehen
dort unter der jeweiligen ID. Änderungen am Schema wie immer in `schema/` **und** als neue
Migration, mit Test in `schema_test/` und Nachtrag in `docs/SCHEMA.md`.

## Vor M3 (Rechte-Dialog, Personenauswahl)

- [ ] **R-02 (Mittel):** `EXECUTE` auf `app.sync_user_groups` für `wiki_app` entziehen, bis
  ein Gruppen-Claim angebunden wird (E03); Test in `09_users_rules.sql`
- [ ] **R-03 (Mittel):** Leseregeln für `users`, `groups`, `group_members`, `workspaces`,
  `workspace_members`: Gäste sehen keine Personenliste (Abnahmekriterium E18). Vorher
  entscheiden, was einfache Mitglieder über andere Workspaces sehen; Tests in `04_isolation.sql`
- [ ] **R-04 (Mittel):** `app.accept_invite` sucht zuerst nach `(tenant_id, idp_subject)`;
  `resolveAccount` behandelt 23505 als `invite_other_login`. Tests in `14_invites.sql` und
  `invites.dbtest.ts`
- [ ] **R-06 (Mittel):** `INSERT` auf `users` und Policy `write_insert` für `wiki_app`
  entfernen; „neue Personen … (erster Login)“ in `CLAUDE.md` (Abschnitt 8),
  `docs/CONCEPTS.md`, `docs/SCHEMA.md` und `80_rls.sql` korrigieren
- [ ] **R-07 (Niedrig):** `invites` für `wiki_app` nur `UPDATE (revoked_at)`
- [ ] **R-09 (Niedrig):** erlaubte Aktionsnamen in `app.audit_event` begrenzen

## Mit M1 (Editor und Echtzeit, E04)

- [ ] **R-10 (Mittel):** Verhalten bei `page.trashed` während der Bearbeitung festlegen
  (Verbindung trennen oder schreibgeschützt); `RECONNECT_EVENTS` und `CLAUDE.md`,
  Abschnitt 6, ergänzen
- [ ] **R-15 (Niedrig):** Adresse des Collab-Servers einstellbar machen (`COLLAB_HOST`)
- [ ] **R-12 (Niedrig):** mit dem Outbox-Publisher den Index `outbox_unpublished` auf `id` umstellen

## Klein, jederzeit

- [ ] **R-18 (Mittel):** Abmelden mit `id_token_hint`, damit Zitadel die Sitzung ohne
  Kontenauswahl beendet; `check-login.mjs` prüft den Rücksprung zur Startseite
- [ ] **R-05:** Login-Rücksprung: übrige Fehler abfangen und auf `?loginError=login_failed` leiten
- [ ] **R-08:** `REVOKE CONNECT ON DATABASE wiki FROM PUBLIC` in `roles_database.sql`,
  Kommentar in `local_login_roles.sql` korrigieren; für den Cluster in M5 vormerken
- [ ] **R-11:** ↑/↓ im Seitenbaum für Seiten ohne sichtbare Elternseite ausblenden
- [ ] **R-13:** `/api/v1/health` ohne Datenbankrolle
- [ ] **R-14:** `postgres:18` und `node:24` in `compose.yaml` und `.gitlab-ci.yml` fest versionieren
- [ ] **R-16:** erwarteten OIDC-Fehler in `pnpm test:db` ohne Stacktrace
- [ ] **R-17:** `api()` im Frontend verträgt Fehlerantworten ohne JSON
- [ ] **D-01:** Pfad zum ER-Diagramm in `docs/CONCEPTS.md` (Abschnitt Datenmodell)
- [ ] **D-02:** fehlende Spalten im ER-Diagramm ergänzen oder den Verzicht vermerken, SVG neu erzeugen
- [ ] **D-03:** veraltete Sätze in `docs/ROADMAP.md` (M0, CI-Job `apps`), `docs/LOCAL_SETUP.md`
  (Beispielnummer der Migration), `schema.sql` (Stand) und `README.md` (Stand, CI-Jobs)
