# NoteFieber – europäische Wiki-Plattform (Arbeitstitel)

Eine europäische Alternative zu Confluence, entwickelt und gehostet in der EU. Zielgruppe sind vor allem Organisationen auf Confluence Data Center, das am 28. März 2029 schreibgeschützt wird. Schwesterprojekt von **TalkFieber** (Team-Chat); beide teilen Login, Mandantenmodell und Cluster.

**Stand:** Datenbankschema mit Migrationen und Tests fertig, lokale Umgebung und CI laufen, Grundgerüst der Apps (pnpm-Monorepo) steht, noch ohne Fachlogik. UI-Prototyp vorhanden.

## Dokumente

| Datei | Inhalt |
|---|---|
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | **Für Neulinge zuerst lesen:** alle Kernkonzepte ausführlich erklärt |
| [docs/MVP.md](docs/MVP.md) | Architektur und Umfang des MVP auf einen Blick (Momentaufnahme vom 5. November 2026) |
| [CLAUDE.md](CLAUDE.md) | Entscheidungen und aktueller Stand, Übergabe für Claude Code |
| [TODOS.md](TODOS.md) | Offene Punkte aus der letzten Konsistenzprüfung |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Stufen 0–4, Meilensteine M0–M5, Kriterien für den nächsten Schritt |
| [docs/EPICS.md](docs/EPICS.md) | Epics E01–E31 als Grundlage für User Stories |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Referenz zum Datenmodell: jede Tabelle, Regel und Funktion |
| [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | Lokale Entwicklung: Voraussetzungen, PostgreSQL 18 mit Schema, Tests und Testdaten, Garage (Dateien), Zitadel (Login) |
| `docs/models/` | ER-Diagramm (Mermaid, exportiert als SVG) und Architekturdiagramme (Startsetup, Zielarchitektur) |
| `database/scripts/` | Rollen, Schema (`schema/`), Migrationen (`migrations/`, eingespielt mit `migrate.sh`), Tests (`schema_test/`), Testdaten (`seed/`) und Abfragen zum Nachsehen (`queries/`) |
| `compose.yaml`, `docker/` | Lokale Umgebung: PostgreSQL, Garage und Zitadel, richten sich beim ersten Start selbst ein |
| `.gitlab-ci.yml`, `.github/workflows/` | CI auf GitLab (Datenbanktests mit `ci.sh`); GitHub spiegelt `main` dorthin |
| `apps/`, `packages/` | Die Apps im pnpm-Monorepo: Frontend, API mit Worker, Collab-Server, gemeinsames Paket ([LOCAL_SETUP, Abschnitt 7](docs/LOCAL_SETUP.md#7-apps-nodejs)) |
| `prototype/` | Klickbarer UI-Prototyp: Seitenansicht mit Rechte-Dialog, Confluence-Import |
| [LICENSE](LICENSE) | Proprietär, alle Rechte vorbehalten |

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
# Erwartet: OK 1 … OK 46, dann "Alle Tests bestanden (zurückgerollt …)."
psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f database/scripts/seed/seed.sql
# Optional: Testdaten (Alpenwerk mit Peter, Lukas, Max …), siehe docs/LOCAL_SETUP.md Abschnitt 4 („Testdaten“)
```

Dann die Apps (Node.js 24, pnpm über corepack; Einzelheiten in [docs/LOCAL_SETUP.md, Abschnitt 7](docs/LOCAL_SETUP.md#7-apps-nodejs)):

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:api        # und in weiteren Terminals: pnpm dev:worker, pnpm dev:collab, pnpm dev:web
pnpm check          # Lint, Formatierung, Typen, Lizenzen, Build (wie in der CI)
```

Die App verbindet sich nie als `wiki_owner`, sondern mit Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Worker). Das Datenmodell beschreibt [docs/SCHEMA.md](docs/SCHEMA.md), die Entscheidungen stehen in `CLAUDE.md`.

## Repository und CI

Gearbeitet wird im Repository auf **GitHub** (`github.com/peterforster10/notefieber`). Bei jedem Push auf `main` spiegelt die GitHub Action [`.github/workflows/sync-to-gitlab.yml`](.github/workflows/sync-to-gitlab.yml) den Stand nach **GitLab** (`gitlab.com/peterforster101/notefieber`). Dort läuft die **CI** ([`.gitlab-ci.yml`](.gitlab-ci.yml)), derzeit alle Datenbanktests ([`ci.sh`](database/scripts/schema_test/ci.sh)).

- GitLab ist nur ein Spiegel: dort nichts direkt committen, sonst bricht der nächste Sync ab (er pusht ohne `--force`).
- Gespiegelt wird nur `main`, Pipelines gibt es also nur für `main`.
- Der Sync braucht in GitHub das Secret `GITLAB_TOKEN` (Project Access Token mit `write_repository`).

Einzelheiten, Fehlerbilder und wie man `ci.sh` lokal laufen lässt: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md), Abschnitt „CI (GitLab)“.

## Projektstruktur

```
apps/
  web/        Next.js-Frontend (nur Oberfläche)
  api/        Express-API und Worker (ein Paket, zwei Einstiegspunkte: src/api.ts, src/worker.ts)
  collab/     Hocuspocus-Server
packages/
  shared/     Typen, Zod-Schemas, Rollen, Ereignisse
scripts/      Hilfsskripte (Lizenzprüfung)
database/
  scripts/    Rollen, Schema (schema/), Migrationen (migrations/), Tests (schema_test/)
deploy/       (geplant)
  k8s/        Manifeste bzw. Kustomize, später Helm-Chart
docs/
  models/     Diagramme
prototype/    UI-Prototyp (Referenz, kein Produktcode)
```
