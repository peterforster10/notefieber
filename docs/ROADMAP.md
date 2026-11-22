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

- [x] **Arbeitsvertrag prüfen** (gilt für beide Projekte): Klauseln zu Nebentätigkeit und Rechten an Software.
- [x] **Lizenz:** vorerst proprietär. Open Core oder Quelltext für Kunden bleiben spätere Optionen.
- [x] **Betrieb:** vorrangig SaaS, On-Prem (Helm-Chart, E23) später.
- [x] **Name:** vorerst NoteFieber (Arbeitstitel).
- [x] **Eigenbau statt Fork von La Suite Docs:** entschieden. BlockNote, Yjs und Hocuspocus als Bibliotheken.
- [x] **Stack festlegen:** entschieden, TypeScript mit Next.js, Express, BlockNote, Hocuspocus, PostgreSQL 18 (CloudNativePG), Zitadel, Garage, K3s.
- [ ] **5–10 Gespräche mit Confluence-Data-Center-Kunden:** Wann müssen sie entscheiden, was hält sie bei Confluence, welche Makros und Apps nutzen sie, SaaS oder on-prem, was würden sie zahlen?
- [ ] **XWiki und BlueSpice ausprobieren** (sobald echte Exporte da sind, M4): einen echten Export in beide importieren und notieren, wo es hakt. Diese Schwachstellen sind das eigene Produkt. In den Gesprächen fragen, ob die Kunden XWiki schon geprüft haben.
- [ ] **Codenamen und Domain sichern.** Über einen gemeinsamen Markennamen für Wiki und Chat nachdenken.

**Weiter, wenn** die Gespräche zeigen, dass der Wechsel von Confluence Data Center ein echter Bedarf ist .

---

## Stufe 1: Lokal entwickeln

Infrastruktur: eigener Rechner. Node direkt, PostgreSQL 18, Zitadel und Garage per Docker Compose oder k3d mit denselben Manifesten wie später auf dem Server.

### M0 – Fundament
Epics: E01 (lokal), E02 (ohne Gruppenpflege, die kommt mit M3), E03 (einfach), vorgezogen Teile von E05 und E06 (Spaces anlegen, Seitenbaum)
- [x] Repository mit Lizenz (proprietär, `LICENSE`), `CLAUDE.md`, `docs/EPICS.md`, `docs/ROADMAP.md`
- [x] Grundgerüst der Apps als pnpm-Monorepo: `apps/web`, `apps/api` (mit Worker), `apps/collab`, `packages/shared`; eigene Login-Rollen pro App
- [x] Lokale Umgebung mit PostgreSQL 18, Zitadel, Garage (alle per `compose.yaml`, siehe [LOCAL_SETUP](LOCAL_SETUP.md))
- [x] Migrationen: eigenes Skript `migrate.sh` (psql) statt eines Werkzeugs, das Schema als erste Migration (`0001_initial_schema.sql`, gebündelt mit `schema/bundle.sh`), Gleichheit von `schema/` und Migrationen geprüft (`schema_migrations_test.sh`)
- [x] Sync GitHub → GitLab: `.github/workflows/sync-to-gitlab.yml` spiegelt jeden Push auf `main`
- [x] Tests der Datenbank in der CI auf GitLab: `.gitlab-ci.yml` mit `ci.sh` (`schema_test.sql`, `schema_concurrency_test.sh`, `schema_migrations_test.sh`, eingespielt als `wiki_owner`, nie als `postgres`). Erste Pipeline am 8. November 2026 grün
- [x] CI auf GitLab für die Apps: Job `apps` mit `pnpm check` (Lint, Formatierung, Typen, Lizenzen ohne BlockNote-XL-Pakete, Build)., dazu Job `api` mit den API-Tests gegen eine Wegwerf-Datenbank (`pnpm test:db`)
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
Epics: E05, E06, E07, E08, E15, dazu der Mail-Versand aus E01 und E02
- [ ] Spaces mit Startseite, Seitenbaum mit Drag & Drop; der Baum lädt ebenenweise statt aller Seiten auf einmal (A-01)
- [ ] Blöcke: Überschriften, Listen, Tabellen, Code, Bilder, Callouts, Seitenlinks
- [ ] Versionen anzeigen, vergleichen, wiederherstellen; Papierkorb
- [ ] Web-Client nach UI-Entwurf
- [ ] E-Mail-Versand lokal: Mailpit in `compose.yaml` (fängt alle Mails ab, Ansicht unter `http://localhost:8025`), SMTP über eine generische Einstellung (Nodemailer); Einladungsmail direkt aus der API beim Anlegen (das Token liegt nur im Speicher, der Link bleibt als Rückfall); Zitadel nutzt denselben SMTP-Server (Passwort vergessen, E-Mail bestätigen)
- [ ] **Ab hier selbst nutzen**, z. B. für die eigene Projektdokumentation

### M3 – Rechte, Suche, Kommentare (MVP ohne Import)
Epics: E09, E10, E11, E12, E14, dazu aus E02 die Gruppenpflege (aus M0 verschoben)
- [ ] Rollen und Vererbung, Vererbung kappen, Gruppen, „Alle im Workspace“
- [ ] Gruppen im Wiki pflegen: API und Oberfläche für Organisations-Admins (anlegen, umbenennen, Mitglieder). Aus M0 hierher verschoben; die Datenbank kann es schon, Rechte über Gruppen wirken bereits (Testdaten)
- [ ] „Ansehen als …“ für Space-Admins (Prüfwerkzeug für den Import)
- [ ] Kommentare an Textstellen und Seiten
- [ ] Dateien mit Virenscan und Vorschau
- [ ] Sichtbarkeit für Listen mengenbasiert (Seitenbaum, Suche, „Ansehen als …“, Rückverweise): Ränge pro Space und Person einmal berechnen statt `page_rank` pro Zeile, durch einen Test gegen `page_rank` abgesichert (A-01)
- [ ] Volltextsuche, Rechte in jedem Lesepfad; Deutsch und Englisch (zwei Sprachkonfigurationen oder `simple` mit Trigrammen, A-10)
- [ ] Export als Markdown + Anhänge (ZIP)
- [ ] Audit-Log

**Gate:** Kein Lesepfad (Baum, Suche, Links, Kommentare, Export, Dateien) zeigt Seiten ohne Leserecht. Durch Tests abgesichert. Ein Space mit 10.000 Seiten lädt seinen Seitenbaum in unter einer Sekunde (Lastprüfung, A-01).

### M4 – Confluence-Import
Epic: E13
- [ ] 2–3 echte Confluence-Space-Exporte besorgen (anonymisiert reicht), zu Beginn von M4, und die häufigsten Makros zählen
- [ ] Space-Export (HTML bzw. XML) einlesen: Hierarchie, Inhalte, Anhänge, Versionen
- [ ] Rechte übersetzen, Gruppen zuordnen
- [ ] Die häufigsten Makros abbilden (aus den echten Exporten gezählt), Rest als sichtbarer Platzhalter mit Originalinhalt
- [ ] Probelauf mit Bericht, echter Import, Import rückgängig machen
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
Epics: E01 (VPS), E22 (einfach)
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
| SSO voll (OIDC, SAML, Entra ID) | E03 |
| Benachrichtigungen, Beobachten, Erwähnungen | E16 |
| Gäste und Freigaben nach außen | E18 |
| Webhooks, REST-API, Einbettungen | E19 |
| Vorlagen und Seiteneigenschaften | E25 |
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
