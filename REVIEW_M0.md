# Review M0: Code und Dokumentation

**Momentaufnahme vom 12. November 2026** (Stand `c2e13da`, M0 abgeschlossen), wird nicht
nachgeführt. Die umsetzbaren Punkte stehen in [TODOS.md](TODOS.md); dort abhaken und löschen,
hier bleibt der Befund als Beleg stehen.

**Umfang:** alles außer `prototype/`: Datenbank (Schema, Migrationen, Tests, Testdaten), API,
Worker, Collab-Server, Frontend, `packages/shared`, lokale Umgebung, CI, Skripte und alle
Dokumente. Prüfmaßstab sind die Regeln aus `CLAUDE.md` (Abschnitte 3, 6, 8 und 13).

**Vorgehen:** erst alle automatischen Prüfungen, dann jede Datei gelesen. Jeder Befund ab
„Mittel“ ist im Code nachgeprüft; R-01 bis R-04 und R-06 zusätzlich mit Abfragen in einer
Wegwerf-Datenbank (Migrationen und `seed.sql`, als `wiki_app`, jeweils zurückgerollt).
Danach Login und Oberfläche gegen die lokale Umgebung (`compose.yaml`, `pnpm dev:api`,
`pnpm dev:web`): `scripts/check-login.mjs` und ein Durchgang im Browser mit drei Testpersonen.

## Gesamteinschätzung

Das Fundament ist ungewöhnlich sorgfältig. Die Rechte liegen in der Datenbank
(`SECURITY DEFINER` mit festem `search_path`, Mandant in jeder Abfrage, interne Bausteine für
`wiki_app` gesperrt, Default Privileges). Sperren im Seitenbaum, Admin-Erhalt und
Migrationsgleichheit sind mit Tests abgesichert, die auch Nebenläufigkeit prüfen. Der Login
ist sauber gebaut: PKCE, `state` und `nonce`, signiertes Login-Cookie, nur der Hash des
Sitzungs-Tokens in der Datenbank, Origin-Prüfung gegen CSRF, Rücksprung nur auf eigene Pfade.
Die Doku stimmt bis auf wenige Stellen mit dem Code überein.

Ein kritischer Befund (Datenleck über die API, Mandantenumgehung) ist nicht dabei. Die
wichtigsten Punkte:

- **R-01:** Die Garantie „mindestens ein wirksamer Admin“ hat eine Lücke, wenn Gruppen
  Personen außerhalb des Workspaces enthalten.
- **R-02, R-03, R-06:** Drei Stellen, an denen die Datenbank `wiki_app` mehr erlaubt als
  nötig. Heute nutzt die API das nicht aus, aber das Projekt will gerade auch gegen Fehler in
  der API absichern.
- **R-04:** Eine Lücke beim Annehmen von Einladungen.

Am besten alle vor M3 schließen (Rechte-Dialog, Personenauswahl), R-10 schon in M1.

## Automatische Prüfungen

| Prüfung | Ergebnis |
|---|---|
| `pnpm lint`, `format:check`, `typecheck` | bestanden |
| `pnpm test` (Unit-Tests API und shared) | bestanden (14 Tests in `apps/api`, dazu `packages/shared`) |
| `pnpm licenses:check` | bestanden, 151 Pakete; LGPL nur `@img/sharp-*` (erlaubt, dynamisch geladen) |
| `pnpm build` | bestanden (Next.js 16.4.5) |
| `database/scripts/schema_test/ci.sh` auf leerem `postgres:18` (18.6) | bestanden: 3 Migrationen, 49 Tests leer und mit Testdaten, Nebenläufigkeit (4), Migrationsgleichheit (2) |
| `setup_test_db.sh` + `pnpm test:db` | bestanden, 12 Tests (Ausgabe enthält einen erwarteten Stacktrace, siehe R-16) |
| `scripts/check-login.mjs` gegen Zitadel v4.20.1 | bestanden, alle 21 Prüfungen (Login, `/me`, Logout, fremde Organisation, unbekannter Mandant, fremdes `returnTo`, Einladung für Nina Neu) |

## Prüfung im Browser

Mit der echten Anmeldeseite von Zitadel, als Lukas (Editor in ENTW, Zugriff auf die
eingeschränkte Seite), Max (Leser in ENTW, ohne Zugriff) und Peter (Organisations-Admin).
Alles verhielt sich wie beschrieben, in den Logs von API und Frontend kein Fehler:

- **Login und Abmelden:** Mandant aus `NEXT_PUBLIC_DEFAULT_TENANT`, Weiterleitung zu Zitadel
  (Organisation im Scope), zurück mit Name, Mandant und Rolle. Abmelden beendet die Sitzung,
  braucht bei Zitadel aber einen zusätzlichen Klick (R-18).
- **Seitenbaum und Rechte:** Startseite als eigener Eintrag, Baum ab ihren Unterseiten,
  Schloss an „Personalplanung 2027“, Brotkrume und eigene Rolle stimmen. Max sieht die Seite
  weder im Baum noch in der API (`/spaces/ENTW/pages`), der direkte Link zeigt „Diese Seite
  gibt es nicht, oder sie ist für dich nicht sichtbar“. Leser sehen keine Knöpfe zum Bearbeiten.
- **Schreibende Abläufe als Lukas:** Unterseite anlegen (danach auf der neuen Seite),
  „Nach oben“, in den Papierkorb (Nachfrage mit Titel, Rücksprung zum Space), wiederherstellen
  (an der alten Stelle). Die Aktionsknöpfe erscheinen bei Hover und bei Tastaturfokus
  (`:focus-within`).
- **Archivierter Space ALT:** Hinweis „Archiviert, nur lesbar“, Rolle Lesen, keine Knöpfe.
- **Einladungen als Peter:** Bereich nur für Admins (bei Max nicht vorhanden), Link wird
  einmal angezeigt, Einladungsseite nennt einladende Person, Workspace, Rolle und Adresse,
  Zurücknehmen setzt den Status auf „zurückgenommen“. Ungültige Links zeigen eine klare
  Meldung.

**Spuren in der lokalen Datenbank (`nf-pg18`):** Seite „Review-Test UI“ im Papierkorb von
ENTW, zurückgenommene Einladung an `review-ui@alpenwerk.example`, Nina Neu als Mitglied von
Alpenwerk (vom Prüfskript, so vorgesehen), Sitzungen der Testpersonen.

## Befunde

| ID | Schwere | Kategorie | Kurz |
|---|---|---|---|
| R-01 | Hoch | Korrektheit | `has_admin` zählt Gruppenmitglieder außerhalb des Workspaces als wirksame Admins |
| R-02 | Mittel | Sicherheit | `wiki_app` kann sich per `app.sync_user_groups` selbst in jede idp-Gruppe eintragen |
| R-03 | Mittel | Sicherheit, Datenschutz | Gäste lesen alle Personen samt E-Mail, alle Gruppen und Mitgliedschaften |
| R-04 | Mittel | Korrektheit | Einladung scheitert mit 409-JSON, wenn das Login schon zu einer Person mit anderer E-Mail gehört |
| R-06 | Mittel | Sicherheit, Doku | `wiki_app` darf Personen direkt anlegen, obwohl neue Personen nur über Einladungen kommen sollen |
| R-10 | Mittel | Korrektheit (Entwurf M1) | `page.trashed` trennt keine Verbindungen; offene Editoren verlieren danach still ihre Änderungen |
| R-18 | Mittel | Sicherheit | Abmelden beendet die Sitzung bei Zitadel erst nach einem weiteren Klick |
| R-05 | Niedrig | Korrektheit | Unerwartete Fehler im Login-Rücksprung enden als JSON statt als Weiterleitung |
| R-07 | Niedrig | Sicherheit | Workspace-Admins dürfen alle Spalten von `invites` ändern (`invited_by`, `accepted_at`, `token_hash`) |
| R-08 | Niedrig | Betrieb | Login-Rollen dürfen sich mit jeder Datenbank im Cluster verbinden (`CONNECT` für `PUBLIC`) |
| R-09 | Niedrig | Sicherheit | `app.audit_event` nimmt beliebige Aktionsnamen an |
| R-11 | Niedrig | Korrektheit | Knöpfe ↑/↓ an Seiten ohne sichtbare Elternseite scheitern immer |
| R-12 | Niedrig | Wartbarkeit | Index `outbox_unpublished` auf `created_at`, der Publisher soll aber nach `id` sortieren |
| R-13 | Niedrig | Sicherheit | `/api/v1/health` verrät ohne Anmeldung den Namen der Datenbankrolle |
| R-14 | Niedrig | Wartbarkeit | `postgres:18` und `node:24` sind nicht fest versioniert (Compose, CI) |
| R-15 | Niedrig | Betrieb | Collab-Server lauscht fest auf `127.0.0.1`; im Container nicht erreichbar |
| R-16 | Niedrig | Tests | Erwarteter OIDC-Fehler landet als Stacktrace in der Ausgabe von `pnpm test:db` |
| R-17 | Niedrig | Korrektheit | Frontend bricht bei Fehlerantworten ohne JSON (z. B. 502 vom Proxy) mit `SyntaxError` ab |
| D-01 | Niedrig | Doku | Veralteter Pfad zum ER-Diagramm in `docs/CONCEPTS.md` |
| D-02 | Niedrig | Doku | ER-Diagramm ohne einige Spalten, ohne Hinweis darauf |
| D-03 | Niedrig | Doku | Veraltete Sätze in `README.md`, `docs/ROADMAP.md`, `docs/LOCAL_SETUP.md`, `schema.sql` |

### R-01 · Hoch · Wirksamer Admin über Gruppe ohne Zugang

**Fundstelle:** [20_functions_base.sql:258](database/scripts/schema/20_functions_base.sql:258)
(`app.has_admin`), [40_functions_tenants.sql:283](database/scripts/schema/40_functions_tenants.sql:283)
(`app.remove_workspace_member`)

**Befund:** `has_admin` zählt einen Admin-Grant für eine Gruppe als wirksam, sobald die Gruppe
ein aktives Mitglied hat. Gruppen gelten für den ganzen Mandanten, Zugriff gibt es aber nur
mit Mitgliedschaft im Workspace des Spaces (`app.space_ws_role`). Ein Gruppenmitglied
außerhalb des Workspaces hält die Prüfung also offen, obwohl es den Space gar nicht öffnen
kann. Dasselbe gilt für `remove_workspace_member`: Es prüft nur persönliche Grants. Wird das
letzte Mitglied einer Admin-Gruppe aus dem Workspace entfernt, bleibt der Space ohne
wirksamen Admin. Das widerspricht `CLAUDE.md`, Abschnitt 8. Beim Confluence-Import wird das
häufig vorkommen, weil dort Gruppen oft über Workspaces hinweg reichen.

**Beleg:** Space mit Admin-Gruppe {Lukas, Zora}, Zora ohne Workspace. Peter gibt seinen Admin
ab, Lukas wird aus der Gruppe entfernt: Beides gelingt. Danach liefert `has_admin` `true`,
`space_rank` liefert für Zora und für Lukas 0.

**Vorschlag:** `has_admin` zählt nur Personen, die aktive Mitglieder im Workspace des Spaces
sind (bei Seiten über `pages.space_id`). `remove_workspace_member` prüft zusätzlich die
Objekte, auf denen Gruppen der Person Admin sind. Dazu ein Test in
`schema_test/12_groups.sql` (beide Wege), eine Migration und ein Nachtrag in `docs/SCHEMA.md`.
Wiederherstellen kann ein Organisations-Admin heute schon (`set_grant`); deshalb nicht
kritisch.

### R-02 · Mittel · Selbstbeitritt zu idp-Gruppen

**Fundstelle:** [40_functions_tenants.sql:117](database/scripts/schema/40_functions_tenants.sql:117),
[90_privileges.sql:16](database/scripts/schema/90_privileges.sql:16)

**Befund:** `app.sync_user_groups` ist für `wiki_app` ausführbar und prüft nur, dass die
Person sich selbst einträgt. Jede angemeldete Person kann sich damit in jede Gruppe mit
Quelle `idp` eintragen, deren `external_id` sie kennt, und bekommt deren Rechte. Heute gibt
es keine idp-Gruppen (Zitadel liefert keine). Sobald ein Gruppen-Claim kommt (Entra ID, E03)
und solche Gruppen Grants bekommen, umgeht das die Rechte vollständig. Voraussetzung ist ein
Fehler in der API, aber genau dagegen soll die Datenbank absichern.

**Beleg:** Max (einfaches Mitglied) ruft `sync_user_groups(max, '{entra-admins}', '{Admins}')`
auf und ist danach Mitglied der Gruppe „Admins“ (Quelle `idp`).

**Vorschlag:** `EXECUTE` für `wiki_app` entziehen, solange die Funktion ungenutzt ist.
Später nur aus einem Weg aufrufen, der das Token selbst prüft, oder über den Worker. Dazu
einen Test in `schema_test/09_users_rules.sql`.

### R-03 · Mittel · Gäste sehen alle Personen

**Fundstelle:** [80_rls.sql:11](database/scripts/schema/80_rls.sql:11) (nur Mandantentrennung
auf `users`, `groups`, `group_members`, `workspaces`, `workspace_members`),
[EPICS.md:435](docs/EPICS.md:435)

**Befund:** Für diese Tabellen gibt es keine Leseregel über die Mandantentrennung hinaus.
Gäste (`workspace_members.role = 'guest'`, heute schon per Einladung möglich) lesen damit
alle Personen samt E-Mail, alle Gruppen, Gruppenmitgliedschaften und Workspace-Mitglieder des
Mandanten. E18 verlangt das Gegenteil: „Gäste sehen keine Personenliste“. Heute gibt keine
API-Route diese Listen heraus. Der Rechte-Dialog in M3 braucht aber eine Personenauswahl, und
spätestens dann wird es ein Leck.

**Beleg:** als Elena (Gast): 7 Personen mit allen E-Mail-Adressen, 3 Gruppen, 5
Gruppenmitgliedschaften, 7 Workspace-Mitgliedschaften.

**Vorschlag:** Leseregeln als `RESTRICTIVE`-Policies. Gäste sehen nur sich selbst und
Personen, mit denen sie einen Space teilen; Gruppen und Mitgliedschaften nur, wenn sie keine
Gäste sind. Entscheiden, ob einfache Mitglieder Personen anderer Workspaces sehen sollen. Mit
Tests in `04_isolation.sql`; vor der Personenauswahl in M3 erledigen.

### R-04 · Mittel · Einladung bei abweichender E-Mail

**Fundstelle:** [40_functions_tenants.sql:85](database/scripts/schema/40_functions_tenants.sql:85),
[accounts.ts:62](apps/api/src/auth/accounts.ts:62), [routes.ts:171](apps/api/src/auth/routes.ts:171)

**Befund:** `accept_invite` sucht die Person nur über die E-Mail der Einladung. Gehört das
Login (`idp_subject`) schon zu einer Person mit anderer E-Mail, legt die Funktion eine zweite
Person mit demselben Login an. Das scheitert an `users_idp_subject` (23505). Das passiert,
wenn sich die E-Mail im Login-Dienst geändert hat (`users.email` wird beim Login nie
nachgezogen) oder wenn an eine zweite Adresse eingeladen wurde. Gleiches gilt, wenn die E-Mail
zu einer Person ohne Login gehört, das Login aber schon zu einer anderen. `resolveAccount`
fängt nur 42501 und P0001 ab. Der Browser landet auf der JSON-Antwort `409 conflict` statt
auf der Startseite mit Fehlermeldung, und die Person kommt nicht in den Workspace.

**Beleg:** Peter (`user-peter-forster`) nimmt eine Einladung an `p.forster@alpenwerk.example`
an: `duplicate key value violates unique constraint "users_idp_subject"`.

**Vorschlag:** In `accept_invite` zuerst nach `(tenant_id, idp_subject)` suchen. Gibt es die
Person, wird sie nur Mitglied; die E-Mail der Einladung ist bereits von der API geprüft. In
`resolveAccount` 23505 als `invite_other_login` behandeln. Später die E-Mail beim Login
nachziehen. Dazu Tests in `14_invites.sql` und `invites.dbtest.ts`.

### R-06 · Mittel · Personen direkt anlegen

**Fundstelle:** [80_rls.sql:90](database/scripts/schema/80_rls.sql:90),
[90_privileges.sql:53](database/scripts/schema/90_privileges.sql:53); Doku:
[CLAUDE.md:196](CLAUDE.md:196), [CONCEPTS.md:536](docs/CONCEPTS.md:536),
[SCHEMA.md:153](docs/SCHEMA.md:153)

**Befund:** `wiki_app` darf `INSERT` auf `users`; die Regel verlangt nur
`role = 'member'`. Seit den Einladungen legt die API Personen nie direkt an, sondern nur über
`app.accept_invite` (kein `INSERT INTO users` in `apps/`). Das Recht ist also überflüssig und
widerspricht der Entscheidung „Neue Personen kommen nur über eine Einladung hinein“
(`CLAUDE.md`, Abschnitt 3). Jede angemeldete Person könnte über einen API-Fehler Personen mit
beliebigem `idp_subject` anlegen. Damit käme ein Zitadel-Konto ohne Einladung in den
Mandanten, oder die E-Mail einer späteren Einladung wird blockiert („anderes Login“). Drei
Dokumente beschreiben noch „neue Personen als einfaches Mitglied (erster Login)“.

**Beleg:** Im Test für R-01 hat `wiki_app` die Person Zora direkt angelegt.

**Vorschlag:** Migration: `REVOKE INSERT ON users FROM wiki_app` und die Policy
`write_insert` auf `users` löschen. Einen Test ergänzen (`09_users_rules.sql`) und die drei
Doku-Stellen sowie den Kommentar in `80_rls.sql` anpassen.

### R-10 · Mittel · Papierkorb während der Bearbeitung (Entwurf M1)

**Fundstelle:** [events.ts:27](packages/shared/src/events.ts:27), [CLAUDE.md:151](CLAUDE.md:151),
[70_functions_content.sql:32](database/scripts/schema/70_functions_content.sql:32)

**Befund:** Liegt eine Seite im Papierkorb, lehnt `store_content` jedes Speichern ab („Seite
fehlt oder liegt im Papierkorb“). `page.trashed` steht aber nicht in `RECONNECT_EVENTS` und
nicht in der Liste in `CLAUDE.md`, Abschnitt 6. Wer die Seite gerade bearbeitet, tippt weiter,
und nichts davon wird gespeichert.

**Vorschlag:** Beim Bau von E04 entscheiden. Entweder trennt `page.trashed` die
Verbindungen (der Client zeigt „Seite liegt im Papierkorb“), oder der Collab-Server schließt
das Dokument schreibgeschützt. Ergänzen in `RECONNECT_EVENTS` und `CLAUDE.md`.

### R-18 · Mittel · Abmelden bei Zitadel unvollständig

**Fundstelle:** [routes.ts:206](apps/api/src/auth/routes.ts:206)

**Befund:** Die Abmelde-Adresse wird ohne `id_token_hint` gebaut, weil die API das ID-Token
nicht aufbewahrt. Zitadel kann die Sitzung deshalb nicht zuordnen und zeigt „Click on account
to end the session“ mit einer Kontenliste. Erst der Klick auf das Konto beendet die Sitzung
und führt zurück zu NoteFieber. Wer das Fenster vorher schließt, ist bei Zitadel weiter
angemeldet. Auf einem geteilten Rechner meldet „Anmelden“ dann womöglich die vorige Person
wieder an. `check-login.mjs` prüft nur, dass Zitadel die Abmeldung annimmt (302), nicht diesen
Schritt.

**Beleg:** im Browser als Lukas und als Max: Nach „Abmelden“ jeweils die Kontenliste von
Zitadel, erst nach dem Klick zurück auf `localhost:3000`.

**Vorschlag:** Das ID-Token (oder nur das, was Zitadel als Hinweis braucht) mit der Sitzung
speichern, z. B. als Spalte in `sessions`, die beim Abmelden gelöscht wird, und als
`id_token_hint` mitschicken. Zu prüfen ist, ob Zitadel v4 die Sitzung dann ohne Auswahl
beendet. Die Prüfung in `check-login.mjs` auf den Rücksprung zu `post_logout_redirect_uri`
erweitern.

### R-05 · Niedrig · Fehler im Login-Rücksprung

**Fundstelle:** [routes.ts:171](apps/api/src/auth/routes.ts:171)

**Befund:** Abgefangen werden nur Fehler beim Token-Tausch und bei den Claims. Datenbankfehler
in `resolveAccount` oder `create_session` gehen an den globalen Fehlerbehandler, und der
Browser sieht JSON. Siehe R-04 für einen konkreten Fall.

**Vorschlag:** Den Rest des Rücksprungs in `try/catch`, protokollieren und auf
`home('login_failed')` weiterleiten.

### R-07 · Niedrig · Spalten von `invites`

**Fundstelle:** [90_privileges.sql:56](database/scripts/schema/90_privileges.sql:56),
[80_rls.sql:104](database/scripts/schema/80_rls.sql:104)

**Befund:** `GRANT INSERT, UPDATE, DELETE ON invites` ohne Spaltenliste. Workspace-Admins
können damit `invited_by` auf eine andere Person setzen (die Einladungsseite zeigt
„eingeladen von …“), angenommene Einladungen wieder öffnen (`accepted_at = NULL`) oder
`token_hash` austauschen. Die API braucht nur `revoked_at`.

**Vorschlag:** `UPDATE (revoked_at)` statt `UPDATE`; `DELETE` nur, wenn es gebraucht wird.

### R-08 · Niedrig · Verbindungen zu anderen Datenbanken

**Fundstelle:** [local_login_roles.sql:37](database/scripts/local_login_roles.sql:37),
[roles_database.sql](database/scripts/roles_database.sql)

**Befund:** Der Kommentar sagt „Verbinden dürfen sie nur mit der Datenbank wiki“, aber
`CONNECT` hat `PUBLIC` auf jeder Datenbank. `wiki_api` darf sich lokal mit `postgres`
verbinden, im gemeinsamen Cluster auch mit `zitadel` und später `chat`. Tabellenrechte gibt
es dort nicht, aber `PUBLIC`-Rechte (temporäre Tabellen, Funktionen).

**Vorschlag:** `REVOKE CONNECT ON DATABASE wiki FROM PUBLIC` in `roles_database.sql`; für die
Datenbanken im Cluster (CloudNativePG, M5) dasselbe vorsehen. Den Kommentar korrigieren.

### R-09 · Niedrig · Freie Aktionsnamen im Audit-Log

**Fundstelle:** [20_functions_base.sql:340](database/scripts/schema/20_functions_base.sql:340)

**Befund:** `app.audit_event` schreibt jede Aktion, auch `grant.changed` oder
`space.viewed_as`, die sonst nur Funktionen schreiben. Die Einträge stehen zwar immer im
Namen der angemeldeten Person, lassen sich aber mit echten Einträgen verwechseln.

**Vorschlag:** Erlaubte Aktionen begrenzen (Liste oder Präfix, z. B. `invite.*`, `export.*`).

### R-11 · Niedrig · Verschieben ohne sichtbare Elternseite

**Fundstelle:** [page-tree.tsx:104](apps/web/src/components/page-tree.tsx:104)

**Befund:** Seiten, deren Elternseite die Person nicht sieht, stehen oben im Baum in `roots`.
↑/↓ schicken `parentId` = die unsichtbare Elternseite. Die API lehnt das immer ab: Der
Nachbar hat eine andere Elternseite (`PositionError`), oder `move_page` verlangt editor auf
der unsichtbaren Elternseite (403).

**Vorschlag:** Die Knöpfe für solche Seiten ausblenden, „Einrücken“ und „Papierkorb“ bleiben.

### R-12 · Niedrig · Index der Outbox

**Fundstelle:** [10_tables.sql:368](database/scripts/schema/10_tables.sql:368),
[schema.sql](database/scripts/schema/schema.sql) („Der Outbox-Publisher sortiert nach id“)

**Vorschlag:** Mit dem Publisher (OPEN_QUESTIONS 2) den Index auf `(id) WHERE published_at IS NULL` umstellen.

### R-13 · Niedrig · Health-Check

**Fundstelle:** [app.ts:25](apps/api/src/app.ts:25)

**Befund:** Ohne Anmeldung erreichbar, liefert `current_user` (z. B. `wiki_api`).

**Vorschlag:** Nur `status` liefern; die Rolle prüft die App ohnehin beim Start.

### R-14 · Niedrig · Nicht fest versionierte Images

**Fundstelle:** [compose.yaml:45](compose.yaml:45) (`postgres:18`), [.gitlab-ci.yml:14](.gitlab-ci.yml:14)
(`node:24`, `postgres:18`)

**Befund:** `CLAUDE.md` verlangt „Alle Versionen fest“. Die übrigen Images (Zitadel, Garage,
Traefik, Node im Init-Container) sind fest versioniert.

**Vorschlag:** Auf Minor-Versionen festlegen, z. B. `postgres:18.6`, `node:24.11.1`.

### R-15 · Niedrig · Adresse des Collab-Servers

**Fundstelle:** [collab.ts:31](apps/collab/src/collab.ts:31)

**Vorschlag:** Mit E04 über eine Variable einstellbar machen (`COLLAB_HOST`, im Container `0.0.0.0`).

### R-16 · Niedrig · Rauschen in den API-Tests

**Fundstelle:** [testing.ts:38](apps/api/src/testing.ts:38),
[invites.dbtest.ts:123](apps/api/src/routes/invites.dbtest.ts:123)

**Befund:** Der Test erwartet, dass die Discovery scheitert (`unavailable`). `oidc.ts` gibt
den Fehler dabei als vollen Stacktrace aus, der in der Ausgabe wie ein Fehler aussieht.

**Vorschlag:** Im Test einen `Oidc`-Ersatz übergeben, der sofort ablehnt, oder die Ausgabe in
`routes.ts` auf eine Zeile kürzen.

### R-17 · Niedrig · Fehlerantworten ohne JSON

**Fundstelle:** [api.ts:23](apps/web/src/lib/api.ts:23)

**Vorschlag:** `JSON.parse` absichern und bei Fehlern auf `Fehler <status>` zurückfallen.

### D-01 bis D-03 · Doku

- **D-01:** [CONCEPTS.md:460](docs/CONCEPTS.md:460) nennt `docs/data_model.mmd` bzw. `.svg`;
  richtig ist `docs/models/data_model/`.
- **D-02:** [data_model.mmd](docs/models/data_model/data_model.mmd) lässt Spalten weg:
  `created_at` bei `users`, `workspaces`, `groups`, `invites`, `spaces`, `pages`, `grants`,
  `comments`, `files`, `imports`, `outbox`; dazu `invites.invited_by`, `pages.deleted_by`,
  `page_search.updated_at`, `comments.edited_at`, `files.deleted_at`,
  `imports.started_at`/`finished_at`, `import_items.note`. Ergänzen, oder im Kopf vermerken,
  dass Zeitstempel fehlen. Tabellen und Funktionen in `docs/SCHEMA.md` sind vollständig.
- **D-03:** [ROADMAP.md:49](docs/ROADMAP.md:49) „abhaken, sobald die erste Pipeline grün war.
  Tests der Apps kommen mit dem ersten Code …“ ist überholt (abgehakt, Tests gibt es).
  [LOCAL_SETUP.md:304](docs/LOCAL_SETUP.md:304) nennt als Beispiel `0002_space_icon.sql`; die
  nächste freie Nummer ist 0004. [schema.sql:4](database/scripts/schema/schema.sql:4)
  „Stand: 05.11.2026“ ist älter als die Migrationen 0002 und 0003.
  [README.md:5](README.md:5) „Grundgerüst … noch ohne Fachlogik“ ist überholt (Login,
  Spaces, Seitenbaum, Einladungen); [README.md:24](README.md:24) nennt für die CI nur die
  Datenbanktests, es sind drei Jobs (`database`, `apps`, `api`).

## Hinweise ohne eigenen Befund

- **Schon in `docs/OPEN_QUESTIONS.md`:** Sicherheitsheader (CSP, `frame-ancestors`, HSTS)
  und Rate Limiting (Frage 4), außerdem das Lesen der Outbox über alle Mandanten (Frage 2).
  Weil `tenants` und `outbox` für `wiki_worker` nur mit gesetztem Mandanten lesbar sind,
  braucht der Worker für Outbox, Aufräumen von Sitzungen und Papierkorb eine
  `SECURITY DEFINER`-Funktion oder einen Mandanten-Durchlauf. Das ist dort richtig beschrieben.
- **Archivierte Spaces:** Space-Admins können dort keine Rechte setzen (`space_rank` ist auf
  viewer begrenzt), nur Organisations-Admins. Das ist folgerichtig, steht aber nirgends; beim
  Rechte-Dialog (M3) dokumentieren.
- **Zweite Wurzelseite:** `create_page` und `move_page` erlauben Seiten ohne Elternseite neben
  der Startseite. Der Baum zeigt sie korrekt oben an; bewusst so lassen oder auf Unterseiten
  der Startseite beschränken.
- **Trust-Grenze:** Mandant und Person kommen als `set_config` von der API. Die Datenbank
  schützt vor Fehlern in der Logik der API, nicht vor einer kompromittierten API (z. B.
  SQL-Injection). Das ist üblich; die API verwendet durchgehend Parameter, es gibt keine
  zusammengesetzten SQL-Texte mit Eingaben.
- **`docs/MVP.md`** nennt „44 Funktionstests“: Momentaufnahme, kein Fehler.

## Nicht geprüft

- `prototype/` (vereinbart)
- Die Pipeline auf GitLab selbst; lokal liefen dieselben Befehle wie in den drei CI-Jobs.
- Collab-Server und Worker im Betrieb: Beide sind noch Grundgerüste ohne Aufgaben (E04 und
  E08); geprüft ist nur der Code.
- Kleine Bildschirme und Barrierefreiheit über die Tastaturbedienung des Seitenbaums hinaus.
