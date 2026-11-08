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
Epics: E01 (lokal), E02, E03 (einfach)
- [ ] Repository mit Lizenz, `CLAUDE.md`, `docs/EPICS.md`, `docs/ROADMAP.md`
- [x] Lokale Umgebung mit PostgreSQL 18, Zitadel, Garage (alle per `compose.yaml`, siehe [LOCAL_SETUP](LOCAL_SETUP.md))
- [x] Migrationen: eigenes Skript `migrate.sh` (psql) statt eines Werkzeugs, das Schema als erste Migration (`0001_initial_schema.sql`, gebündelt mit `schema/bundle.sh`), Gleichheit von `schema/` und Migrationen geprüft (`schema_migrations_test.sh`)
- [ ] Tests der Datenbank in der CI: `schema_test.sql`, `schema_concurrency_test.sh`, `schema_migrations_test.sh` (eingespielt als `wiki_owner`, nie als `postgres`)
- [ ] CI: Build, Tests, Prüfung der Abhängigkeiten und Lizenzen (keine BlockNote-XL-Pakete)
- [ ] Login per OIDC über Zitadel (Mandant und Person aus dem Token), Gruppen im Wiki pflegen
- [ ] Space anlegen, Seitenbaum per API

**Gate:** Login über Zitadel, Seite anlegen, im Baum verschieben.

### M1 – Durchstich Editor und Echtzeit
Epics: E04, Teile von E06 und E07
- [ ] Next.js-Grundgerüst, BlockNote als Client-Komponente
- [ ] Hocuspocus mit `onAuthenticate` (Rolle über die API), `onLoadDocument`, `onStoreDocument` (`app.store_content`)
- [ ] Zwei Browser bearbeiten dieselbe Seite, Cursor und Anwesenheit sichtbar
- [ ] Verbindung trennen und wieder verbinden: nichts geht verloren
- [ ] Erster Lasttest (z. B. 50 gleichzeitige Bearbeitende auf einer Seite)
- [ ] Einen echten Confluence-Export grob einlesen, nur um die Datenlage zu verstehen

**Gate:** Zwei Personen bearbeiten gleichzeitig, nichts geht verloren.

### M2 – Wiki-Grundfunktionen
Epics: E05, E06, E07, E08, E15
- [ ] Spaces mit Startseite, Seitenbaum mit Drag & Drop
- [ ] Blöcke: Überschriften, Listen, Tabellen, Code, Bilder, Callouts, Seitenlinks
- [ ] Versionen anzeigen, vergleichen, wiederherstellen; Papierkorb
- [ ] Web-Client nach UI-Entwurf
- [ ] **Ab hier selbst nutzen**, z. B. für die eigene Projektdokumentation

### M3 – Rechte, Suche, Kommentare (MVP ohne Import)
Epics: E09, E10, E11, E12, E14
- [ ] Rollen und Vererbung, Vererbung kappen, Gruppen, „Alle im Workspace“
- [ ] „Ansehen als …“ für Space-Admins (Prüfwerkzeug für den Import)
- [ ] Kommentare an Textstellen und Seiten
- [ ] Dateien mit Virenscan und Vorschau
- [ ] Volltextsuche, Rechte in jedem Lesepfad
- [ ] Export als Markdown + Anhänge (ZIP)
- [ ] Audit-Log

**Gate:** Kein Lesepfad (Baum, Suche, Links, Kommentare, Export, Dateien) zeigt Seiten ohne Leserecht. Durch Tests abgesichert.

### M4 – Confluence-Import
Epic: E13
- [ ] 2–3 echte Confluence-Space-Exporte besorgen (anonymisiert reicht), zu Beginn von M4, und die häufigsten Makros zählen
- [ ] Space-Export (HTML bzw. XML) einlesen: Hierarchie, Inhalte, Anhänge, Versionen
- [ ] Rechte übersetzen, Gruppen zuordnen
- [ ] Die häufigsten Makros abbilden (aus den echten Exporten gezählt), Rest als sichtbarer Platzhalter mit Originalinhalt
- [ ] Probelauf mit Bericht, echter Import, Import rückgängig machen
- [ ] Interne Links umschreiben

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
- [ ] Überwachung mit Alarm bei Ausfall, vollem Speicher, fehlgeschlagenem Backup und zu großen Yjs-Dokumenten
- [ ] Produktnamen festlegen, **EU-Marke anmelden** (Klassen 9, 38, 42), bevor du öffentlich auftrittst
- [ ] Datenschutzerklärung und Nutzungsbedingungen für die Pilotphase
- [ ] 2–3 Pilotkunden, die mit ihrem importierten Space arbeiten, mit regelmäßigem Feedback
- [ ] Installations- und Admin-Doku

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
