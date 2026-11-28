# Roadmap: NoteFieber – europäische Wiki-Plattform

Stand: 3. November 2026. Die Roadmap hat fünf Stufen wie bei TalkFieber. Jede endet mit einem Kriterium, wann es weitergeht. Die Epics stehen in `EPICS.md`, Architektur und Entscheidungen in `CLAUDE.md`.

Das Wiki kommt vor TalkFieber. Es legt deshalb die gemeinsame Plattform an (Zitadel, CloudNativePG, Garage, K3s auf dem VPS), auf die TalkFieber später aufsetzt.

## Überblick

| Stufe | Ziel | Infrastruktur | Kosten (ca.) |
|---|---|---|---|
| **0 Vorbereitung** | Entscheidungen treffen, mit Confluence-Kunden sprechen | keine | Domain, 10–30 € pro Jahr |
| **1 Lokal entwickeln** | MVP inkl. Confluence-Import bauen und selbst nutzen | eigener Rechner (Docker Compose oder k3d) | unter 5 € pro Monat |
| **2 Demo und Pilot** | Erste Teams arbeiten ohne Confluence | Hostinger-VPS (KVM 4, 16 GB), gemeinsam mit TalkFieber | 20–25 € pro Monat plus externer Backup-Speicher, Marke einmalig ca. 1.050 € (für beide Produkte gemeinsam planen) |
| **3 Geschäftskunden** | Erste zahlende Organisationen, SaaS und On-Prem | zertifizierter EU-Anbieter, mehrere Server | Hosting 50–150 € pro Monat, dazu Recht, Versicherung, Sicherheitsnachweise |
| **4 Ausbau** | Integration mit TalkFieber, KI, Hochverfügbarkeit | wie Stufe 3, erweitert | je nach Umfang |

**Fristen von Atlassian, an denen sich das Tempo misst:** seit 30. März 2026 keine neuen Data-Center-Kunden, ab März 2028 keine Verlängerungskäufe mehr, am 28. März 2029 werden alle Data-Center-Instanzen schreibgeschützt. Die meisten Organisationen entscheiden 2027 und 2028. Bis dahin sollte ein Pilot laufen.

---

## Stufe 0: Vorbereitung

- [x] **Lizenz:** Open Source, Kern unter AGPL-3.0-only (23. November 2026, für NoteFieber und TalkFieber gleich). Enterprise-Funktionen unter eigener Lizenz (Open Core) bleiben eine spätere Option.
- [ ] **CLA oder DCO** für fremde Beiträge entscheiden, vor dem ersten fremden Pull Request (`CLAUDE.md` Abschnitt 4, Punkt 12). Ein CLA nur, wenn später eine Enterprise-Lizenz kommen soll.
- [x] **Betrieb:** vorrangig SaaS, On-Prem (Helm-Chart, E23) später.
- [x] **Name:** vorerst NoteFieber (Arbeitstitel).
- [x] **Eigenbau statt Fork von La Suite Docs:** entschieden. BlockNote, Yjs und Hocuspocus als Bibliotheken.
- [x] **Stack festlegen:** entschieden, TypeScript mit Next.js, Express, BlockNote, Hocuspocus, PostgreSQL 18 (CloudNativePG), Zitadel, Garage, K3s.
- [ ] **5–10 Gespräche mit Confluence-Data-Center-Kunden:** Wann müssen sie entscheiden, was hält sie bei Confluence, welche Makros und Apps nutzen sie, SaaS oder on-prem, was würden sie zahlen?
- [ ] **XWiki, BlueSpice und Docmost ausprobieren** (sobald echte Exporte da sind, M4): einen echten Export in alle drei importieren und notieren, wo es hakt. Docmost ist seit der Entscheidung für Open Source der direkteste Konkurrent (AGPL-3.0, gleicher Stack). Diese Schwachstellen sind das eigene Produkt. In den Gesprächen fragen, ob die Kunden XWiki schon geprüft haben.
- [ ] **Codenamen und Domain sichern.** Über einen gemeinsamen Markennamen für Wiki und Chat nachdenken.

**Weiter, wenn** die Gespräche zeigen, dass der Wechsel von Confluence Data Center ein echter Bedarf ist .

---

## Stufe 1: Lokal entwickeln

Infrastruktur: eigener Rechner. Node direkt, PostgreSQL 18, Zitadel und Garage per Docker Compose oder k3d mit denselben Manifesten wie später auf dem Server.

### M0 – Fundament
Epics: E01 (lokal), E02 (ohne Gruppenpflege, die kommt mit M3), E03 (einfach), vorgezogen Teile von E05 und E06 (Spaces anlegen, Seitenbaum)
- [x] Repository mit Lizenz (`LICENSE`, anfangs proprietär, seit 23. November 2026 AGPL-3.0-only), `CLAUDE.md`, `docs/EPICS.md`, `docs/ROADMAP.md`
- [x] Grundgerüst der Apps als pnpm-Monorepo: `apps/web`, `apps/api` (mit Worker), `apps/collab`, `packages/shared`; eigene Login-Rollen pro App
- [x] Lokale Umgebung mit PostgreSQL 18, Zitadel, Garage (alle per `compose.yaml`, siehe [LOCAL_SETUP](LOCAL_SETUP.md))
- [x] Migrationen: eigenes Skript `migrate.sh` (psql) statt eines Werkzeugs, das Schema als erste Migration (`0001_initial_schema.sql`, gebündelt mit `schema/bundle.sh`), Gleichheit von `schema/` und Migrationen geprüft (`schema_migrations_test.sh`)
- [x] Sync GitHub → GitLab: `.github/workflows/sync-to-gitlab.yml` spiegelt jeden Push auf `main`
- [x] Tests der Datenbank in der CI auf GitLab: `.gitlab-ci.yml` mit `ci.sh` (`schema_test.sql`, `schema_concurrency_test.sh`, `schema_migrations_test.sh`, eingespielt als `wiki_owner`, nie als `postgres`). Erste Pipeline am 8. November 2026 grün
- [x] CI auf GitLab für die Apps: Job `apps` mit `pnpm check` (Lint, Formatierung, Typen, Lizenzen, Build), dazu Job `api` mit den API-Tests gegen eine Wegwerf-Datenbank (`pnpm test:db`)
- [x] Login per OIDC über Zitadel (Mandant und Person aus dem Token): Sitzung in der API (`sessions`, Cookie `nf_session`), Claims an einer Stelle, Prüfskript `scripts/check-login.mjs`
- [x] Einladungen: Link in einen Workspace (anlegen, auflisten, zurücknehmen), erste Anmeldung über `app.accept_invite` nur mit passender, bestätigter E-Mail; Konto in Zitadel muss es geben (lokal: Nina Neu)
- [x] Space anlegen, Seitenbaum per API (anlegen, verschieben, Papierkorb) und Seitenleiste im Frontend; API-Tests gegen die Datenbank (`pnpm test:db`, CI-Job `api`)

**Gate:** Login über Zitadel, Seite anlegen, im Baum verschieben. Lokal erreicht am 8. November 2026.

### M1 – Durchstich Editor und Echtzeit
Epics: E04, Teile von E06 und E07

Was fertig heißt, sagen die User Stories E04-01 bis E04-08 in [EPICS](EPICS.md) mit ihren Abnahmekriterien. Die Punkte hier sind die technischen Schritte dahin, jeweils mit den Stories, denen sie dienen.

- [x] **Vor dem Bau:** Entwurf des Collab-Servers entschieden (14. November 2026, `CLAUDE.md` Abschnitte 3, 6 und 7; [ARCHITECTURE_REVIEW](reviews/ARCHITECTURE_REVIEW.md), A-04 bis A-08)
- [x] Next.js-Grundgerüst, BlockNote als Client-Komponente (E04-01, E04-03; 19. November 2026, `apps/web/src/components/page-editor.tsx`, Titel aus Yjs, Avatare aus Awareness)
- [x] Hocuspocus nach dem Entwurf in `CLAUDE.md`, Abschnitt 6 (entschieden am 14. November 2026; gebaut 15. November 2026, `apps/collab/src/`, Tests `collab.dbtest.ts`): `onAuthenticate` über das Sitzungs-Cookie (`Origin`, `app.resolve_session`, `app.page_rank(seite, person)`), `onLoadDocument`, `onStoreDocument` nur mit Yjs-Zustand und Titel (E04-01, E04-03)
- [x] Datenbank dafür (15. November 2026, Migration `0012_split_store_content.sql`, Test 55): `store_content` aufteilen in Yjs und Titel (Collab-Server) und abgeleiteten Inhalt (Worker), dazu ein Merkmal „abgeleiteter Inhalt veraltet“. Manuelle Versionen und Export nehmen BlockNote-JSON nur, wenn es aktuell ist, sonst leitet der Worker zuerst ab (E04-01)
- [x] Paket `packages/editor-schema` (Browser, Worker, Import; erledigt 15. November 2026, Umwandlung ohne jsdom über `@blocknote/core/yjs`; Worker erledigt 19. November 2026, `apps/api/src/jobs/derive.ts`, Polling über `app.pages_to_derive`); Worker leitet BlockNote-JSON und Klartext ab, wenn eine Seite ~30 s ruht, und fasst `page.updated` zusammen. Seiten mit `content_json`, aber leerem Yjs (Testdaten, Import) wandelt möglichst der Worker vorher um, damit der Collab-Server ohne `jsdom` und React auskommt; nur als Rückfall im Collab-Server (E04-01)
- [x] Trigger auf `outbox` mit `pg_notify`, Collab-Server mit `LISTEN`; nach einem Abriss der Datenbankverbindung prüft er alle offenen Verbindungen neu (verpasste Meldungen) (E04-05, E04-07; 19. November 2026, Migration `0013`, `apps/collab/src/events.ts`, Tests `rights.dbtest.ts`; Hinweise im Frontend „Kein Zugriff mehr“, Papierkorb mit „Wiederherstellen“ und „Abgemeldet“, im Browser geprüft, `docs/USE_CASES.md` UC-23 bis UC-25)
- [x] Abmelden und abgelaufene Sitzungen erreichen auch offene Editoren: `app.end_session` meldet ein Ereignis, der Collab-Server prüft die Sitzungen offener Verbindungen zusätzlich regelmäßig (z. B. alle 5 Minuten) (E04-06; 19. November 2026, `NOTIFY nf_sessions`, `COLLAB_RECHECK_SECONDS`)
- [x] Interner Aufruf an den Collab-Server (nur im Cluster, geteiltes Geheimnis) mit `openDirectConnection`; als Erstes für das Umbenennen aus der Seitenleiste (E04-08; 19. November 2026, eigener Port `COLLAB_INTERNAL_PORT`, `apps/collab/src/internal.ts`, API `POST /pages/:id/title`, im Browser geprüft)
- [x] Zwei Browser bearbeiten dieselbe Seite, Cursor und Anwesenheit sichtbar (E04-01, E04-02; im Browser geprüft am 19. November 2026, `docs/USE_CASES.md` UC-19 bis UC-22)
- [x] Verbindung trennen und wieder verbinden: nichts geht verloren (E04-04; 19. November 2026, lokale Kopie in IndexedDB pro Person und Seite, beim Abmelden gelöscht, `apps/web/src/lib/local-copies.ts`; im Browser geprüft mit gestopptem Collab-Server und Neuladen)
- [x] Erster Lasttest (z. B. 50 gleichzeitige Bearbeitende auf einer Seite); dabei die WAL-Menge pro Minute und die Dauer des Speicherns messen (A-04; 19. November 2026, `pnpm --filter @notefieber/collab load-test`, lokal gegen die Wegwerf-Datenbank: 50 Clients, 60 s, 160 Änderungen pro Sekunde, **kein Datenverlust**, Laufzeit einer Änderung p50 11 ms / p95 35 ms, gespeichert alle 10 s in 64–71 ms, Yjs-Zustand am Ende 203 KB, **WAL 0,4 MB pro Minute**; Ergebnis und Grenzen in [LOCAL_SETUP](LOCAL_SETUP.md), Abschnitt 7)

**Gate:** Zwei Personen bearbeiten gleichzeitig, nichts geht verloren; die Abnahmekriterien von E04-01 bis E04-08 sind durch Tests oder eine Prüfung im Browser belegt (danach in `docs/USE_CASES.md`). **Lokal erreicht am 19. November 2026** (Tests in `apps/collab/src/*.dbtest.ts`, Lasttest, Prüfungen im Browser in [USE_CASES](USE_CASES.md), UC-19 bis UC-27).

### M2 – Wiki-Grundfunktionen
Epics: E05, E06, E07, E08, E15, dazu der Mail-Versand aus E01 und E02 und das Profil aus E02
- [x] Spaces mit Startseite, Seitenbaum mit Drag & Drop; der Baum lädt ebenenweise statt aller Seiten auf einmal (A-01) (22. November 2026: `app.tree_level` mit Migration `0014` und Test 56, gemessen mit `schema_test/tree_load_test.sh`: 10.101 Seiten, 2–42 ms pro Ebene, auch ohne aktuelle Statistik, statt 2,7 s für den flachen Baum; Seiten unter unsichtbaren stehen unter der nächsten sichtbaren; Drag & Drop nativ mit HTML5, Knöpfe bleiben; Space umbenennen, beschreiben, archivieren und zurückholen; im Browser geprüft, [USE_CASES](USE_CASES.md) UC-28 bis UC-30)
- [x] Blöcke: Überschriften, Listen, Tabellen, Code, Bilder, Callouts, Seitenlinks (23. November 2026: Schema in `packages/editor-schema` ohne Datei-, Video- und Audio-Block, dazu `callout` und der Inline-Inhalt `pageLink` nur mit Seiten-ID, Rundlauf-Tests für jede Blockart; Code mit Sprachauswahl und Hervorhebung über `@blocknote/code-block`; Bilder über die API in Garage, `POST /pages/:id/files`, `GET /files/:id`, Tests `files.dbtest.ts`; Seitenlinks über „[“ mit Titelsuche `GET /pages/search` und Titeln aus `POST /pages/lookup`; Worker pflegt `page_links`; fremde Bild-Adressen per CSP gesperrt; im Browser geprüft, [USE_CASES](USE_CASES.md) UC-31 bis UC-35)
- [x] Erwähnungen von Personen und Inhaltsverzeichnis (restlicher Umfang von E07) (23. November 2026: Inline-Inhalt `mention` nur mit Personen-ID, Namen aus `POST /people/lookup`, Suche hinter „@“ über `GET /people/search` (Mitglieder des Workspaces, Gäste finden nur sich selbst), Tests `people.dbtest.ts`; Block `toc`, den der Browser aus den Überschriften baut und bei jeder Änderung nachzieht; `mentionIds` für die Benachrichtigungen in E16; im Browser geprüft, [USE_CASES](USE_CASES.md) UC-36 und UC-37)
- [x] Open Source und öffentliches Repository (23. November 2026, `CLAUDE.md` Abschnitt 14): `LICENSE` mit AGPL-3.0-only, Lizenzprüfung auf AGPL-Verträglichkeit umgestellt (Freigabeliste), `SECURITY.md`, `.gitignore` für Secrets und echte Exporte, CI-Job `secrets` (gitleaks über den ganzen Verlauf), Dependabot, Spiegel aller Branches nach GitLab (Pipeline vor dem Merge)
- [x] Einstellungen auf GitHub (23. November 2026): private Meldung von Sicherheitslücken, Secret Scanning mit Push Protection, Dependabot Alerts und Security Updates, `GITLAB_TOKEN` zusätzlich als Dependabot-Secret, Schutz für `main`
- [x] Oberfläche auf Deutsch und Englisch (E15, Definition of Done in [EPICS](EPICS.md)): Übersetzung einbauen, solange es wenig Text gibt, alle bisherigen Texte übersetzen (auch BlockNote, Callout-Arten, Fehlermeldungen der API, die die Oberfläche zeigt); ab hier jede Story in beiden Sprachen (24. November 2026: next-intl ohne Sprache in der Adresse, Texte in `apps/web/messages/de.json` und `en.json`, ein Test prüft gleiche Schlüssel und Platzhalter; Sprache aus Cookie `nf_locale`, Browsersprache oder Profil, Umschalter unten in der Seitenleiste speichert `users.locale` über `PATCH /api/v1/me`; BlockNote-Wörterbuch je Sprache; Fehler der API mit stabilem `code`, auch für Regeln der Datenbank (`DB_RULES`); Anmeldeseite von Zitadel über `ui_locales`; im Browser geprüft, [USE_CASES](USE_CASES.md) UC-38)
- [x] Web-Client nach UI-Entwurf (E15, `prototype/`, 24. November 2026): Designsystem mit Inter (Code: IBM Plex Mono) und heller Seitenleiste statt `#0F2537` (Entscheidung in `CLAUDE.md` Abschnitt 9), Kopfbereich mit Brotkrume, Avataren, Schloss und den Knöpfen „Teilen und Rechte“, „Versionen“, „Exportieren“ (vorerst Dialoge mit Ausblick); Tastaturbedienung (Seitenbaum nach dem ARIA-Muster „Tree View“, Menüs, Dialoge, Zum Inhalt springen), WCAG 2.2 AA (Kontraste aller Farbpaare in `contrast.test.mjs`, axe ohne Befunde in `apps/web/e2e/a11y.spec.ts`), bis Tablet nutzbar (Schublade unter 1024 px); eine Seite mit 225 Blöcken in 1,48 s bearbeitbar (Median, Maximum 1,55 s, Produktions-Build, `apps/web/e2e/editor-200-blocks.spec.ts`, [LOCAL_SETUP](LOCAL_SETUP.md) Abschnitt 7; UC-39 bis UC-41)
- [x] Erste grüne Pipeline mit `secrets` über den ganzen Verlauf, bevor das Repository öffentlich wird (siehe [TODOS](TODOS.md))
- **Oberfläche nach Prototyp nachziehen** (E15, `../prototype/README.md`): sechs Stories, je eine Session, nur Oberfläche auf der vorhandenen API, keine Migration. Für alle gilt: in beiden Sprachen, geprüft mit axe und `contrast.test.mjs`, Use Cases in `USE_CASES.md` nachgeführt. Story 1 zuerst, weil die anderen in ihre Leisten und Menüs einhängen; 2 bis 6 danach in beliebiger Reihenfolge, aber nicht gleichzeitig (gleiche Dateien in `apps/web`)
  - [ ] **1. Gerüst oben:** Leiste oben (bleibt stehen) mit Suchfeld (bis M3 nur Titelsuche), Zahnrad „Einstellungen“ (Darstellung vorerst nur Hell, „Persönliche Einstellungen“ und „Tastenkürzel“ als Dialog, für Owner und Admins „Workspace“ und „Einladungen“ vorerst als Ausblick) und Avatar „Konto“ (Name, E-Mail, Rolle, „Benutzerprofil“ als Ausblick, Sprache, Abmelden). Abmelden und Sprache verschwinden aus der Seitenleiste, `CLAUDE.md` §3 („Umschalter unten in der Seitenleiste“) und §9 anpassen. Logo „NF“ in der Seitenleiste und als Browser-Icon (`prototype/brand/`). Dialog „Tastenkürzel“ mit den Kürzeln, die es schon gibt
  - [ ] **2. Leiste über der Seite:** eigene Zeile unter der Leiste oben, scrollt mit. Speicherstatus („Gespeichert“, „Speichert …“, „Offline“, „Nur lesen“, „Archiviert“) statt des Offline-Hinweises, Anwesenheit nur der anderen (bis drei Avatare, dann „+N“), „Teilen“ orange mit Schloss bei eigenen Rechten (der Hinweis „Eingeschränkt“ über dem Titel entfällt), „⋯“ mit Link kopieren, Seiteninfo (Angaben und Rechte; Rückverweise ab M3), Versionen, Exportieren (beide vorerst Ausblick) und In den Papierkorb, gesperrt auf der Startseite und ohne Bearbeitungsrecht. Der Kommentar-Knopf kommt mit M3
  - [ ] **3. Verschieben-Dialog:** „Verschieben …“ im Menü „⋯“ der Seite und der Baumzeile, Zielseite aus dem Baum des Spaces wählen (nur Seiten mit Bearbeitungsrecht, nicht die Seite selbst und nichts darunter), dann `app.move_page` über die vorhandene API. Fehler der Datenbank (Bereich mit eigenen Rechten verlassen) mit übersetztem Text
  - [ ] **4. Space-Umschalter und Space-Einstellungen:** Umschalter als Karte (Kürzel, Name, „Space · ENTW“, Menü mit allen Spaces), Einstellungen als Dialog statt der Seite `/s/<schlüssel>/settings` (alte Adresse auf den Space mit offenem Dialog umleiten, `CLAUDE.md` §7 anpassen), Archivieren und Zurückholen direkt im Menü „⋯“ am Space, Knöpfe der Seitenleiste mit `--nf-sidebar-press` beim Darüberfahren. Ohne Farbe pro Space (Schemaänderung, siehe Übersicht)
  - [ ] **5. Laden und leere Zustände:** Skelett beim ersten Öffnen einer Seite (Titel, Byline, Zeilen) und eines Spaces (im Seitenbaum) statt „Einen Moment …“, danach sofort aus dem Zwischenspeicher; `aria-busy` und Status „Seite wird geladen …“, mit „Bewegung reduzieren“ ohne Schimmer. Leerer Space im Seitenbaum („Noch keine Seiten unter der Startseite“ mit „Erste Seite anlegen“); die Karte „Willkommen in …“ kommt mit M5, Suche und Kommentare ohne Inhalt mit M3
  - [ ] **6. Editor-Bedienung:** „/“-Menü in Gruppen mit Icon, Beschreibung und Markdown-Kürzel, Leiste beim Markieren (Blocktyp, Formate, Link; „Kommentieren“ erst mit M3), „+“ und Ziehpunkt links am Block mit Blockmenü (Nach oben, Nach unten, Duplizieren, Löschen), Platzhalter nur im Block mit dem Cursor. Über die Erweiterungspunkte von BlockNote, nicht mit eigenen Menüs daneben; was BlockNote nicht hergibt, in der Story festhalten statt nachbauen
- [ ] Übersicht nach dem Login neu (E05, ersetzt `apps/web/src/app/home.tsx`): Spaces als Kacheln mit eigener Rolle, Zahl der Seiten und letzter Änderung, „Neuer Space“ als Dialog mit vorgeschlagenem Schlüssel, Karte zum Workspace für Owner und Admins. Eine Farbe pro Space wäre eine Schemaänderung (`spaces.color`, Test und Migration), sonst ohne Farbe
- [ ] Fuß der Seite (E06): Unterseiten als Karten oder Liste mit „+ Unterseite“, nur lesbare Seiten (über `app.tree_level`); „Verlinkt von“ kommt mit den Rückverweisen in M3
- [ ] Dunkles Farbschema (E15): Tokens aus `prototype/pages/src/styles/tokens.css`, alle dunklen Farbpaare in `contrast.test.mjs`, Auswahl Hell, Dunkel oder System im Zahnrad-Menü (nach Story 1); vorher entscheiden, ob die Wahl im Browser bleibt oder mit den persönlichen Einstellungen in `users.settings` landet (siehe Profil)
- [ ] Worker-Aufträge mit pg-boss (Grundlage für die Versionen und das endgültige Löschen; dazu die Punkte „Mit M2“ in [TODOS](TODOS.md))
- [ ] Versionen (E08): automatische Version nach 10 Minuten Ruhe (Worker), manuelle Version (`app.save_version`), Versionen mit Autoren anzeigen, zwei Versionen vergleichen, wiederherstellen als neue Version über den internen Aufruf an den Collab-Server (`restored_from`); prüfen, dass alle Blöcke aus E07 Speichern, Version und Wiederherstellen ohne Verlust überstehen. Oberfläche nach dem Prototyp: eigene Ansicht mit der Liste nach Tagen, Vergleich mit `<ins>`/`<del>` aus dem BlockNote-JSON zweier Versionen über eine Bibliothek (z. B. `diff`, kein eigener Algorithmus). Ein Name für gesicherte Versionen („Vor dem Review“) braucht eine Spalte in `page_versions`; vorher entscheiden (Schemaänderung)
- [ ] Papierkorb (E08): endgültiges Löschen nach 30 Tagen durch den Worker, mit den Objekten der Bilder in Garage. Oberfläche als Dialog nach dem Prototyp mit Suche, gelöscht von wem und wann, Restzeit bis zum endgültigen Löschen und aufklappbaren Unterseiten; dafür liefert `GET /spaces/:key/trash` zusätzlich `deleted_by` und die Zahl der Unterseiten
- [ ] Zuletzt besuchte Seiten (E06): in der Übersicht als Karten und in der Suche ohne Eingabe (Prototyp). Braucht eine Tabelle pro Person und Seite (Schemaänderung) und zeigt nur lesbare Seiten außerhalb des Papierkorbs
- [ ] Profil (E02): Name, Profilbild, Sprache, Zeitzone; die Sprache steuert die Oberfläche. Dialog „Benutzerprofil“ im Konto-Menü nach dem Prototyp (Profilbild über die Datei-API als eigene Datei ohne Seite, `users.avatar_file_id`; E-Mail nur lesbar mit „Im Login-Dienst ändern“; die Zeitzone gilt für alle Zeitangaben), nach Story 1
- [ ] Persönliche Einstellungen (E15): Dialog über das Zahnrad nach dem Prototyp (Darstellung, Unterseiten und Favoriten als Karten oder Liste, Kommentarspalte von selbst öffnen, Markdown-Kürzel und Rechtschreibprüfung an oder aus; Benachrichtigungen erst mit E16). Pro Person in der Datenbank braucht eine Schemaänderung (Vorschlag `users.settings` als JSON); vorher entscheiden, sonst vorerst im Browser
- [ ] E-Mail-Versand lokal: Mailpit in `compose.yaml` (fängt alle Mails ab, Ansicht unter `http://localhost:8025`), SMTP über eine generische Einstellung (Nodemailer); Einladungsmail direkt aus der API beim Anlegen (das Token liegt nur im Speicher, der Link bleibt als Rückfall); Zitadel nutzt denselben SMTP-Server (Passwort vergessen, E-Mail bestätigen)
- [ ] Registrieren nach Einladung (E02, E03; `CLAUDE.md` §3, präzisiert 28. November 2026): Eingeladene ohne Konto registrieren sich aus dem Einladungslink heraus bei Zitadel in der Organisation des Mandanten, statt dass eine Admin das Konto vorher anlegt. Selbstregistrierung für die Organisationen einschalten (`docker/zitadel/init.mjs`, lokal bisher aus), `/invite/<token>` bietet „Anmelden“ und „Konto anlegen“, die API startet den Login dann mit `prompt=create`; zurück greift `app.accept_invite` wie bisher über die bestätigte E-Mail. **Zuerst prüfen**, ob Zitadel v4 `prompt=create` mit unseren Anmeldeseiten so unterstützt. Tests: registriert ohne Einladung kommt nicht hinein, mit Einladung an eine andere E-Mail auch nicht. Login-Bereich, Peter liest den Diff. Danach `LOCAL_SETUP.md` (Abschnitt Einladungen, „Das Konto in Zitadel muss es schon geben“) und `USE_CASES.md` nachziehen
- [ ] **Ab hier selbst nutzen**, z. B. für die eigene Projektdokumentation

### M3 – Rechte, Suche, Kommentare (MVP ohne Import)
Epics: E09, E10, E11, E12, E14, dazu aus E02 die Gruppenpflege (aus M0 verschoben) und die Mitgliederverwaltung, aus E06 die Rückverweise, aus E19 ein Webhook
- [ ] Rollen und Vererbung, Vererbung kappen, Gruppen, „Alle im Workspace“; Rechte-Dialog mit „Erbt Rechte von …“ (E09). Nach dem Prototyp: oben die Zusammenfassung, wie viele Personen welche wirksame Rolle haben, Hinzufügen mit Vorschlägen beim Tippen, Warnung, wenn man sich selbst Admin nimmt, Speichern gesperrt, wenn kein wirksamer Admin bliebe
- [ ] Rechte wiederherstellen durch Organisations-Admins, wenn kein Admin mehr erreichbar ist, mit Eintrag im Audit-Log (E09)
- [ ] Mitglieder eines Workspaces verwalten: Rolle ändern, entfernen, Person deaktivieren (E02; die Datenbank kann es schon). Oberfläche nach dem Prototyp als Dialoge „Workspace“ und „Einladungen“ im Zahnrad-Menü (Einladungen mit Status offen, angenommen, zurückgenommen, abgelaufen)
- [ ] Gruppen im Wiki pflegen: API und Oberfläche für Organisations-Admins (anlegen, umbenennen, Mitglieder). Aus M0 hierher verschoben; die Datenbank kann es schon, Rechte über Gruppen wirken bereits (Testdaten)
- [ ] „Ansehen als …“ für Space-Admins (Prüfwerkzeug für den Import): Person wählen, Seitenbaum mit ihrer Rolle pro Seite und „sieht 8 von 9 Seiten“, nur Struktur (Prototyp)
- [ ] Kommentare an Textstellen und Seiten. Nach dem Prototyp: Spalte standardmäßig zu, Sprechblasen mit Zahl am Rand neben der Stelle, Reiter „Offen“ und „Erledigt“, Kommentar zur ganzen Seite, neuer Kommentar aus der Leiste beim Markieren; unter 1280 px eine Schublade, die den Fokus fängt wie ein Dialog (im Prototyp noch nicht). Leere Zustände „Noch keine Kommentare“, „Nichts erledigt“ und ohne Kommentarrecht ein Hinweis auf die Rolle
- [ ] Dateien mit Virenscan und Vorschau; dann `FILES_REQUIRE_SCAN` überall an (lokal bis dahin `false`), Anhänge als Datei-Block, „wird geprüft“ und „blockiert“ am Bild anzeigen
- [ ] Sichtbarkeit für Listen mengenbasiert (Seitenbaum, Suche, Titelsuche für Seitenlinks `GET /pages/search`, „Ansehen als …“, Rückverweise): Ränge pro Space und Person einmal berechnen statt `page_rank` pro Zeile, durch einen Test gegen `page_rank` abgesichert (A-01)
- [ ] Volltextsuche, Rechte in jedem Lesepfad; Deutsch und Englisch (zwei Sprachkonfigurationen oder `simple` mit Trigrammen, A-10); Filter nach Space, Autor und Zeitraum; Schnellsuche nach Titeln beim Tippen (E12, baut auf `GET /pages/search` auf); Seiten im Papierkorb verschwinden aus `page_search` und kommen beim Wiederherstellen zurück (noch nicht gebaut, [TODOS](TODOS.md)). Oberfläche als Befehlspalette nach dem Prototyp (Strg K): Bereiche Seiten, Spaces, Personen, Befehle mit „>“, Ausschnitt mit Markierung, „Nur in <Space>“, ohne Eingabe zuletzt angesehen; ohne Treffer ein Hinweis auf Leserecht und Verzögerung, „In allen Spaces suchen“ und mit Bearbeitungsrecht „Seite „…“ anlegen“ (Suchbegriff als Titel)
- [ ] „Letzte Änderungen“ in der Übersicht (E05): Änderungen in sichtbaren Spaces, ein neuer Lesepfad, deshalb mengenbasiert wie die Suche und im End-to-End-Test für das Gate
- [ ] Rückverweise „Wer verlinkt hierher?“ an der Seite, aus `page_links` (E06): im Fuß der Seite als „Verlinkt von (n)“ mit dem Satz um den Link; was fehlt, fehlt ohne Hinweis
- [ ] Export einer Seite, eines Teilbaums oder eines Spaces als Markdown + BlockNote-JSON + Anhänge (ZIP), nur was die Person lesen darf (E14). BlockNote-JSON ist das verlustfreie Format für Re-Import und Editorwechsel
- [ ] Ein Webhook (E19, Teil des MVP laut `CLAUDE.md` Abschnitt 5): ausgewählte Ereignisse aus der Outbox an eine Adresse pro Mandant, mit Signatur
- [ ] Audit-Log

- [ ] End-to-End-Test für das Gate als eigener Job in `.gitlab-ci.yml`: alle Lesepfade über die API mit Personen ohne Leserecht (Testdaten synthetisch), rot, sobald einer eine Seite zeigt (`CLAUDE.md` Abschnitt 14)

**Gate:** Kein Lesepfad (Baum, Suche, Links, Kommentare, Export, Dateien) zeigt Seiten ohne Leserecht. Durch Tests abgesichert, darunter der End-to-End-Test in der CI. Ein Space mit 10.000 Seiten lädt seinen Seitenbaum in unter einer Sekunde (Lastprüfung, A-01).

### M4 – Confluence-Import
Epic: E13
- [ ] 2–3 echte Confluence-Space-Exporte besorgen (anonymisiert reicht), zu Beginn von M4, und die häufigsten Makros zählen. **Nie ins Repository**, auch keine daraus abgeleiteten Fixtures: lokal außerhalb (z. B. `.local/confluence-exports/`), Test-Fixtures für den Importer synthetisch nachbauen (`CLAUDE.md` Abschnitt 14)
- [ ] Space-Export (HTML bzw. XML) einlesen: Hierarchie, Inhalte, Anhänge, Versionen
- [ ] Rechte übersetzen, Gruppen zuordnen
- [ ] Die häufigsten Makros abbilden (aus den echten Exporten gezählt), Rest als sichtbarer Platzhalter mit Originalinhalt
- [ ] Probelauf mit Bericht, echter Import, Import rückgängig machen. Import-Assistent nach dem Prototyp (`Main.dc.html#import`): Ziel-Space, Probelauf mit Gruppen zuordnen, Personen, **Rechte vorab** („Wie vorher“, „Enger als vorher“, „Weiter als vorher“) und Makros; „Import starten“ bleibt gesperrt, solange eine Gruppe nicht zugeordnet ist oder eine Seite danach für mehr Personen sichtbar wäre als in Confluence; danach „Rechte prüfen“ über „Ansehen als …“
- [ ] Interne Links umschreiben
- [ ] Personen aus dem Export ohne Login anlegen, mit Mitgliedschaften und Rechten, danach Sammeleinladung ([OPEN_QUESTIONS](OPEN_QUESTIONS.md), Frage 9; A-02)
- [ ] Importierte Versionen nur als BlockNote-JSON speichern (`page_versions.ydoc` für `import` leer, Wiederherstellen über `content_json`; A-03)
- [ ] Nach dem Einspielen `ANALYZE` auf `pages`, `grants` und `page_contents`, sonst bricht die Leistung bis zum nächsten Autovacuum ein (A-01)
- [ ] Speicher für Import-Archive und Virenscan in der Kapazität des VPS einplanen, Größengrenzen festlegen ([OPEN_QUESTIONS](OPEN_QUESTIONS.md), Frage 7; A-11)

**Bewusst noch nicht:** SAML und SCIM, Mobile-Apps, Abrechnung, Gastzugänge, öffentliche Seiten, Integrationen außer einem Webhook, On-Prem-Paket.

**Weiter, wenn** ein echter Pilot-Space importiert ist, der Pilotkunde ihn als vollständig abnimmt und du das Wiki selbst täglich nutzt.

---

## Stufe 2: Demo und Pilot auf eigenem VPS

Infrastruktur: Hostinger-VPS (KVM 4, 16 GB), Standort in der EU (nicht Großbritannien), **ausschließlich für Wiki und TalkFieber**. Wird hier zum ersten Mal gemietet und später von TalkFieber mitgenutzt.

### M5 – Pilot
Epics: E01 (VPS), E22 (einfach), dazu aus E02 das Anlegen von Mandanten und aus E03 Zwei-Faktor
- [ ] Container-Images für `web`, `api`/`worker` und `collab`, K3s-Manifeste (Kustomize), lokal mit k3d geprüft; Migrationen als eigener Job vor dem Ausrollen (`CLAUDE.md` Abschnitt 11) (E01)
- [ ] Ausrollen aus der CI auf GitLab nach `staging` bei jedem Merge, Freigabe für `pilot`; Secrets mit SOPS oder Sealed Secrets (E01)
- [ ] Mandanten für Pilotkunden anlegen: Admin-Skript über `app.create_tenant` mit Organisation in Zitadel; Selbstregistrierung erst in Stufe 3 (E02)
- [ ] Zwei-Faktor und Passkeys in Zitadel einschalten, „Alle Sitzungen beenden“ im Profil (E03)
- [ ] Einfacher Einstieg für Pilotnutzer (E22): erster Space, Einladungen, kurze Einführung „Was heißt hier wie?“ für Confluence-Umsteiger; Karte „Willkommen in …“ auf der Startseite eines leeren Spaces (Prototyp)
- [ ] Komfort aus dem Prototyp, nach den Rückmeldungen der Pilotkunden priorisiert (E06, E07), jeweils eine Schemaänderung mit Test und Migration: Favoriten für Seiten und Spaces, Emoji und Titelbild einer Seite, Reaktionen auf Seiten
- [ ] VPS mieten, K3s mit denselben Manifesten wie lokal, Namespaces `staging` und `pilot`
- [ ] Firewall: nur 80, 443 und SSH mit Schlüssel. Kubernetes-API nicht öffentlich.
- [ ] CloudNativePG mit laufenden Backups zu einem S3-Speicher bei einem anderen Anbieter, Garage-Buckets ebenfalls. **Wiederherstellung getestet.**
- [ ] Überwachung mit Alarm bei Ausfall, vollem Speicher, fehlgeschlagenem Backup und zu großen Yjs-Dokumenten; dazu JSON-Logs mit Anfrage-ID und ein Metrik-Endpunkt pro Prozess, nur im Cluster erreichbar (A-12)
- [ ] Adressen der Mandanten festlegen, bevor Pilotkunden Links verschicken ([OPEN_QUESTIONS](OPEN_QUESTIONS.md), Frage 10; A-09)
- [ ] Produktnamen festlegen, **EU-Marke anmelden** (Klassen 9, 38, 42), bevor du öffentlich auftrittst
- [ ] Datenschutzerklärung und Nutzungsbedingungen für die Pilotphase
- [ ] 2–3 Pilotkunden, die mit ihrem importierten Space arbeiten, mit regelmäßigem Feedback
- [ ] Installations- und Admin-Doku
- [ ] E-Mail über einen EU-Anbieter ohne US-Mutter (z. B. Scaleway Transactional Email, Brevo), eigene Absenderdomain mit SPF, DKIM und DMARC; Zitadel und API über denselben Zugang

**Weiter, wenn** ein Pilot vier Wochen ohne Confluence arbeitet, lieber mit NoteFieber arbeitet als mit Confluence und mindestens einer sagt: „Dafür würden wir zahlen.“

---

## Stufe 3: Bereit für Geschäftskunden

Infrastruktur: Umzug zu einem zertifizierten EU-Anbieter, gemeinsam mit TalkFieber. Hetzner (ISO 27001) als günstiger Weg, STACKIT oder IONOS, wenn deutsche Behörden Zielgruppe sind (oft BSI C5).

**Organisation (gemeinsam mit TalkFieber):**
- [ ] Firma gründen, EU-Sitz ohne US-Mutter
- [ ] Rechtstexte: AGB, Auftragsverarbeitungsvertrag, Datenschutzerklärung, Subunternehmer, TOMs
- [ ] Berufs- bzw. Cyber-Haftpflichtversicherung
- [ ] Mitstreiter oder Finanzierung suchen. Diese Stufe ist allein kaum machbar.

**Produkt:**

| Bereich | Epics |
|---|---|
| Administration, Aufbewahrung, Audit-Ansicht, SCIM, DSGVO | E17 |
| Organisation selbst registrieren (mit Plan und Abrechnung) | E02, E20 |
| SSO voll (OIDC, SAML, Entra ID) | E03 |
| Benachrichtigungen, Beobachten, Erwähnungen (Glocke im Prototyp entworfen) | E16 |
| Gäste und Freigaben nach außen | E18 |
| Weitere Webhooks, REST-API mit Tokens, Einbettungen | E19 |
| Vorlagen und Seiteneigenschaften (Galerie, Verwenden und „Als Vorlage speichern“ im Prototyp entworfen) | E25 |
| Pläne und Abrechnung über einen EU-Zahlungsanbieter | E20 |
| Sicherheit: Penetrationstest, Vorbereitung ISO 27001 | E21 |
| Onboarding und Hilfe | E22 |
| **Self-Hosting-Paket (Helm-Chart) für On-Prem-Kunden** | E23 |
| Umzug, mehrere Server, PostgreSQL mit Replikaten | E24 |

**Weiter, wenn** die ersten zahlenden Kunden live sind und Einkaufsfragebögen beantwortet werden können.

---

## Stufe 4: Ausbau

| Bereich | Epics | Hinweis |
|---|---|---|
| Integration mit TalkFieber | E26 | Sobald TalkFieber im Pilot ist. Wiki-Links im Chat, Benachrichtigungen, Seite ↔ Topic |
| KI-Funktionen mit europäischem Modell | E27 | Zusammenfassen, Fragen an den Space, pro Mandant abschaltbar |
| Hochverfügbarkeit, mehrere Collab-Instanzen, OpenSearch, Zellen | E28 | Nach Bedarf großer Kunden |
| Datenbanken und Tabellen-Ansichten | E29 | Der Schritt Richtung Notion, nur wenn Kunden danach fragen |
| Mobile-Apps und Offline-Lesen | E30 | |
| Integration mit Nextcloud, OnlyOffice, Collabora, openDesk | E31 | Baustein für Organisationen, die Microsoft 365 verlassen |

---

## Grobe Zeitachse

| Stufe | Vollzeit | Nebenbei (10–15 h/Woche) |
|---|---|---|
| 0 Vorbereitung | 2–4 Wochen | 1–2 Monate |
| 1 bis M3 (MVP ohne Import) | ca. 4 Monate | ca. 1 Jahr |
| 1 M4 (Import) | ca. 1,5 Monate | 4–6 Monate |
| 2 Pilot | 1–2 Monate plus Pilotzeit | 2–4 Monate |
| 3 Geschäftskunden | 1–2 Jahre mit kleinem Team | allein kaum machbar |

Rund 6 Monate in Vollzeit bis zum Pilot. Nebenbei wird es mit der Atlassian-Frist eng: Dann den Umfang von M2 und M3 kürzen, nicht den Import. **Nach M1 neu schätzen.**

## Arbeitsweise mit Claude Code

- **Kleine Aufgaben:** eine User Story pro Sitzung. Größere Stücke erst im Planungsmodus durchsprechen.
- **Entscheidungen dokumentieren:** sofort in `CLAUDE.md`.
- **Tests zuerst** bei allem, was Rechte, Mandantentrennung oder Sichtbarkeit berührt.
- **Diffs lesen:** besonders bei Rechten, Datenbankzugriffen, Login und dem Collab-Server.
- **Mit echten Exporten testen:** Der Import wird an echten Confluence-Daten gemessen, nicht an selbstgebauten.
- **Oft committen.** Diese Roadmap nach jedem Meilenstein abhaken und anpassen.
