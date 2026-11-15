# Projekt: NoteFieber – europäische Wiki-Plattform (Confluence-Alternative, Arbeitstitel)

Übergabe aus dem Planungs-Chat „NoteFieber / Confluence Alternative“ vom 2. und 3. November 2026 und dem Dokument „Europäische Wiki-Plattform – Architektur & MVP“. Aufbau und Konventionen folgen bewusst dem Schwesterprojekt **TalkFieber** (Team-Chat), damit beide Produkte später auf einer gemeinsamen Plattform laufen. Dieses Dokument fasst Idee, Entscheidungen, Architektur, Datenmodell und Startsetup zusammen, damit die Arbeit in Claude Code direkt weitergehen kann.

---

## 1. Idee und Ziel

- Eine europäische Alternative zu Confluence (und in Teilen Notion), entwickelt und gehostet in der EU.
- **Zuerst das Wiki, danach TalkFieber.** Beide Produkte teilen Login, Mandantenmodell und Cluster (Abschnitt 12).
- **Kern des MVP:** ein Team von 10 bis 50 Personen importiert seinen Confluence-Space und arbeitet danach im Alltag ohne Rückfall weiter. Alles, was diesem Beweis nicht dient, kommt später.
- **Weitere Dokumente im Projekt:**
  - `README.md`: Einstieg ins Repository, Überblick über alle Dokumente, Kurzfassung der lokalen Einrichtung
  - `docs/OPEN_QUESTIONS.md`: Themen, die in EPICS und ROADMAP noch fehlen oder zu spät stehen, mit offenen Fragen und Vorschlag. Geklärtes wandert in EPICS, ROADMAP bzw. hierher und wird dort gelöscht
  - `TODOS.md`: offene Punkte aus der letzten Konsistenzprüfung. Erledigtes abhaken und löschen, Entscheidungen wandern hierher
  - `REVIEW.md`: Review von Code und Dokumentation, **Momentaufnahme vom 12. November 2026**, wird nicht nachgeführt. Befunde mit ID (`R-01` …), Beleg und Vorschlag; die Aufgaben daraus stehen in `TODOS.md`
  - `ARCHITECTURE_REVIEW.md`: Review der Architektur, **Momentaufnahme vom 14. November 2026**, wird nicht nachgeführt. Befunde `A-01` … mit Zeitpunkt (M1 bis M5), weitergeführt in `docs/ROADMAP.md` und `docs/OPEN_QUESTIONS.md` (Fragen 8 bis 11); wichtigster Punkt: Rechte pro Zeile skalieren nicht (Seitenbaum mit 10.000 Seiten 2–5 s, direkt nach einem Massenimport ohne `ANALYZE` 28–52 s gemessen)
  - `docs/CONCEPTS.md`: alle Kernkonzepte ausführlich erklärt, für Neulinge zuerst lesen
  - `docs/USE_CASES.md`: Use Cases, die sich in der Oberfläche schon klicken lassen (UC-01 …), mit Testpersonen und dem, was noch fehlt. Mit jedem neuen Ablauf im Frontend nachführen
  - `docs/MVP.md`: Architektur und Umfang des MVP auf einen Blick, **Momentaufnahme vom 5. November 2026**, wird nicht nachgeführt
  - `docs/ROADMAP.md`: Stufen 0–4 und Meilensteine M0–M5
  - `docs/EPICS.md`: Epics als Basis für User Stories, nach Roadmap-Stufen geordnet
  - `database/scripts/roles_database.sql` und `database/scripts/schema/`: Datenbank. `schema.sql` ist der Einstieg und bindet die Teile `00_setup.sql` … `90_privileges.sql` ein. Eingespielt wird das Schema über Migrationen: `database/scripts/migrations/` (`0001_initial_schema.sql` = Stand vom 8. November 2026, erzeugt mit `schema/bundle.sh`; `0002_sessions.sql` Sitzungen der API, `0003_accept_invite_links_login.sql`, `0004_has_admin_workspace.sql`, `0005_sync_user_groups_worker_only.sql`, `0006_users_no_direct_insert.sql`, `0007_accept_invite_login_first.sql`, `0008_people_visibility.sql`, `0009_session_id_token.sql`, `0010_review_small_rights.sql`, `0011_perm_source_by_path_ids.sql`, `0012_split_store_content.sql` Inhalt in zwei Schritten) und `database/scripts/migrate.sh`. Tests in `database/scripts/schema_test/`: `schema_test.sql` (Einstieg, Teile `01_basics.sql` … `20_content_split.sql`), `schema_concurrency_test.sh`, `schema_migrations_test.sh` (schema/ und Migrationen ergeben dasselbe Schema) und `ci.sh` (alle Datenbanktests auf einem leeren Server)
  - CI: Das Repository liegt auf GitHub; `.github/workflows/sync-to-gitlab.yml` spiegelt `main` nach GitLab (`gitlab.com/peterforster101/notefieber`), dort läuft `.gitlab-ci.yml` mit drei Jobs: `database` (`postgres:18.6` mit Service, führt `ci.sh` aus), `apps` (`pnpm check`) und `api` (API-Tests gegen eine Wegwerf-Datenbank: `setup_test_db.sh`, dann `pnpm test:db`). Neue Prüfungen kommen in `.gitlab-ci.yml`, nicht nach GitHub Actions
  - `docs/SCHEMA.md`: Referenz zum Datenmodell (jede Tabelle und Spalte, Rollen, Regeln, jede Funktion). Bei Änderungen am Schema mit anpassen.
  - `database/scripts/seed/seed.sql`: Testdaten für die lokale Entwicklung (Mandanten Alpenwerk und Nordlicht, Personen, Spaces und Seiten wie im Prototyp). Geht über die Funktionen in `app`; bei geänderten Funktionen mitziehen.
  - `compose.yaml`: lokale Umgebung: PostgreSQL 18 (Container `nf-pg18`, Volume `notefieber-pgdata`), Garage (`nf-garage`, S3 auf `localhost:3900`) und Zitadel v4 (`nf-zitadel` mit Anmeldeseiten `nf-zitadel-login` hinter dem Traefik `nf-zitadel-proxy`, Issuer `http://localhost:8080`, Datenbank `zitadel` im selben PostgreSQL). Beim ersten Start spielt `docker/postgres/initdb/10-notefieber.sh` Rollen, Schema und Testdaten ein; `docker/garage/` richtet Garage ein (Bucket `wiki`); `docker/zitadel/init.mjs` legt Projekt `notefieber`, die Clients `notefieber-login` (vertraulich, für den Login der API) und `notefieber-api`, die Organisationen und Testpersonen aus `seed.sql` mit **denselben festen IDs** an (`org-alpenwerk`, `user-peter-forster` …) und schreibt Client-IDs nach `.local/zitadel.env` (nicht im Repository). Testpersonen immer in `seed.sql` und `init.mjs` zusammen ändern; einzige Ausnahme ist Nina Neu, die es nur in Zitadel gibt (zum Ausprobieren von Einladungen). Gruppen stehen nur in `seed.sql` (sie gehören dem Wiki, Abschnitt 8).
  - `docs/LOCAL_SETUP.md`: lokale Entwicklung (Voraussetzungen, `docker compose up`, Schema, Tests, Testdaten, Fehlerbehebung). Mit jedem neuen Baustein (Zitadel, Garage, Apps) ergänzen.
  - `docs/models/data_model/`: ER-Diagramm als `data_model.mmd` (Mermaid) und `data_model.svg`. Bei Änderungen am Schema alle zwei nachziehen.
  - `docs/models/architecture/`: `architecture.svg` (Startsetup), `architecture_target.svg` (Zielarchitektur)
  - `apps/`, `packages/`, `package.json`, `pnpm-workspace.yaml`: die Apps als pnpm-Monorepo. `apps/web` (Next.js), `apps/api` (Express-API und Worker, zwei Einstiegspunkte `src/api.ts` und `src/worker.ts`), `apps/collab` (Hocuspocus), `packages/shared` (Rollen, Ereignisse, Zod-Schemas, Prüfung der Datenbankrolle), `packages/editor-schema` (BlockNote-Schema, Aufbau des Yjs-Dokuments, Klartext; unter `/server` die Umwandlung Yjs ↔ BlockNote-JSON ohne DOM für Worker und Collab-Server). Stand: Login (OIDC über Zitadel, Sitzung in der API, `apps/api/src/auth/`), Spaces und Seitenbaum (API `apps/api/src/routes/spaces.ts`, Seitenleiste im Frontend), noch ohne Editor. Tests: `*.test.ts` ohne Datenbank (`pnpm test`), `*.dbtest.ts` gegen eine Wegwerf-Datenbank (`pnpm test:db`, nie gegen `nf-pg18`). Einstellungen in `.env` (Vorlage `.env.example`), Login-Rollen der Apps lokal aus `database/scripts/local_login_roles.sql` (`wiki_api`, `wiki_collab`, `wiki_jobs`). Prüfen mit `pnpm check` (auch CI-Job `apps`). Anleitung in `docs/LOCAL_SETUP.md`, Abschnitt 7.
  - `LICENSE`: proprietär, alle Rechte vorbehalten. Lizenzen der Abhängigkeiten prüft `scripts/check-licenses.mjs`.
  - `prototype/`: klickbarer UI-Prototyp (Seitenansicht mit Kommentaren und Rechte-Dialog, Confluence-Import). Referenz für Gestaltung und Abläufe, kein Produktcode.
- **Betriebsmodell:** vorrangig SaaS auf eigenem K3s. Self-Hosting per Helm-Chart kommt später als zweites Standbein, weil gerade Confluence-Data-Center-Kunden bewusst on-prem arbeiten (Abschnitt 3).

## 2. Markt und Positionierung (Stand November 2026)

- **Der Hebel ist Confluence Data Center.** Atlassian stellt Data Center ein: seit 30. März 2026 keine neuen Kundenlizenzen, ab März 2028 keine Verlängerungskäufe mehr für Bestandskunden, am **28. März 2029** werden alle Instanzen schreibgeschützt. Organisationen, die bewusst on-prem arbeiten (Behörden, Banken, Versicherungen, KRITIS, Industrie), müssen in die US-Cloud oder wechseln. Das ist ein klar abgegrenzter, zahlungsbereiter Markt mit einer Frist.
- **Bestehende europäische Optionen:**
  - **La Suite Docs** (französische DINUM und deutsches ZenDiS, MIT-Lizenz, Django + React + BlockNote): gratis und staatlich finanziert. Wer nur „Notion in der EU“ baut, konkurriert dagegen.
  - **XWiki** (Frankreich, Open Source) ist der direkte Konkurrent: kostenpflichtiges Confluence-Migrationspaket (Struktur, Inhalte, Anhänge, Verlauf, Kommentare, Rechte), gemeinsames Bearbeiten seit Version 16.9 standardmäßig, on-prem und als Cloud, Wiki-Komponente von openDesk. Schwächen laut Vergleichen: nur ein Teil der Confluence-Makros voll unterstützt, keine Anhang-Historie, beim gemeinsamen Bearbeiten kein Verlauf pro Person, großes Java-System.
  - **BlueSpice** (Deutschland, auf MediaWiki), on-prem oder deutsche Cloud, wirbt gezielt um Confluence-Data-Center-Kunden.
  - Nuclino (Deutschland), Anytype (Schweiz), dazu Open-Source-Wikis wie Docmost und BookStack.
- **Folge:** „Europäisch, Confluence-Import, Rechte, On-Prem“ allein unterscheidet nicht, das bietet XWiki schon. Der Unterschied muss in der **Bedienung** (modern wie Notion), in einem **Import, dem man vertraut** (Probelauf, Bericht, vorher berechnete Rechte), in **verständlichen Rechten** und in **Wiki und Chat aus einer Hand** liegen.
- **Positionierung:** der souveräne Confluence-Nachfolger für regulierte Organisationen. Unterscheidungsmerkmale:
  - **Ein wirklich guter Confluence-Import** mit Seitenhierarchie, Versionen, Rechten, Anhängen und den häufigsten Makros. Das unglamouröse Feature, das Kaufentscheidungen trifft.
  - **SaaS in der EU und später on-prem**, mit europäischem Rechtsträger ohne US-Mutter (außerhalb der Reichweite des CLOUD Act).
  - **Compliance als Produktmerkmal:** Audit-Log, feingranulare Rechte, SSO/SCIM, Aufbewahrung, Blick auf NIS2, ISO 27001 und BSI C5.
  - **Zusammen mit TalkFieber** ein Paket aus Wiki und Chat. Teams lässt sich realistisch nur als Teil eines größeren Pakets ersetzen.

## 3. Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Bauweise | **Eigenbau.** BlockNote, Yjs und Hocuspocus als Bibliotheken, kein Fork von La Suite Docs |
| Umfang | **Ein Wiki, kein Notion:** Seitenbaum, gemeinsames Bearbeiten, Suche, Import. Datenbanken, Boards und KI erst später |
| Sprache | **TypeScript durchgängig** (wie TalkFieber). Frontend, API und Collab-Server teilen Typen |
| Frontend | **Next.js** (App Router) als Standalone-Container, **nur Oberfläche**: keine Geschäftslogik in Server Actions oder Route Handlern |
| API | **Node.js mit Express 5**, Zod für Validierung, Drizzle ORM |
| Editor | **BlockNote** (MPL-2.0, auf Tiptap/ProseMirror). Die XL-Pakete (GPL-3.0) vorerst nicht verwenden |
| Echtzeit | **Yjs + Hocuspocus** (MIT). Ein Yjs-Dokument pro Seite, Name `page:<id>` |
| Inhalt speichern | **Yjs-Zustand maßgeblich, BlockNote-JSON daneben** (`content_json` in `page_contents` und `page_versions`), damit Export, Import und ein späterer Editorwechsel nicht an Yjs hängen. Der Collab-Server speichert nur Yjs-Zustand und Titel; BlockNote-JSON und Klartext leitet der Worker ab, wenn die Seite ruht |
| Collab-Server | **Schlank** (entschieden 14. November 2026, `ARCHITECTURE_REVIEW.md` A-04 bis A-08): Anmeldung über das Sitzungs-Cookie beim WebSocket-Handshake (`Origin` prüfen, `app.resolve_session`, Rolle mit `app.page_rank(seite, person)`), Rechteänderungen per `LISTEN/NOTIFY` aus einem Trigger auf der Outbox, Änderungen von der Serverseite über einen internen Aufruf (nur im Cluster, geteiltes Geheimnis, Hocuspocus `openDirectConnection`). Die Umwandlung Yjs ↔ BlockNote-JSON (`@blocknote/server-util`, MPL-2.0) läuft im Worker; das Editor-Schema liegt in `packages/editor-schema` für Browser, Worker und Import |
| Rechte prüfen | **„Ansehen als …“** über `app.view_as`: nur für Admins, nur Struktur und Rolle, im Audit-Log |
| Datenbank | **PostgreSQL 18** über **CloudNativePG**, eigene Datenbank `wiki` im selben Cluster wie TalkFieber (`chat`) und Zitadel |
| Login | **Zitadel**, selbst gehostet, gemeinsam mit TalkFieber. Die App spricht nur generisches OIDC und liest Zitadel-Claims nur an einer Stelle der API (`auth/claims.ts`, einstellbare Claim-Namen), damit später ein anderer Login-Dienst passt. **Die API meldet an** (Code-Flow mit PKCE und Client-Geheimnis, Client `notefieber-login`) und hält die **Sitzung in PostgreSQL** (`sessions`); der Browser bekommt nur ein HttpOnly-Cookie, keine Tokens. Neue Personen kommen nur über eine Einladung hinein (Link in einen Workspace, angenommen beim Login, nur mit passender bestätigter E-Mail); das Konto beim Login-Dienst legt die App nie an |
| Gruppen | **Gehören dem Wiki** (Tabelle `groups`), nicht dem Login-Dienst: Zitadel v4 hat keine Gruppen. Quellen: im Wiki angelegt (Organisations-Admins), Confluence-Import, später SCIM und ein Gruppen-Claim im Token (z. B. Entra ID) |
| Produktname | **NoteFieber** bleibt vorerst (Arbeitstitel, Abschnitt 4) |
| Lizenz | **Proprietär**, vorerst |
| Betrieb zuerst | **SaaS** vorrangig, On-Prem (Helm-Chart, E23) später |
| Monorepo | **pnpm-Workspaces**: eine `package.json` pro App, eine Lock-Datei, gemeinsame Typen in `packages/shared`. API und Worker teilen ein Paket (ein Image, zwei Deployments), Collab-Server und Frontend eigene |
| Laufzeit | **Node.js 24** führt TypeScript direkt aus (Typen werden beim Laden entfernt): kein Build-Schritt für API, Worker und Collab-Server, nur Syntax, die sich wegstreichen lässt (`erasableSyntaxOnly`, Importe mit `.ts`). TypeScript 6.0 und ESLint 9, bis `typescript-eslint` TypeScript 7 und die Next.js-Regeln ESLint 10 unterstützen. Alle Versionen fest |
| Repository und CI | **GitHub** als Repository (`peterforster10/notefieber`), **CI auf GitLab** (`peterforster101/notefieber`, `.gitlab-ci.yml`). Die GitHub Action `sync-to-gitlab.yml` spiegelt jeden Push auf `main` ohne `--force` nach GitLab; dort nie direkt committen. Keine CI in GitHub Actions |
| Dateien | **Garage** (S3-kompatibel) im Cluster, eigener Bucket pro Produkt |
| Suche | Volltext in PostgreSQL (`tsvector`, `pg_trgm`), Index vom Worker gepflegt |
| Mandanten | **Mandantenfähig von Anfang an:** `tenant_id` auf jeder Tabelle, Row Level Security, gleiches Modell wie TalkFieber (Mandant → Workspaces). Dieselbe `tenant_id` in beiden Produkten |
| Rechte | Rollen viewer, commenter, editor, admin auf Space-Ebene, an Seiten vererbt. Eine Seite kann die Vererbung kappen und eigene Rechte haben |
| Verschlüsselung | **Keine Ende-zu-Ende-Verschlüsselung** (bricht Suche, Import und Export). TLS und Verschlüsselung der gespeicherten Daten |
| Betrieb | Start auf **K3s auf dem Hostinger-VPS**, gemeinsam mit TalkFieber. Entwicklung lokal |
| Offline | Kein echter Offline-Modus im MVP, nur kurze Verbindungsabbrüche überbrücken |

## 4. Offene Entscheidungen

1. **Produktname.** Vorerst bleibt es bei „NoteFieber“ (Abschnitt 3). Endgültig ist der Name nicht. Es gelten dieselben Bedenken wie bei „TalkFieber“: „Fieber“ klingt hektisch und nach Krankheit, funktioniert nur auf Deutsch. „Note“ klingt nach persönlicher Notiz-App, nicht nach Firmen-Wiki. Für ein Produktpaar lohnt sich ein gemeinsamer Markenname mit zwei Produktnamen. Vor der Festlegung Marke (EUIPO/TMview, Klassen 9, 38, 42), Domains und Sprachcheck prüfen.
2. ~~**Lizenz des eigenen Codes**~~ **Vorerst entschieden:** proprietär (Abschnitt 3). Open Core (AGPL + Enterprise-Lizenz) oder Quelltext für Kunden bleiben spätere Optionen, etwa für das On-Prem-Paket.
3. **BlockNote-XL-Pakete** (PDF-, Word-, ODT-Export, mehrspaltige Layouts, KI): GPL-3.0 oder kommerzielle Lizenz, oder selbst bauen.
4. ~~**Reihenfolge SaaS vs. On-Prem**~~ **Entschieden:** vorrangig SaaS, On-Prem später (Helm-Chart für Kunden in Stufe 3, Epic E23).
5. **Rechte-Semantik beim Import:** Confluence schränkt Leserechte über Seiten hinweg ein (Schnittmenge), Bearbeitungsrechte erben nicht. Unser Modell kennt nur „erben“ oder „gekappt“. Beim Import wird eine eingeschränkte Confluence-Seite zu einer Seite mit gekappter Vererbung, deren Rechte der Importer ausrechnet. An echten Exporten prüfen, ob das reicht.
6. **Eindeutige Seitentitel pro Space?** Confluence verlangt sie, wir verlinken über IDs. Vorerst nicht erzwingen, der Import löst Titel-Links über `import_items` auf.
7. **Ab wann eigene Zellen** (komplett getrennte Instanz des ganzen Stacks für große Kunden oder Behörden), wie bei TalkFieber geplant.
8. **Zielgruppe:** breit für KMU oder vertikal (Verwaltung, Finanz, KRITIS, Industrie). Die Confluence-Frist spricht für regulierte Organisationen.
9. ~~**BlockNote-JSON zusätzlich speichern?**~~ **Erledigt:** `page_contents.content_json` und `page_versions.content_json` (siehe Abschnitt 8). Der Worker leitet das JSON aus dem Yjs-Zustand ab, sobald die Seite ruht; der Export liefert Markdown plus BlockNote-JSON plus Anhänge.
10. ~~**„Ansehen als …“**~~ **Erledigt in der Datenbank:** `app.view_as(space, person, actor)` (siehe Abschnitt 8). API und Oberfläche fehlen noch (E09).
11. ~~**Wem gehören die Gruppen?**~~ **Entschieden:** dem Wiki (Abschnitte 3 und 8). Zitadel hat keine Gruppen; die vorläufigen Projektrollen sind entfernt. Offen bleibt, wie SCIM und ein Gruppen-Claim später angebunden werden (E17, E03).

## 5. Mindestumfang

**Wiki (MVP):**
- Workspaces, Spaces, Seitenbaum mit Drag & Drop
- Block-Editor: Überschriften, Listen, Tabellen, Code, Bilder, Callouts, Seitenlinks
- Echtzeit-Bearbeitung mit Cursorn und Anwesenheit
- Kommentare an Textstellen und an der Seite
- Versionshistorie mit Wiederherstellen, Papierkorb
- Rechte auf Space- und Seitenebene mit Vererbung, Gruppen im Wiki (von Organisations-Admins gepflegt oder aus dem Import)
- „Ansehen als …“ für Space-Admins, um nach dem Import zu prüfen, dass niemand mehr sieht als vorher (`app.view_as`)
- Volltextsuche über Titel und Inhalt
- Login über OIDC (Zitadel)
- **Confluence-Import** (Space-Export als HTML/XML): Hierarchie, Inhalte, Anhänge, Rechte, häufige Makros, Rest als sichtbarer Platzhalter
- Export: Markdown + BlockNote-JSON + Anhänge als ZIP
- Audit-Log
- Installation per Manifesten auf K3s

**Bewusst nicht im MVP:** Datenbanken und Tabellen-Ansichten à la Notion, KI, Mobile-Apps (responsives Web reicht), echter Offline-Modus, öffentliche Seiten und Gastzugänge, Integrationen außer einem Webhook, Jira-Anbindung.

**Was Geschäftskunden vor der Unterschrift verlangen:**
- SSO (OIDC/SAML, insbesondere Entra ID) und SCIM
- Admin-Konsole, Aufbewahrungsrichtlinien, vollständiger Export, Audit-Log mit Export
- Gäste und Freigaben nach außen
- Self-Hosting-Paket (Helm-Chart) für On-Prem-Kunden
- Vorlagen, Seiteneigenschaften, Einbettungen (Ersatz für die wichtigsten Confluence-Makros)

**Für später:** Integration mit TalkFieber, KI mit europäischem Modell (z. B. Mistral), Datenbanken, Whiteboards, Mobile-Apps.

## 6. Architektur

Bewusst einfach: ein **modularer Monolith** in drei Prozessen (Frontend, API, Collab-Server) plus Worker. Keine Microservices, keine eigene NoSQL-Datenbank. PostgreSQL ist die einzige Wahrheit für Struktur, Rechte und Inhalt.

Startsetup: `docs/models/architecture/architecture.svg`, Zielarchitektur: `docs/models/architecture/architecture_target.svg`.

```
Browser (Next.js-Frontend, BlockNote im Client)
   │ HTTPS · REST                     │ WebSocket (Yjs)
   ▼                                  ▼
API (Express)  ── interner Aufruf ─►  Collab-Server (Hocuspocus)
Seiten, Rechte, Suche,                Yjs-Sync, Cursor, Anwesenheit,
Kommentare, Import starten            Rechte beim Verbinden (Sitzung, page_rank)
   │                                  │ speichert Yjs gebündelt (wiki_worker), LISTEN
   │                                  │ auf Ereignisse aus der Outbox
   └──────────────► PostgreSQL ◄──────┘
                    (Struktur, Rechte, Yjs-Zustand, Versionen, Suche, Outbox)
Worker: BlockNote-JSON und Klartext aus Yjs, Suchindex, Versionen, Links, Import, Export,
        Outbox → NATS (mit TalkFieber)
Garage (S3): Anhänge, Bilder, Export- und Import-Archive
Zitadel: Login (OIDC), Person und Mandant
```

**Der Weg einer Änderung:**
1. Der Browser öffnet eine WebSocket-Verbindung zum Collab-Server (`/collab`, gleiche Adresse), Dokument `page:<id>`. Das Sitzungs-Cookie geht beim Handshake mit (lokal auch auf einem anderen Port: Cookies gelten für den Host, nicht den Port).
2. `onAuthenticate` prüft `Origin`, findet die Sitzung über `app.resolve_session` und die Rolle über `app.page_rank(seite, person)`, beides als `wiki_worker`, ohne Rückfrage an die API. Viewer und Commenter bekommen eine schreibgeschützte Verbindung, Editoren eine schreibende.
3. `onLoadDocument` lädt `page_contents.ydoc`. Ist es noch der leere Anfangszustand (`\x0000`), schreibt der Collab-Server zuerst `pages.title` in `Y.Text` „title“, sonst überschreibt das erste Speichern den Titel mit einem leeren. Ist außerdem `content_json` gefüllt (Testdaten aus `seed.sql`, später der Confluence-Import), baut er das Dokument aus diesem BlockNote-JSON und sichert es mit `app.store_initial_ydoc` (nur als Rückfall: normalerweise hat der Worker das schon getan, siehe `app.pages_to_derive`; die Umwandlung braucht nur einen Editor ohne Oberfläche aus `packages/editor-schema/server`, kein jsdom und kein React). Wer Inhalt ohne Collab-Server schreibt, muss also nur `content_json` und `plain_text` liefern, kein Yjs.
4. Änderungen laufen als Yjs-Updates zwischen allen Clients. Cursor und Anwesenheit über Yjs Awareness, nie gespeichert.
5. `onStoreDocument` (entprellt, ca. alle 2 s, spätestens nach 10 s) speichert mit `app.store_ydoc` nur Yjs-Zustand, Titel und Bearbeitende und markiert den abgeleiteten Inhalt als veraltet (`page_contents.derived_stale`). Das ist der heiße Pfad; er bleibt klein (wenig WAL, keine Umwandlung, kein Ereignis).
6. Ruht die Seite (ca. 30 s, `app.pages_to_derive` über alle Mandanten), leitet der Worker BlockNote-JSON und Klartext aus dem Yjs-Zustand ab und speichert sie mit `app.store_derived`, nur wenn seither nicht wieder gespeichert wurde; dabei aktualisiert er den Suchindex (Verlinkungen folgen); `page.updated` entsteht einmal pro Ruhephase, nicht bei jedem Speichern. Versionen einer veralteten Seite bekommen kein BlockNote-JSON (`NULL`), maßgeblich ist ihr Yjs-Zustand. Nach 10 Minuten Ruhe legt er eine Version an. Suche und Export können deshalb bis etwa 30 s hinter dem Editor liegen.

**Weitere Punkte:**
- **Rechte:** Suche, Seitenbaum, Link-Vorschau, Benachrichtigungen, Export und Import gehen alle durch dieselben Funktionen (`app.page_rank`). Die meisten Datenlecks in Wikis entstehen über Nebenwege.
- **Rechteänderung während einer Sitzung:** Bei `grant.changed`, `page.permissions_changed` (auch nach Verschieben), `member.removed`, `member.changed`, `user.deactivated`, `space.archived`, `page.trashed` und `page.restored` trennt der Collab-Server betroffene Verbindungen, sie authentifizieren sich neu. Liegt eine Seite im Papierkorb (`page.trashed`, auch für jede Seite darunter), wird die Verbindung schreibgeschützt mit einem Hinweis und, für Bearbeitende, „Wiederherstellen“; nach `page.restored` wieder schreibend (beides über eine neue Anmeldung, bei der `onAuthenticate` auch `deleted_at` prüft; `store_ydoc` lehnt Seiten im Papierkorb ohnehin ab). Er erfährt davon über `LISTEN`: Ein Trigger auf `outbox` ruft `pg_notify` mit Mandant, Space und Art des Ereignisses auf; dafür kennt er zu jedem offenen Dokument den Space. Später ersetzt NATS nur den Transport. `store_ydoc` prüft selbst keine Rechte.
- **Änderungen von der Serverseite** (Version wiederherstellen, Umbenennen aus der Seitenleiste, Nacharbeiten nach dem Import, später Vorlagen) laufen über einen internen Aufruf an den Collab-Server, nur im Cluster erreichbar und mit geteiltem Geheimnis. Er ändert über Hocuspocus `openDirectConnection`, offene Browser sehen die Änderung sofort.
- **Wiederherstellen einer Version** prüft zuerst die API (editor auf der Seite, `app.page_role`), dann rechnet der Collab-Server in Yjs (interner Aufruf): alten Stand laden, als neues Update anwenden, speichern, dann `app.create_version(…, 'restore', …, restored_from)`. Die Historie bleibt linear.
- **Skalierung:** Im MVP eine Hocuspocus-Instanz (Recreate-Strategie, nie zwei Instanzen pro Dokument). Später mehrere über die Redis-Erweiterung mit Valkey oder Routing nach Dokument-ID.
- **Mandantentrennung:** gemeinsame Datenbank mit `tenant_id` und Row Level Security, später Zellen.

## 7. Schnittstellen

- **Adressen im Frontend:** `/spaces/<schlüssel klein>` und `/spaces/<schlüssel klein>/pages/<titel>-<kurze id>`, z. B. `/spaces/entw/pages/architektur-034uANlqQWodlcQ4FIOXYJ`. Space-Schlüssel bleiben in Datenbank und Anzeige groß (`ENTW`, wie Confluence), nur die Adresse schreibt sie klein. Die kurze ID ist die UUID in Base62 (22 Zeichen); nur sie zählt, der Titel ist Schmuck und wird nach dem Umbenennen nachgezogen (`packages/shared/src/urls.ts`).
- **REST (API):** JSON, versioniert unter `/api/v1`. Schreibende Abläufe rufen die Funktionen im Schema `app` auf.
- **Yjs über WebSocket (Collab-Server):** Hocuspocus-Protokoll unter `/collab`. Dokumentname `page:<uuid>`. Struktur im Yjs-Dokument: `Y.XmlFragment` für den BlockNote-Inhalt, `Y.Text` „title“ für den Titel. Der Titel ändert sich **nur über Yjs** (im Editor oder aus der Seitenleiste über den internen Aufruf an den Collab-Server), `pages.title` ist die Kopie, die `store_ydoc` schreibt (auf 255 Zeichen gekürzt). Die API ändert Titel nie direkt.
- **Inhalt außerhalb von Yjs:** Der Worker leitet aus dem Yjs-Zustand das BlockNote-JSON (`page_contents.content_json`) und Klartext für Suche und KI ab, sobald die Seite ruht (`@blocknote/core/yjs` mit einem Editor ohne Oberfläche und dem Schema aus `packages/editor-schema`; `@blocknote/server-util` braucht es dafür nicht). Export und Import arbeiten mit BlockNote-JSON bzw. Markdown, nie direkt mit Yjs-Binärdaten. Nur wenn `content_json` fehlt (`NULL`: über 20 MB oder ungültig), wandelt der Worker den Yjs-Zustand um.
- **Events in der Outbox** (Subject `t.{tenant}.wiki.s.{space}`, später von TalkFieber abonniert):
  - Spaces: `space.created`, `space.updated`, `space.archived`
  - Seiten: `page.created`, `page.updated`, `page.moved`, `page.trashed`, `page.restored`, `page.permissions_changed`
  - Rechte: `grant.changed`
  - Personen (an jeden betroffenen Space): `member.removed`, `member.changed` (auch bei Ein- und Austritt in eine Gruppe, an jeden Space, in dem die Gruppe Rechte hat), `user.deactivated`
  - Kommentare: `comment.created`
  - Import: `import.requested`

## 8. Datenmodell (PostgreSQL)

Maßgeblich ist das Schema in `database/scripts/schema/` (Einstieg `schema.sql`, Teile nach Bereichen). Jede Datenbank bekommt es über die Migrationen in `database/scripts/migrations/` (`migrate.sh`); beide ergeben dasselbe Schema (`schema_migrations_test.sh`). Jede Tabelle hat `tenant_id` und Row Level Security. IDs sind UUIDv7 (in PostgreSQL 18 eingebaut).

**Gleich wie in TalkFieber:** `tenants` (mit `idp_org_id` für Zitadel), `users`, `workspaces`, `workspace_members`, `invites`, `outbox`, `audit_log`, dieselben Funktionen `create_tenant`, `accept_invite`, `resolve_tenant`, `find_invite`, `remove_workspace_member` und die Schutz-Trigger für letzten Owner und letzten Organisations-Admin.

**Wiki-Tabellen:**
- **`groups`, `group_members`:** Gruppen gehören dem Wiki und gelten für den ganzen Mandanten. `source` sagt, woher eine Gruppe kommt: `local` (in der Oberfläche angelegt), `import` (Confluence-Import), `idp` (Gruppen-Claim im Token, `app.sync_user_groups`, derzeit ungenutzt und nur für `wiki_worker` ausführbar, sonst trüge sich jede Person selbst in jede `idp`-Gruppe ein), `scim` (später); `external_id` ist ihre ID in der Quelle. `local` und `import` pflegen Organisations-Admins (`app.create_group`, `rename_group`, `delete_group`, `add_group_member`, `remove_group_member`), `idp` und `scim` nur ihre Quelle. Der Login-Abgleich berührt nur `idp`-Gruppen. Aus Zitadel kommen nur Person (`sub` = `users.idp_subject`) und Mandant (`urn:zitadel:iam:user:resourceowner:id` = `tenants.idp_org_id`).
- **`sessions`:** Sitzungen der API, nur der SHA-256-Hash des Cookie-Tokens, dazu das ID-Token aus dem Login (nur als `id_token_hint` beim Abmelden, sonst beendet Zitadel seine Sitzung erst nach einer Kontenauswahl), Ablauf höchstens 30 Tage. Schreiben nur über `app.create_session` (für sich selbst, nur aktive Personen), `app.end_session` (Abmelden) und `app.set_user_active` (Deaktivieren löscht alle Sitzungen der Person); `app.resolve_session` findet eine gültige Sitzung vor dem Mandanten-Kontext. Personen sehen nur die eigenen.
- **`spaces`:** `key` (wie Confluence, z. B. `ENTW`, eindeutig pro Mandant), `name`, `workspace_id`, `home_page_id`, `archived_at` (archiviert = nur lesbar).
- **`pages`:** `parent_id`, `path` (ltree aus den IDs, vom Trigger gesetzt), `position` (Fractional Index), `title`, `inherit_perms`, `deleted_at` und `trash_root_id` für den Papierkorb.
- **`page_contents`:** `ydoc` (Yjs-Zustand, maßgeblich), `content_json` (BlockNote-JSON, `NULL` = fehlt), `plain_text`, `editors_since_version`. `page_versions` hat dieselben Fassungen als Momentaufnahme.
- **`page_versions`:** fortlaufende `version` pro Seite, `kind` (auto, manual, restore, import), Snapshot von Titel, Yjs und Klartext, `author_ids`.
- **`page_search`:** `tsvector`, vom Worker gepflegt. **`page_links`:** Verlinkungen für Rückverweise.
- **`grants`:** auf einen Space **oder** eine Seite; Subjekt eine Person, eine Gruppe oder `workspace` (alle Mitglieder ohne Gäste); Rolle viewer, commenter, editor, admin.
- **`comments`:** Seiten- oder Textstellen-Kommentare (`anchor` = relative Yjs-Position), Antworten eine Ebene tief, erledigt-Status.
- **`files`:** Anhänge einer Seite oder Profilbilder, Inhalt in Garage.
- **`imports`, `import_items`:** Importläufe (Probelauf als Standard) und die Zuordnung Confluence-ID → neue Seite.

**Rechte auflösen (`app.page_rank`):**
1. Die Person muss Mitglied im Workspace des Spaces und aktiv sein.
2. Von der Seite den `path` hinauf bis zur nächsten Seite mit `inherit_perms = false` (oder bis zur Seite selbst). Gibt es eine, gelten deren Grants, sonst die des Spaces.
3. Grants für die Person, ihre Gruppen und `workspace` (nicht für Gäste) sammeln, höchste Rolle gewinnt.
4. Archivierte Spaces: höchstens viewer.

**Regeln, die die Datenbank selbst absichert:**
- **`wiki_app` schreibt nur über die Funktionen in `app`** (`SECURITY DEFINER`, prüfen Rechte und Mandant selbst). Direkt nur: eigenes Profil (Name, Sprache, Zeitzone, Profilbild), Einladungen und Workspaces (nur wer sie verwaltet), Anhänge (ungeprüft, an Seiten nur als editor). Seiten gar nicht direkt: Titel über Yjs, Reihenfolge über `app.move_page` (auch innerhalb derselben Elternseite). Rechte, Mitgliedschaften, Gruppen, Spaces, Seitenbaum, Vererbung, Inhalt, Versionen, Kommentare, Import, Outbox und Audit-Log nie direkt, ebenso wenig neue Personen (nur über Einladungen, `app.accept_invite`). Interne Bausteine (`emit`, `audit`, `insert_version`, `grant_rank` …) kann `wiki_app` nicht aufrufen. Ebenso wenig die Rechte anderer Personen: `app.page_rank(seite)` und `app.space_rank(space)` gelten für die angemeldete Person, die Varianten mit Person (`page_rank(seite, person)`) nutzen nur Funktionen und Worker.
- Neue Funktionen sind für niemanden ausführbar (globale Default Privileges von `wiki_owner`), bis die Migration sie ausdrücklich an `wiki_app` und/oder `wiki_worker` freigibt.
- Elternseite immer im selben Space (`FOREIGN KEY (parent_id, space_id)`), keine Zyklen (`app.move_page`).
- Änderungen am Seitenbaum sperren den Space (`app.lock_tree`): Verschieben, Papierkorb und Vererbung exklusiv, neue Seiten geteilt. Gleichzeitiges Verschieben erzeugt so keine Zyklen und keine veralteten Pfade.
- `path`, `parent_id`, `space_id`, `inherit_perms` und Papierkorb-Spalten sind für die App nicht direkt änderbar (Spaltenrechte), nur über Funktionen.
- **Verschieben aus einem Bereich mit eigenen Rechten** (Seite mit gekappter Vererbung oberhalb) nur als Admin dieser Seite, hinein genügt editor am Ziel.
- Leser können weder direkt noch über Funktionen Seiten anlegen oder Inhalt ändern.
- Inhalt (`store_ydoc`, `store_derived`, `store_initial_ydoc`) und automatische Versionen schreibt nur `wiki_worker`, manuelle Versionen `app.save_version` (editor). `app.pages_to_derive` sieht alle Mandanten und ist deshalb nur für `wiki_worker` ausführbar.
- „Alle im Workspace“ kann höchstens editor sein (`CHECK`), Admins werden namentlich oder als Gruppe vergeben.
- Jeder Space und jede Seite mit gekappter Vererbung behält mindestens einen **wirksamen** Admin: Grant für eine Person oder eine Gruppe mit einem Mitglied, die aktiv und Mitglied im Workspace des Spaces ist (`app.has_admin`; Gruppen gelten für den ganzen Mandanten, Zugriff gibt es nur über den Workspace). Geprüft in `app.set_grant`, `app.remove_workspace_member`, `app.remove_group_member` und `app.delete_group`, als Rückfallebene beim Commit im Trigger `admin_remains`. Nicht abgedeckt: Deaktivieren und Gruppenwechsel aus dem Login-Dienst (`idp`, später `scim`) ändern keine Grants. Dann setzt ein Organisations-Admin einen neuen Admin.
- **Personen, Workspaces, Mitgliedschaften und Gruppen** sieht man nur aus Workspaces, in denen man selbst Mitglied ist (nicht nur Gast), dazu sich selbst; Organisations-Admins sehen alle. Gäste sehen damit keine Personenliste. Vor dem Login (keine Person im Kontext) ist niemand sichtbar, die API findet die Person über `app.resolve_login`.
- Audit-Log lesen nur Organisations-Admins. Einträge aus der API über `app.audit_event`, immer im Namen der angemeldeten Person und nur für Aktionen der API (Bereiche `invite`, `export`).
- Verbinden mit der Datenbank nur ausdrücklich berechtigte Rollen (`CONNECT` nicht für `PUBLIC`).
- Gelöschte Kommentare haben keinen Inhalt mehr (`CHECK`). Auf Seiten im Papierkorb lässt sich nicht kommentieren.
- Wiederherstellen einer Version verweist nur auf eine vorhandene, ältere Version (`restored_from`, Fremdschlüssel).
- Verweise über Mandanten, Spaces und Seiten hinweg lehnen Fremdschlüssel ab.

**Wichtige Details:**
- **Vererbung kappen** (`app.set_page_inheritance`) kopiert die bisher geltenden Rechte auf die Seite und macht die handelnde Person zum Admin der Seite. Danach lassen sie sich mit `app.set_grant` einschränken. So sperrt sich niemand versehentlich aus.
- **Organisations-Admins** sehen Inhalte nicht automatisch. Sie können aber auf jedem Space Rechte setzen (Wiederherstellung, wenn kein Admin mehr erreichbar ist). Das steht im Audit-Log.
- **„Ansehen als …“** (`app.view_as(space, person, actor)`): Admins des Spaces und Organisations-Admins sehen, welche Rolle eine Person auf jeder Seite hat. Nur Struktur und Rolle, keine Inhalte; Seiten ohne Zugriff der Person mit Rolle `NULL`. Seiten mit eigenen Rechten, die die handelnde Person nicht selbst verwaltet, fehlen samt Unterseiten; Papierkorb fehlt. Jeder Aufruf im Audit-Log (`space.viewed_as`). Die Suche „als …“ filtert die API auf die Seiten mit Rolle.
- **Verschieben** (`app.move_page`) und **Papierkorb** (`app.trash_page`) laufen als `SECURITY DEFINER`, weil der Teilbaum eingeschränkte Seiten enthalten kann, die die handelnde Person nicht sieht. Der Papierkorb lehnt ab, wenn darunter Seiten liegen, die sie nicht bearbeiten darf. Die Startseite eines Spaces lässt sich nicht löschen.
- **Wiederherstellen aus dem Papierkorb** holt genau die Seiten zurück, die gemeinsam gelöscht wurden (`trash_root_id`).
- **Seiten im Papierkorb** bleiben für Leser lesbar (für die Papierkorb-Ansicht). Seitenbaum, Suche und Verlinkungen filtern `deleted_at IS NULL`, der Worker entfernt sie bei `page.trashed` aus `page_search`.
- **Position** im Baum kommt aus der App (npm-Paket `fractional-indexing`). Ohne Angabe hängt `app.create_page` die Seite hinter alle Geschwister, auch die für die Person unsichtbaren (`app.next_position`, gleiche Schlüssel wie `generateKeyBetween(letzte, null)`, gegen das Paket geprüft). Ein `CHECK` lässt nur gültige Schlüssel zu. Positionen sind unter Geschwistern nicht eindeutig, weil die App eingeschränkte Geschwister nicht sieht: immer `ORDER BY position, id`. Die Datenbank sortiert byteweise (`C.UTF-8`).
- **Personen aus Zitadel** sind pro Mandant eindeutig (`tenant_id, idp_subject`), nicht global. So kann dieselbe Person (Gast, Dienstleister) in mehreren Mandanten ein Konto haben. Die API sucht beim Login nach Mandant und `idp_subject`.
- **Neue Seiten** bekommen einen leeren Yjs-Zustand (`\x0000`).
- **Löschen:** Bearbeitende legen Seiten in den Papierkorb, endgültig löscht nur der Worker (nach 30 Tagen). Eine Funktion für sofortiges endgültiges Löschen gibt es bewusst nicht.
- **Leistung:** Die Leseregel auf `pages` ruft `app.page_rank` pro Zeile auf. Für große Bäume später eine vom Worker gepflegte Tabelle mit effektiven Rechten pro Person und Seite; gemessen in `ARCHITECTURE_REVIEW.md`, A-01 (10.000 Seiten: 2–3 s). Die Rechtequelle findet `page_rank` über die IDs im Pfad (Primärschlüssel), nicht über `path @>`.
- **Textspalten** sind `text` mit `CHECK`-Grenzen (Titel 255, Kommentar 10.000 Zeichen, Yjs 50 MB pro Seite).

## 9. UI-Entwurf

Ein klickbarer Prototyp liegt unter `prototype/` (`pages/Main.dc.html`: Seitenbaum, Seite mit Kommentaren, Rechte-Dialog; `import/Import.dc.html`: Import-Assistent in drei Schritten). Er nutzt dasselbe Designsystem wie TalkFieber (IBM Plex Sans/Mono, Seitenleiste `#0F2537`, Akzent `#1F5FD6`, Aufmerksamkeit `#C2410C`, Erledigt-Grün `#E3F1E8`/`#1E5135`), damit beide Produkte wie eine Familie wirken.

- **Seitenleiste:** Space-Umschalter oben, darunter der Eintrag „Startseite“ und der Seitenbaum (wie in Confluence ohne die Startseite selbst, er beginnt mit ihren Unterseiten), mit Ausklappen, Drag & Drop und „Neue Seite“. Unten Papierkorb und „Daten gehostet in der EU“.
- **Kopfbereich:** Brotkrume, Bearbeitende als Avatare (Anwesenheit), Schloss-Symbol bei eingeschränkten Seiten, Buttons „Teilen und Rechte“, „Versionen“, „Exportieren“.
- **Seite:** Titel groß, darunter der BlockNote-Editor. Kommentare in einer rechten Spalte, an der Textstelle markiert.
- **Rechte-Dialog:** „Erbt Rechte von …“ mit Schalter „Eigene Rechte für diese Seite“. Danach Personen, Gruppen und „Alle im Workspace“ mit Rolle.
- **Import-Assistent:** Export hochladen, Probelauf mit Bericht (übernommen, Platzhalter, übersprungen), dann echter Import.

## 10. Tech-Stack

| Baustein | Wahl | Lizenz |
|---|---|---|
| Frontend | Next.js (App Router), React, TanStack Query | MIT |
| Editor | BlockNote (Core, ohne XL-Pakete) | MPL-2.0 |
| Echtzeit | Yjs, Hocuspocus (`@hocuspocus/server`) | MIT |
| API | Node.js, Express 5, Zod, Drizzle ORM | MIT |
| Jobs | pg-boss (Queue in PostgreSQL) | MIT |
| Datenbank | PostgreSQL 18 mit ltree und pg_trgm, CloudNativePG | PostgreSQL / Apache-2.0 |
| Login | Zitadel (unverändert genutzt, nur über OIDC angebunden) | AGPL-3.0 |
| Dateien | Garage (S3-kompatibel) | AGPL-3.0 |
| Betrieb | K3s, Traefik, cert-manager | Apache-2.0 |
| Später | NATS JetStream und Valkey (kommen mit TalkFieber), OpenSearch | Apache-2.0 / BSD |

## 11. Startsetup (K3s auf dem Hostinger-VPS, gemeinsam mit TalkFieber)

**Stufen wie bei TalkFieber:** Entwicklung lokal (Node direkt, PostgreSQL und Zitadel per Docker Compose oder k3d mit denselben Manifesten), dann Demo und Pilot auf dem eigenen VPS mit den Namespaces `staging` und `pilot`, vor dem ersten zahlenden Geschäftskunden Umzug zu einem zertifizierten EU-Anbieter (Hetzner, STACKIT, IONOS).

**Ein Cluster für die Produktfamilie.** Der VPS ist **ausschließlich für das Wiki und später TalkFieber** da, keine anderen Anwendungen. Weil das Wiki zuerst kommt, wird der VPS (KVM 4, 16 GB) mit dem Wiki-Pilot gemietet.

**Bausteine im Cluster:**

| Baustein | Umsetzung | Gemeinsam mit TalkFieber | RAM ca. |
|---|---|---|---|
| K3s inkl. Traefik | Standardinstallation | ja | 0,5–1 GB |
| PostgreSQL 18 | CloudNativePG, Datenbanken `wiki`, `chat`, `zitadel` | ja | 1–2 GB |
| Login | Zitadel | ja | 0,3–0,5 GB |
| Dateien | Garage, Buckets `wiki` und `chat` | ja | 0,1–0,3 GB |
| TLS | cert-manager mit Let's Encrypt | ja | gering |
| Wiki-Frontend | Next.js standalone | nein | 0,2–0,4 GB |
| Wiki-API und Worker | ein Image, zwei Deployments | nein | 0,3–0,5 GB |
| Collab-Server | Hocuspocus, genau eine Replik, Strategie Recreate | nein | 0,2–0,5 GB |
| Später | NATS, Valkey (mit TalkFieber) | ja | 0,2–0,5 GB |

Wiki allein etwa 3–4 GB, mit TalkFieber etwa 5–8 GB. KVM 4 mit 16 GB reicht für beide.

**Ingress:** `wiki.<domain>` mit `/` → web, `/api` → api, `/collab` → collab (WebSocket über Traefik). `auth.<domain>` → Zitadel.

**Pflichtpunkte (wie TalkFieber):**
- **Backups außerhalb des Servers:** CloudNativePG archiviert laufend (WAL plus tägliche Basis-Backups) zu einem S3-Speicher bei einem anderen Anbieter, z. B. Hetzner Object Storage. Garage-Buckets ebenfalls dorthin. Wiederherstellung regelmäßig testen.
- **Absicherung:** nach außen nur 80, 443 und SSH mit Schlüssel. Kubernetes-API, PostgreSQL und Garage nur im Cluster. Secrets mit SOPS oder Sealed Secrets.
- **Rollen:** Die API verbindet sich als Login-Rolle in `wiki_app`, Collab-Server und Worker als Login-Rollen in `wiki_worker`, nie als Eigentümer. Der von CloudNativePG angelegte Datenbank-Eigentümer führt nur Migrationen aus, und zwar in einem eigenen Kubernetes-Job vor dem Ausrollen, nie beim Start der App.
- **Ausfallpunkt:** Ein Server heißt kurze Ausfälle bei Updates. Gegenüber Pilotkunden offen sagen.

## 12. Zusammenspiel mit TalkFieber

| Baustein | Gemeinsam | Pro Produkt getrennt |
|---|---|---|
| Login | eine Zitadel-Instanz, eine Organisation pro Kunde, Single Sign-on | eigene OIDC-Clients und Rollen |
| Mandanten | gleiche `tenant_id` (über `idp_org_id`), gleiche RLS-Konvention (App- und Worker-Rolle) | eigene Datenbank im selben Cluster |
| Dateien | eine Garage-Instanz | eigener Bucket |
| Flüchtige Daten | Valkey (sobald da) | eigenes Schlüssel-Präfix |
| Events | NATS JetStream (kommt mit TalkFieber) | eigene Subjects: `t.{tenant}.wiki.*` bzw. `t.{tenant}.c.*` |
| Oberfläche | Designsystem, Avatare | eigene Apps und Domains |

**Integrationen, sobald TalkFieber läuft (Epic E26):** Wiki-Links im Chat mit Vorschau (gegen Wiki-Rechte geprüft), Benachrichtigungen aus dem Wiki als Nachricht im Chat, „Über diese Seite sprechen“ (Seite ↔ Topic), „Topic als Seite sichern“ (Entscheidungsprotokoll), später gemeinsame Suche.

**Jetzt schon vorbereitet:** `tenant_id` überall, Zitadel-Organisationen als Mandanten (`app.create_tenant(…, p_tenant_id)` übernimmt eine bestehende ID), Events in der `outbox`, auch wenn sie anfangs nur der eigene Worker abholt.

## 13. Nächste Schritte

Meilensteine und Übergangskriterien stehen in der `docs/ROADMAP.md`.

1. ~~`schema.sql`~~ **erledigt:** Das Schema liegt unter `database/scripts/schema`, die Tests unter `database/scripts/schema_test`. `schema.sql` bindet die Teile in fester Reihenfolge in einer Transaktion ein (`\ir`, nur mit `psql`): `00_setup`, `10_tables`, `20_functions_base`, `30_triggers`, `40_functions_tenants`, `50_functions_spaces`, `60_functions_pages`, `70_functions_content`, `72_functions_comments`, `74_functions_import`, `80_rls`, `90_privileges`. Neue Objekte kommen in den passenden Teil; ein neuer Teil braucht eine `\ir`-Zeile in `schema.sql` an der richtigen Stelle (SQL-Funktionen, Trigger und Regeln brauchen beim Anlegen die Objekte aus früheren Teilen). Die Teile nie einzeln einspielen. **Migrationen** (seit 8. November 2026): Jede Änderung kommt in den Teil in `schema/` **und** als neue Datei `database/scripts/migrations/NNNN_beschreibung.sql` (reines SQL, ohne `BEGIN`/`COMMIT` und psql-Befehle, Funktionen mit genau dem Text aus `schema/`, neue Spalten in `schema/` ans Tabellenende). `migrate.sh` spielt fehlende Migrationen als `wiki_owner` ein, je eine Transaktion, Buchführung in `migrations.applied` mit Prüfsumme; eingespielte Migrationen nie ändern, nur vorwärts, jede eine Version rückwärtskompatibel. Kein Migrationswerkzeug wie dbmate: psql reicht, `wiki_owner` braucht im Container kein Passwort, und Rückwärts-Migrationen sind nicht vorgesehen. Alle 55 Tests sind auf PostgreSQL 18.6 bestanden (Docker-Image `postgres:18.6`). `schema_test.sql` bindet die Testteile genauso ein, läuft in einer Transaktion und rollt am Ende zurück, ist also beliebig oft wiederholbar. Gleichzeitige Sitzungen (Sperren im Seitenbaum, gegenseitiges Entfernen von Admins) prüft `schema_concurrency_test.sh` mit einem eigenen Mandanten, den es am Ende wieder löscht, z. B. `PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" bash database/scripts/schema_test/schema_concurrency_test.sh`. Regeln für die Arbeit damit:
   - `database/scripts/roles_database.sql` legt die Rollen und die Datenbank `wiki` an. Das Schema spielt `wiki_owner` ein, nie `postgres`, sonst laufen die `SECURITY DEFINER`-Funktionen als Superuser.
   - Die API verbindet sich als `wiki_app`, Collab-Server und Worker als `wiki_worker`, **nie als Eigentümer** (der umgeht RLS).
   - Pro Transaktion `app.tenant_id` und bei `wiki_app` zusätzlich `app.user_id` setzen.
   - Schreibende Abläufe über die Funktionen im Schema `app` (`create_space`, `update_space`, `archive_space`, `create_page`, `move_page`, `trash_page`, `set_grant`, `set_page_inheritance`, `add_workspace_member`, `set_workspace_member_role`, `remove_workspace_member`, `set_user_role`, `set_user_active`, `create_group`, `add_group_member`, `remove_group_member`, `add_comment`, `edit_comment`, `store_ydoc`, `store_derived`, `create_version` usw.). Direkte INSERTs scheitern für `wiki_app` an fehlenden Rechten.
   - Neue `SECURITY DEFINER`-Funktionen: Mandant in jeder Abfrage prüfen (RLS greift dort nicht), zuerst `require_actor` bzw. `require_page`/`require_space`, nie `require_worker` (dort ist `current_user` der Eigentümer).
   - Wie bei TalkFieber: bei Tabellen mit Leseregeln kein `INSERT … RETURNING` und kein `ON CONFLICT`, solange die neue Zeile für die Person noch nicht lesbar ist (z. B. ein Space vor seinem ersten Grant). IDs vorher mit `uuidv7()` erzeugen.
   - Alles, was Rechte oder Sichtbarkeit berührt, bekommt zuerst einen Test in `database/scripts/schema_test/`: hinten an den passenden Teil oder als neuer Teil am Ende (mit `\ir`-Zeile in `schema_test.sql`), Nummern fortlaufend. Die Teile bauen aufeinander auf (gemeinsame Testdaten, Kopf jedes Teils: „Nutzt“ und „Legt an“) und laufen nur über `schema_test.sql`. Die Tests laufen als `wiki_app` bzw. `wiki_worker`.
2. Repository und Grundgerüst: ~~Monorepo mit Next.js-Frontend, Express-API mit Worker, Hocuspocus~~ **Grundgerüst erledigt** (8. November 2026): Die Apps starten, prüfen ihre Datenbankrolle, die API antwortet unter `/api/v1/health` und `/api/v1/tenants/:slug`. **Login erledigt** (8. November 2026): OIDC über Zitadel in der API, Sitzungen in `sessions`, `/api/v1/auth/login`, `/callback`, `/logout`, `/me`, geprüft mit `scripts/check-login.mjs`. **Spaces und Seitenbaum erledigt** (8. November 2026): API, Seitenleiste mit Baum, Verschieben per Knopf, Papierkorb, API-Tests gegen die Datenbank; damit ist das Gate von M0 lokal erreicht. **Einladungen erledigt** (8. November 2026): Link in einen Workspace, Annehmen beim Login (`apps/api/src/auth/accounts.ts`, `routes/invites.ts`), Seite `/invite/<token>`; damit ist M0 vollständig. Offen: Gruppen per API (verschoben nach M3, mit dem Rechte-Dialog), Drag & Drop (M2), Hocuspocus mit `onAuthenticate`, `onLoadDocument`, `onStoreDocument` gegen diese Datenbank, Aufgaben im Worker.
3. ~~Lokale Umgebung mit Docker Compose~~ **erledigt:** PostgreSQL, Garage und Zitadel in `compose.yaml`, alle richten sich beim ersten Start selbst ein (`docs/LOCAL_SETUP.md`). Anmeldung per PKCE mit Testperson, Person und Mandant im Token sowie Introspection über `notefieber-api` sind mit Zitadel v4.20.1 geprüft. k3d erst für die K3s-Manifeste, die lokal und auf dem VPS gleich laufen.
4. **Echte Confluence-Exporte besorgen, wenn der Importer gebaut wird** (M4, 2–3 Pilotkunden). Zuerst die häufigsten Makros zählen.
5. Übrige offene Entscheidungen aus Abschnitt 4 klären, wenn sie anstehen (Name, Lizenz und SaaS vs. On-Prem sind vorerst entschieden).
