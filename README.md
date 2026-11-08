# NoteFieber – europäische Wiki-Plattform (Arbeitstitel)

Eine europäische Alternative zu Confluence, entwickelt und gehostet in der EU. Zielgruppe sind vor allem Organisationen auf Confluence Data Center, das am 28. März 2029 schreibgeschützt wird. Schwesterprojekt von **TalkFieber** (Team-Chat); beide teilen Login, Mandantenmodell und Cluster.

**Stand:** Planung abgeschlossen, Datenbankschema mit Tests fertig, UI-Prototyp vorhanden, noch kein Anwendungscode.

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
| `prototype/` | Klickbarer UI-Prototyp: Seitenansicht mit Rechte-Dialog, Confluence-Import |

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

Die App verbindet sich nie als `wiki_owner`, sondern mit Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Worker). Das Datenmodell beschreibt [docs/SCHEMA.md](docs/SCHEMA.md), die Entscheidungen stehen in `CLAUDE.md`.

## Projektstruktur (geplant)

```
apps/
  web/        Next.js-Frontend (nur Oberfläche)
  api/        Express-API
  collab/     Hocuspocus-Server
  worker/     Suchindex, Versionen, Import, Export, Outbox
packages/
  shared/     Typen, Zod-Schemas, Rechte-Konstanten
database/
  scripts/    Rollen, Schema (schema/), Migrationen (migrations/), Tests (schema_test/)
deploy/
  k8s/        Manifeste bzw. Kustomize, später Helm-Chart
docs/
  models/     Diagramme
prototype/    UI-Prototyp (Referenz, kein Produktcode)
```
