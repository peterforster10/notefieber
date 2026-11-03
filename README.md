# NoteFieber – europäische Wiki-Plattform (Arbeitstitel)

Eine europäische Alternative zu Confluence, entwickelt und gehostet in der EU. Zielgruppe sind vor allem Organisationen auf Confluence Data Center, das am 28. März 2029 schreibgeschützt wird. Schwesterprojekt von **TalkFieber** (Team-Chat); beide teilen Login, Mandantenmodell und Cluster.

## Stack in einem Satz

TypeScript durchgängig: Next.js als Oberfläche, BlockNote als Editor, Yjs mit Hocuspocus für gemeinsames Bearbeiten, Express als API, PostgreSQL 18 über CloudNativePG, Zitadel für den Login, Garage für Dateien, alles auf K3s.

## Datenbank lokal aufsetzen und testen

Voraussetzung: PostgreSQL 18.

```bash
psql -U postgres -f database/scripts/roles_database.sql
psql -U wiki_owner -d wiki -f database/scripts/schema/schema.sql
psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f database/scripts/schema/schema_test.sql
# Erwartet: OK 1 … OK 28, dann "Alle Tests bestanden."
```

Die App verbindet sich nie als `wiki_owner`, sondern mit Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Worker). Details in `CLAUDE.md` Abschnitt 13.

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
  scripts/    Rollen, Schema, Tests
deploy/
  k8s/        Manifeste bzw. Kustomize, später Helm-Chart
docs/
  adr/        Entscheidungsnotizen
```
