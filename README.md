# NoteFieber – europäische Wiki-Plattform (Arbeitstitel)

Eine europäische **Open-Source**-Alternative zu Confluence (AGPL-3.0), entwickelt und gehostet in der EU. Zielgruppe sind vor allem Organisationen auf Confluence Data Center, das am 28. März 2029 schreibgeschützt wird. Schwesterprojekt von **TalkFieber** (Team-Chat); beide teilen Login, Mandantenmodell und Cluster.

**Stand:** Meilenstein M0 abgeschlossen: Datenbankschema mit Migrationen und Tests, lokale Umgebung und CI, Login über Zitadel, Spaces und Seitenbaum, Einladungen. M1 abgeschlossen: Editor mit gemeinsamem Bearbeiten (BlockNote, Collab-Server, Worker für abgeleiteten Inhalt und Suchindex); Rechte, Papierkorb und Abmelden wirken sofort auch auf offene Editoren; Umbenennen geht auch aus der Seitenleiste, und Änderungen aus einem Funkloch überstehen ein Neuladen (lokale Kopie in IndexedDB); der erste Lasttest (50 gleichzeitig Bearbeitende) lief ohne Datenverlust. Damit ist M1 lokal abgeschlossen. M2 begonnen: Der Seitenbaum lädt Ebene für Ebene (auch bei 10.000 Seiten schnell), Seiten lassen sich per Drag & Drop verschieben, Spaces umbenennen und archivieren; der Editor hat Überschriften, Listen, Tabellen, Code mit Hervorhebung, Callouts, Bilder (in Garage, über die API), Seitenlinks, die nach Umbenennen und Verschieben gültig bleiben, Erwähnungen von Personen und ein Inhaltsverzeichnis. Was sich schon klicken lässt, steht in [docs/USE_CASES.md](docs/USE_CASES.md). UI-Prototyp vorhanden.

## Dokumente

| Datei | Inhalt |
|---|---|
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | **Für Neulinge zuerst lesen:** alle Kernkonzepte ausführlich erklärt |
| [docs/USE_CASES.md](docs/USE_CASES.md) | Was sich in der Oberfläche schon durchklicken lässt, mit Testpersonen zum Ausprobieren |
| [docs/MVP.md](docs/MVP.md) | Architektur und Umfang des MVP auf einen Blick (Momentaufnahme vom 5. November 2026) |
| [CLAUDE.md](CLAUDE.md) | Entscheidungen und aktueller Stand, Übergabe für Claude Code; Regeln fürs Vibe Coding in Abschnitt 14 |
| [SECURITY.md](SECURITY.md) | Sicherheitslücken vertraulich melden |
| [TODOS.md](docs/TODOS.md) | Offene Punkte aus der letzten Konsistenzprüfung |
| [REVIEW_M0.md](docs/reviews/REVIEW_M0.md) | Review von Code und Dokumentation nach M0 (Momentaufnahme vom 12. November 2026), Befunde mit Beleg |
| [REVIEW_M1.md](docs/reviews/REVIEW_M1.md) | Review des Codes für M1 (Momentaufnahme vom 22. November 2026): Editor, Collab-Server, Worker |
| [ARCHITECTURE_REVIEW.md](docs/reviews/ARCHITECTURE_REVIEW.md) | Review der Architektur (Momentaufnahme vom 14. November 2026): Risiken für M1 bis M5, mit Messung des Rechtemodells |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Offene Fragen: Themen, die in EPICS und ROADMAP noch fehlen |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Stufen 0–4, Meilensteine M0–M5, Kriterien für den nächsten Schritt |
| [docs/EPICS.md](docs/EPICS.md) | Epics E01–E31 als Grundlage für User Stories |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Referenz zum Datenmodell: jede Tabelle, Regel und Funktion |
| [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | Lokale Entwicklung: Voraussetzungen, PostgreSQL 18 mit Schema, Tests und Testdaten, Garage (Dateien), Zitadel (Login) |
| `docs/models/` | ER-Diagramm (Mermaid, exportiert als SVG) und Architekturdiagramme (Startsetup, Zielarchitektur) |
| `database/scripts/` | Rollen, Schema (`schema/`), Migrationen (`migrations/`, eingespielt mit `migrate.sh`), Tests (`schema_test/`), Testdaten (`seed/`) und Abfragen zum Nachsehen (`queries/`) |
| `compose.yaml`, `docker/` | Lokale Umgebung: PostgreSQL, Garage und Zitadel, richten sich beim ersten Start selbst ein |
| `.gitlab-ci.yml`, `.github/` | CI auf GitLab mit fünf Jobs: `database` (`ci.sh`), `apps` (`pnpm check`), `api` (API-Tests gegen eine Wegwerf-Datenbank), `secrets` (gitleaks), `audit` (`pnpm audit`); GitHub spiegelt jeden Branch dorthin, Dependabot schlägt Updates vor |
| `apps/`, `packages/` | Die Apps im pnpm-Monorepo: Frontend, API mit Worker, Collab-Server, gemeinsame Pakete ([LOCAL_SETUP, Abschnitt 7](docs/LOCAL_SETUP.md#7-apps-nodejs)) |
| `prototype/` | Klickbarer UI-Prototyp: Seitenansicht mit Rechte-Dialog, Confluence-Import |
| [LICENSE](LICENSE) | GNU Affero General Public License v3.0 (`AGPL-3.0-only`) |

## Stack in einem Satz

TypeScript durchgängig: Next.js als Oberfläche, BlockNote als Editor, Yjs mit Hocuspocus für gemeinsames Bearbeiten, Express als API, PostgreSQL 18 über CloudNativePG, Zitadel für den Login, Garage für Dateien, alles auf K3s.

## Lokal entwickeln

Was man braucht und wie man PostgreSQL 18 (Schema, Tests, Testdaten), Garage (Dateien) und Zitadel (Login) aufsetzt, steht in [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Kurzfassung mit Docker (richtet beim ersten Start Rollen, Schema, Testdaten, den Bucket `wiki` und die Testpersonen in Zitadel selbst ein; Login unter `http://localhost:8080`):

```bash
docker compose up -d --wait
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/schema_test/schema_test.sql
```

Für ein vorhandenes PostgreSQL 18 ohne Docker:

```bash
psql -U postgres -f database/scripts/roles_database.sql
PSQL="psql -U wiki_owner -d wiki" bash database/scripts/migrate.sh
psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f database/scripts/schema_test/schema_test.sql
# Erwartet: OK 1 … OK 49, dann "Alle Tests bestanden (zurückgerollt …)."
psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f database/scripts/seed/seed.sql
# Optional: Testdaten (Alpenwerk mit Peter, Lukas, Max …), siehe docs/LOCAL_SETUP.md Abschnitt 4 („Testdaten“)
```

Dann die Apps (Node.js 24, pnpm über corepack; Einzelheiten in [docs/LOCAL_SETUP.md, Abschnitt 7](docs/LOCAL_SETUP.md#7-apps-nodejs)):

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:api        # und in weiteren Terminals: pnpm dev:web (Anmelden unter http://localhost:3000), pnpm dev:worker, pnpm dev:collab
pnpm check          # Lint, Formatierung, Typen, Tests, Lizenzen, fremde Hinweise, Build (wie in der CI)
```

Die App verbindet sich nie als `wiki_owner`, sondern mit Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Worker). Das Datenmodell beschreibt [docs/SCHEMA.md](docs/SCHEMA.md), die Entscheidungen stehen in `CLAUDE.md`.

## Repository und CI

Gearbeitet wird im Repository auf **GitHub** (`github.com/peterforster10/notefieber`). Das Repository ist öffentlich. Bei jedem Push spiegelt die GitHub Action [`.github/workflows/sync-to-gitlab.yml`](.github/workflows/sync-to-gitlab.yml) den Branch nach **GitLab** (`gitlab.com/peterforster101/notefieber`). Dort läuft die **CI** ([`.gitlab-ci.yml`](.gitlab-ci.yml)) mit fünf Jobs: alle Datenbanktests ([`ci.sh`](database/scripts/schema_test/ci.sh)), `pnpm check` für die Apps (mit Lizenzprüfung), die Tests von API, Worker und Collab-Server gegen eine Wegwerf-Datenbank (`pnpm test:db`), Secret-Scanning mit gitleaks und bekannte Sicherheitslücken der Abhängigkeiten (`pnpm audit`). **Rote Pipeline = kein Merge.**

- GitLab ist nur ein Spiegel: dort nichts direkt committen, sonst bricht der nächste Sync ab (er pusht ohne `--force`).
- Gespiegelt werden alle Branches und Tags (`main` und Tags ohne `--force`), gelöschte Branches löscht der Workflow auch auf GitLab. So bekommt jede Änderung vor dem Merge ihre Pipeline.
- Der Sync braucht in GitHub das Secret `GITLAB_TOKEN` (Project Access Token mit `write_repository`), als Actions-Secret und als Dependabot-Secret.
- [Dependabot](.github/dependabot.yml) schlägt Updates der Abhängigkeiten als Pull Request vor; sie laufen durch dieselbe Pipeline.
- Niemals echte Kundendaten oder Secrets einchecken ([CLAUDE.md](CLAUDE.md), Abschnitt 14); Sicherheitslücken vertraulich melden ([SECURITY.md](SECURITY.md)).

Einzelheiten, Fehlerbilder und wie man `ci.sh` lokal laufen lässt: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md), Abschnitt „CI (GitLab)“.

## Projektstruktur

```
apps/
  web/        Next.js-Frontend (nur Oberfläche)
  api/        Express-API und Worker (ein Paket, zwei Einstiegspunkte: src/api.ts, src/worker.ts)
  collab/     Hocuspocus-Server
packages/
  shared/     Typen, Zod-Schemas, Rollen, Ereignisse
  editor-schema/  BlockNote-Schema (Blöcke, Callout, Seitenlink, Erwähnung, Inhaltsverzeichnis), Aufbau des Yjs-Dokuments, Umwandlung Yjs ↔ BlockNote-JSON
scripts/      Hilfsskripte (Lizenzprüfung, fremde Lizenzhinweise, Login prüfen)
database/
  scripts/    Rollen, Schema (schema/), Migrationen (migrations/), Tests (schema_test/)
deploy/       (geplant)
  k8s/        Manifeste bzw. Kustomize, später Helm-Chart
docs/
  models/     Diagramme
prototype/    UI-Prototyp (Referenz, kein Produktcode)
```

## Lizenz

Copyright (C) 2026 Peter Forster

NoteFieber ist freie Software: Du kannst es unter den Bedingungen der **GNU Affero General Public License, Version 3** (`AGPL-3.0-only`), wie von der Free Software Foundation veröffentlicht, weitergeben und verändern. Wer eine veränderte Fassung als Dienst über ein Netzwerk anbietet, muss deren Quelltext den Nutzenden zugänglich machen. NoteFieber wird ohne jede Gewährleistung bereitgestellt. Den vollständigen Text enthält [LICENSE](LICENSE).

Bestandteile Dritter (Bibliotheken aus npm, Docker-Images, Zitadel, Garage) stehen unter ihren eigenen Lizenzen. Eingebunden werden nur Abhängigkeiten mit Lizenzen, die mit der AGPL-3.0 verträglich sind ([`scripts/check-licenses.mjs`](scripts/check-licenses.mjs), in der CI).

Beiträge von außen nimmt das Projekt vorerst nicht an: Ob dafür ein CLA oder ein DCO gilt, ist noch offen ([CLAUDE.md](CLAUDE.md), Abschnitt 4).
