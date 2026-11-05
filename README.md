# NoteFieber – europäische Wiki-Plattform (Arbeitstitel)

Eine europäische Alternative zu Confluence, entwickelt und gehostet in der EU. Zielgruppe sind vor allem Organisationen auf Confluence Data Center, das am 28. März 2029 schreibgeschützt wird. Schwesterprojekt von **TalkFieber** (Team-Chat); beide teilen Login, Mandantenmodell und Cluster.

**Stand:** Planung abgeschlossen, Datenbankschema mit Tests fertig, UI-Prototyp vorhanden, noch kein Anwendungscode.

## Dokumente

| Datei | Inhalt |
|---|---|
| [docs/CONCEPTS.md](docs/CONCEPTS.md) | **Für Neulinge zuerst lesen:** alle Kernkonzepte ausführlich erklärt |
| [docs/MVP.md](docs/MVP.md) | Architektur und Umfang des MVP auf einen Blick (auch als PDF) |
| [CLAUDE.md](CLAUDE.md) | Entscheidungen und aktueller Stand, Übergabe für Claude Code |
| [TODOS.md](TODOS.md) | Offene Punkte aus der letzten Konsistenzprüfung |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Stufen 0–4, Meilensteine M0–M5, Kriterien für den nächsten Schritt |
| [docs/EPICS.md](docs/EPICS.md) | Epics E01–E31 als Grundlage für User Stories |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Referenz zum Datenmodell: jede Tabelle, Regel und Funktion |
| [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) | Lokale Entwicklung: Voraussetzungen, PostgreSQL 18, Schema, Tests |
| `docs/models/` | ER-Diagramm (Mermaid, PlantUML, draw.io) und Architekturdiagramme (Startsetup, Zielarchitektur) |
| `database/scripts/` | Rollen, Schema (`schema/`) und Tests (`schema_test/`) |
| `prototype/` | Klickbarer UI-Prototyp: Seitenansicht mit Rechte-Dialog, Confluence-Import |

## Stack in einem Satz

TypeScript durchgängig: Next.js als Oberfläche, BlockNote als Editor, Yjs mit Hocuspocus für gemeinsames Bearbeiten, Express als API, PostgreSQL 18 über CloudNativePG, Zitadel für den Login, Garage für Dateien, alles auf K3s.

## Lokal entwickeln

Was man braucht und wie man PostgreSQL 18 mit Schema und Tests aufsetzt, steht in [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). Kurzfassung für ein vorhandenes PostgreSQL 18 (die Variante mit Docker steht in der Anleitung):

```bash
psql -U postgres -f database/scripts/roles_database.sql
psql -U wiki_owner -d wiki -f database/scripts/schema/schema.sql
psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f database/scripts/schema_test/schema_test.sql
# Erwartet: OK 1 … OK 44, dann "Alle Tests bestanden (zurückgerollt …)."
psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f database/scripts/seed/seed.sql
# Optional: Testdaten (Alpenwerk mit Anna, Lukas, Max …), siehe docs/LOCAL_SETUP.md Abschnitt 6
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
  scripts/    Rollen, Schema (schema/), Tests (schema_test/)
deploy/
  k8s/        Manifeste bzw. Kustomize, später Helm-Chart
docs/
  adr/        Entscheidungsnotizen
  models/     Diagramme
prototype/    UI-Prototyp (Referenz, kein Produktcode)
```
