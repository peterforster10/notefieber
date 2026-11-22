# Lokale Entwicklung einrichten

Diese Anleitung beschreibt, was man für die Entwicklung am eigenen Rechner braucht und wie man die Umgebung aufsetzt. Sie gilt für Windows (mit Git Bash), macOS und Linux. Nach dem allgemeinen Teil (Abschnitte 1–3) hat jeder Baustein der Umgebung einen eigenen Abschnitt.

## Inhalt

1. [Überblick](#1-überblick)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Repository holen und Umgebung starten](#3-repository-holen-und-umgebung-starten)
4. [Datenbank (PostgreSQL)](#4-datenbank-postgresql)
5. [Dateien (Garage)](#5-dateien-garage)
6. [Login (Zitadel)](#6-login-zitadel)
7. [Apps (Node.js)](#7-apps-nodejs)
8. [Alltag: starten, stoppen, neu anfangen](#8-alltag-starten-stoppen-neu-anfangen)
9. [Fehlerbehebung](#9-fehlerbehebung)
10. [Was noch dazukommt](#10-was-noch-dazukommt)

---

## 1. Überblick

Das Projekt steht am Anfang von Stufe 1 der [ROADMAP](ROADMAP.md). Datenbank, Dateispeicher und Login-Dienst laufen per Docker Compose ([`compose.yaml`](../compose.yaml)) und richten sich beim ersten Start selbst ein. Die Apps laufen mit Node.js direkt auf dem Rechner: Login, Spaces, Seitenbaum, Einladungen und der Editor mit gemeinsamem Bearbeiten (M1, Stück 1).

| Baustein | Stand | Container | Erreichbar unter | Abschnitt |
|---|---|---|---|---|
| Datenbank: PostgreSQL 18 mit Schema, Tests und Testdaten | fertig | `nf-pg18` | `localhost:5432` | [4](#4-datenbank-postgresql) |
| Dateien: Garage (S3), Bucket `wiki` | fertig | `nf-garage`, `garage-init` | `localhost:3900` (S3), `localhost:3903` (Admin) | [5](#5-dateien-garage) |
| Login: Zitadel v4 mit Organisationen, Testpersonen und OIDC-Clients | fertig | `nf-zitadel`, `nf-zitadel-login`, `nf-zitadel-proxy`, `zitadel-init` | `localhost:8080` | [6](#6-login-zitadel) |
| Frontend, API, Worker, Collab-Server (`apps/…`) | Login, Spaces und Seitenbaum, Editor mit gemeinsamem Bearbeiten | – (Node.js direkt auf dem Rechner) | `localhost:3000` (Frontend), `localhost:4000` (API), `localhost:1234` (Collab), `127.0.0.1:1235` (Collab intern, nur für die API) | [7](#7-apps-nodejs) |

Wer mitarbeitet, braucht Git, Docker, eine Bash und Node.js 24 mit pnpm.

## 2. Voraussetzungen

| Was | Version | Wofür | Hinweise |
|---|---|---|---|
| **Git** | aktuell | Repository | Unter Windows „Git for Windows“, bringt Git Bash mit. |
| **Docker** | Docker Desktop (Windows, macOS) oder Docker Engine (Linux), mit Compose | PostgreSQL 18, Garage und Zitadel | Alle Container zusammen brauchen im Leerlauf etwa 0,5 GB; Docker 4 GB Arbeitsspeicher geben. |
| **Bash** | 4 oder neuer | `schema_concurrency_test.sh` | Unter Windows Git Bash, unter macOS und Linux die vorhandene Shell. |
| **curl** | 7.75 oder neuer | Dateien in Garage von Hand prüfen (`--aws-sigv4`) | Unter Windows bringt Git Bash ein passendes curl mit. |
| **Node.js** | 24 (LTS), mindestens 24.11 | die Apps | Am einfachsten über einen Versionsmanager (`fnm`, `nvm`, `nvm-windows`). Node 24 führt TypeScript direkt aus. |
| **pnpm** | 12.18.0 (steht in `package.json`) | Pakete des Monorepos | Kommt über **corepack**, das Node mitbringt: einmal `corepack enable` ([Abschnitt 7](#7-apps-nodejs)). |
| **IDE** | z. B. IntelliJ IDEA Ultimate oder DataGrip, VS Code | Code und Datenbank | Ein Datenbank-Werkzeug in der IDE erleichtert das Ansehen von Tabellen und Abfragen ([Abschnitt 4](#mit-der-ide-verbinden)). |
| `psql` (optional) | 18 | Datenbank vom Rechner aus | Nicht nötig: Alle Befehle unten laufen mit `docker exec` über das `psql` im Container. |

**Windows:** Alle Befehle unten sind für **Git Bash** geschrieben. Zwei Dinge sind dort anders:

- Git Bash wandelt Pfade wie `/scripts/…` oder `/garage` in Windows-Pfade um, was `docker exec` durcheinanderbringt. Deshalb vor den Befehlen einmal pro Shell `export MSYS_NO_PATHCONV=1`.
- Shell-Skripte brauchen Unix-Zeilenenden (LF), sonst brechen sie mit `$'\r': command not found` ab. Die Datei `.gitattributes` im Repository sorgt dafür, dass Git `*.sh` immer mit LF auscheckt, auch mit `core.autocrlf=true`. Wurde das Repository vor dieser Datei ausgecheckt, die betroffenen Skripte löschen und neu holen, z. B. `rm docker/postgres/initdb/10-notefieber.sh` und `git checkout -- docker/postgres/initdb/10-notefieber.sh`.

## 3. Repository holen und Umgebung starten

```bash
git clone <url-des-repositorys> notefieber
```

```bash
cd notefieber
```

Wichtige Dateien für den Einstieg: `CLAUDE.md` (Entscheidungen und aktueller Stand), [CONCEPTS.md](CONCEPTS.md) (wie alles funktioniert), [SCHEMA.md](SCHEMA.md) (Datenmodell).

**Starten**, im Hauptordner des Repositorys:

```bash
docker compose up -d --wait
```

`--wait` wartet, bis alle Bausteine fertig eingerichtet sind. Beim **ersten Start** (leere Volumes) spielt PostgreSQL selbst Rollen, Datenbank, Schema und Testdaten ein ([Abschnitt 4](#4-datenbank-postgresql)), `garage-init` legt in Garage Bucket und Schlüssel an ([Abschnitt 5](#5-dateien-garage)), und Zitadel richtet seine Instanz mit Organisationen, Testpersonen und OIDC-Clients ein ([Abschnitt 6](#6-login-zitadel)). Beim allerersten Mal laden die Images (zusammen gut 1 GB), danach dauert der Start unter einer Minute. Dann:

```bash
docker compose ps
```

Erwartet, alle mit Status `Up … (healthy)`:

```
nf-garage                   Up … (healthy)   127.0.0.1:3900->3900/tcp, 127.0.0.1:3903->3903/tcp
nf-pg18                     Up … (healthy)   127.0.0.1:5432->5432/tcp
nf-zitadel                  Up … (healthy)   8080/tcp
nf-zitadel-login            Up … (healthy)
nf-zitadel-proxy            Up … (healthy)   127.0.0.1:8080->80/tcp
notefieber-garage-init-1    Up … (healthy)
notefieber-zitadel-init-1   Up … (healthy)
```

Alle Ports sind nur auf dem eigenen Rechner offen, nicht im Netzwerk.

**Einstellungen ändern** (optional): über Umgebungsvariablen oder eine Datei `.env` neben `compose.yaml`. Sie ist in `.gitignore` eingetragen und kommt nie ins Repository. Die Variablen stehen bei den Bausteinen ([PostgreSQL](#einstellungen-für-postgresql), [Garage](#einstellungen-für-garage), [Zitadel](#einstellungen-für-zitadel)) und gesammelt im Kopf von `compose.yaml`. Alle Standardwerte sind nur für den eigenen Rechner gedacht, nie für einen Server. Beispiel `.env`:

```
NF_PG_PORT=5433
NF_SEED=false
```

Starten, anhalten und neu anfangen für alle Bausteine zusammen: [Abschnitt 8](#8-alltag-starten-stoppen-neu-anfangen).

## 4. Datenbank (PostgreSQL)

PostgreSQL 18 läuft im Container `nf-pg18` (offizielles Image `postgres:18.6`). Die Befehle in dieser Anleitung und in der `CLAUDE.md` verwenden diesen Namen (`docker exec nf-pg18 …`).

| In `compose.yaml` | Bedeutung |
|---|---|
| Port `127.0.0.1:5432` | Für IDE und später die Apps. |
| Volume `notefieber-pgdata` → `/var/lib/postgresql` | Die Daten. Sie überstehen `stop`, `down` und Neustarts; weg sind sie erst mit `docker compose down -v`. Beim Image `postgres:18.6` ist das der richtige Pfad (nicht mehr `…/data`). |
| `./database/scripts` → `/scripts` (nur lesend) | Rollen, Schema, Tests und Testdaten. Änderungen am Rechner sind sofort im Container sichtbar. |
| `./docker/postgres/initdb` → `/docker-entrypoint-initdb.d` | Das Skript für die Ersteinrichtung ([`10-notefieber.sh`](../docker/postgres/initdb/10-notefieber.sh)). |
| Healthcheck | „healthy“ erst, wenn die Ersteinrichtung durch ist. |

### Einstellungen für PostgreSQL

| Variable | Standard | Wofür |
|---|---|---|
| `POSTGRES_PASSWORD` | `postgres-lokal` | Passwort des Superusers `postgres` für Verbindungen von außen. Innerhalb des Containers (`docker exec`) braucht man kein Passwort. Wirkt nur beim ersten Start. |
| `NF_PG_PORT` | `5432` | Port auf dem eigenen Rechner, z. B. `5433`, wenn schon ein PostgreSQL läuft. |
| `NF_SEED` | `true` | `false`: beim ersten Start keine Testdaten einspielen. |
| `NF_PG_CONTAINER`, `NF_PG_VOLUME` | `nf-pg18`, `notefieber-pgdata` | Nur ändern, wenn man eine zweite, getrennte Umgebung braucht. |

### Ersteinrichtung: Rollen, Datenbank, Schema

Beim ersten Start passiert das automatisch. Das Init-Skript [`10-notefieber.sh`](../docker/postgres/initdb/10-notefieber.sh) führt nacheinander aus:

1. **Rollen und Datenbank** als Superuser `postgres`: `roles_database.sql` legt die Rollen `wiki_owner`, `wiki_app` und `wiki_worker` an und die Datenbank `wiki` mit der Locale `C.UTF-8`.
2. **Schema** als Eigentümer `wiki_owner`, **nie** als `postgres`, sonst liefen alle `SECURITY DEFINER`-Funktionen als Superuser: [`migrate.sh`](../database/scripts/migrate.sh) spielt alle Migrationen aus `database/scripts/migrations/` ein ([Das Schema ändern](#das-schema-ändern)).
3. **Testdaten** als `wiki_owner`, wenn `NF_SEED=true` ([unten](#testdaten)).

Was dabei passiert ist, zeigt das Log:

```bash
docker logs nf-pg18 2>&1 | grep NoteFieber
```

Erwartet: `NoteFieber: Rollen und Datenbank …`, `NoteFieber: Schema …` mit `Migration 0001_initial_schema eingespielt`, `NoteFieber: Testdaten …`. Bricht ein Schritt ab, steht der Fehler direkt darunter; der Container läuft dann nicht weiter. Den Fehler beheben und mit `docker compose down -v` und `docker compose up -d --wait` neu anfangen.

**Von Hand** braucht man die Schritte nur nach dem [Zurücksetzen der Datenbank](#datenbank-zurücksetzen) oder mit einem PostgreSQL außerhalb von Docker:

```bash
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -f /scripts/roles_database.sql
```

```bash
docker exec nf-pg18 bash /scripts/migrate.sh
```

Die Rollen und Rechte erklärt [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas). Kurz: `wiki_owner` führt nur Migrationen aus und umgeht RLS; die Apps verbinden sich später mit eigenen Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Jobs).

### Passwort für `wiki_owner`

Nur nötig, um sich von der IDE aus zu verbinden. Die Skripte setzen bewusst keine Passwörter. Einmal setzen; es bleibt im Volume erhalten (auch beim [Zurücksetzen der Datenbank](#datenbank-zurücksetzen), nicht aber nach `docker compose down -v`):

```bash
docker exec -it nf-pg18 psql -U postgres -c "\password wiki_owner"
```

### Testdaten

[`database/scripts/seed/seed.sql`](../database/scripts/seed/seed.sql) legt zwei Mandanten mit Personen, Spaces, Seiten, Rechten und Kommentaren an. Die Namen und der Seitenbaum entsprechen dem Prototyp (`prototype/pages`) und den Beispielen in [CONCEPTS.md](CONCEPTS.md).

Mit Compose geschieht das **beim ersten Start automatisch** (außer mit `NF_SEED=false`). Von Hand, z. B. nach dem [Zurücksetzen der Datenbank](#datenbank-zurücksetzen):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/seed/seed.sql
```

Erwartet (beim ersten Start steht dasselbe in `docker logs nf-pg18`):

```
NOTICE:  Testdaten eingespielt:
NOTICE:    alpenwerk: 6 Personen, 4 Spaces, 17 Seiten
NOTICE:    nordlicht: 1 Personen, 1 Spaces, 2 Seiten
Testdaten eingespielt (Alpenwerk und Nordlicht).
```

Das Skript läuft in einer Transaktion: Entweder ist danach alles da oder nichts. Ein zweiter Lauf bricht mit „Testdaten sind schon eingespielt“ ab; zum Neuaufsetzen die [Datenbank zurücksetzen](#datenbank-zurücksetzen).

**Wer ist dabei und was sieht wer** (ohne Papierkorb, mit den Testdaten geprüft):

| Person | E-Mail | Rolle | Sieht |
|---|---|---|---|
| Peter Forster | `peter.forster@alpenwerk.example` | Organisations-Admin, Owner | ENTW (8 Seiten), VERT (3), PERS (3), ALT (2) |
| Lukas Gruber | `lukas.gruber@alpenwerk.example` | Gruppe Entwicklung | ENTW (8, auch „Personalplanung 2027“), VERT, ALT |
| Sophie Bauer | `sophie.bauer@alpenwerk.example` | Gruppe Entwicklung | ENTW (7), VERT, ALT |
| Markus Wagner | `markus.wagner@alpenwerk.example` | Gruppe Entwicklung | ENTW (7), VERT, ALT |
| Max Mustermann | `max.mustermann@alpenwerk.example` | Gruppe Vertrieb, Admin von VERT | ENTW (7, nur lesen), VERT, ALT |
| Elena Novak | `elena.novak@agentur-nord.example` | Gast (Agentur Nord) | nur „Kampagne Frühjahr“ in VERT |
| Eva Fischer | `eva.fischer@nordlicht.example` | anderer Mandant (Nordlicht) | nur DOKU (2), nichts von Alpenwerk |
| Nina Neu | `nina.neu@alpenwerk.example` | **nur in Zitadel**, nicht im Wiki | nichts, bis sie eine Einladung annimmt ([Abschnitt 7](#einladungen)) |

**Spaces bei Alpenwerk:**

| Space | Rechte | Besonderheiten |
|---|---|---|
| ENTW Entwicklung | alle im Workspace lesen, Gruppe Entwicklung bearbeitet, Peter Admin | Baum wie im Prototyp (Architektur, Datenmodell, Rechte-Konzept, Release-Prozess, Betrieb, Backups). „Personalplanung 2027“ hat eigene Rechte (nur Peter und Lukas). „Datenmodell“ hat zwei Kommentare und eine Version, „Release-Prozess“ einen erledigten Thread. „Alte Notizen“ liegt im Papierkorb. |
| VERT Vertrieb | von Max angelegt, alle im Workspace kommentieren | „Kampagne Frühjahr“ hat eigene Rechte und ist für den Gast Elena freigegeben, mit einem Kommentar von ihr. |
| PERS Personal | privat, nur Peter | gut, um „Ansehen als …“ und Organisations-Admins auszuprobieren |
| ALT Altes Intranet | alle lesen | archiviert, also für alle höchstens lesbar |

**Was man über die Testdaten wissen muss:**

- **Inhalt:** Die Seiten haben BlockNote-JSON (`content_json`) und Klartext, aber noch keinen Yjs-Zustand (`ydoc` leer). Beim ersten Öffnen baut der Collab-Server das Dokument aus dem JSON (CLAUDE.md, Abschnitt 6). Der Suchindex ist gefüllt, die Suche geht also sofort.
- **Kommentare** sind Seitenkommentare. Kommentare an Textstellen brauchen eine Yjs-Position und kommen erst mit dem Collab-Server.
- **Dateien:** Die Testdaten enthalten keine Anhänge; der Bucket in Garage ist leer.
- **Login:** Mandanten und Personen tragen dieselben festen IDs wie in Zitadel (`tenants.idp_org_id` = `org-alpenwerk`, `users.idp_subject` = `user-peter-forster` …). Anmelden geht mit der E-Mail-Adresse und dem Passwort `NoteFieber-lokal-1` ([Abschnitt 6](#6-login-zitadel)). Wer Personen ändert, ändert auch [`docker/zitadel/init.mjs`](../docker/zitadel/init.mjs).
- **Gruppen** (Geschäftsleitung, Entwicklung, Vertrieb) gehören dem Wiki: Peter legt sie als Organisations-Admin mit `app.create_group` an und nimmt die Mitglieder auf (Quelle `local`). In Zitadel gibt es sie nicht.
- **Ereignisse** liegen unveröffentlicht in der Outbox, bis ein Worker läuft.
- Ändert sich eine Funktion, die das Skript aufruft (z. B. eine neue Signatur), muss `seed.sql` mitgezogen werden. Ein Lauf nach jeder Schemaänderung ist deshalb ein guter zusätzlicher Test.

### Mit der IDE verbinden

| Feld | Wert |
|---|---|
| Host | `localhost` |
| Port | `5432` (bzw. `NF_PG_PORT`) |
| Datenbank | `wiki` |
| Benutzer | `wiki_owner` |
| Passwort | [siehe oben](#passwort-für-wiki_owner) |

In IntelliJ und DataGrip zeigt das Database-Fenster zunächst nur das Schema `public` (die Tabellen). Für die Funktionen im Schema `app`: in den Eigenschaften der Verbindung unter **Schemas** zusätzlich `app` ankreuzen.

**Achtung:** Als `wiki_owner` sieht man **alle** Zeilen aller Mandanten, weil der Eigentümer RLS umgeht. Um zu sehen, was eine bestimmte Person sieht, in einer Transaktion den Kontext setzen und die Rolle wechseln. Mit den [Testdaten](#testdaten) geht das über die E-Mail-Adresse:

```sql
BEGIN;
-- Kontext der Person setzen (noch als wiki_owner, der darf users lesen)
SELECT set_config('app.tenant_id', tenant_id::text, true),
       set_config('app.user_id',   id::text,        true)
FROM users WHERE email = 'max.mustermann@alpenwerk.example';
SET LOCAL ROLE wiki_app;

-- Seitenbaum, wie Max ihn sieht
SELECT s.key, p.title FROM pages p JOIN spaces s ON s.id = p.space_id
WHERE p.deleted_at IS NULL ORDER BY s.key, p.path;

-- Volltextsuche als Max
SELECT p.title FROM page_search ps JOIN pages p ON p.id = ps.page_id
WHERE ps.tsv @@ websearch_to_tsquery('german', 'Rechte') AND p.deleted_at IS NULL;
ROLLBACK;
```

Mit `SET LOCAL ROLE wiki_worker` und ohne `app.user_id` sieht man, was Collab-Server und Worker sehen: alles im Mandanten. „Ansehen als …“ probiert man so aus wie oben, aber als Peter (`peter.forster@…`) mit `SELECT * FROM app.view_as(<space-id>, <personen-id>, app.current_user_id());`.

### Tests ausführen

**Funktionstest** (55 Tests für Rechte, Sichtbarkeit und Regeln):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/schema_test/schema_test.sql
```

Erwartet: `NOTICE: OK 1 …` bis `NOTICE: OK 49 …`, dann `Alle Tests bestanden (zurückgerollt, die Datenbank ist unverändert).` Der Test läuft in einer Transaktion und rollt am Ende zurück. Man kann ihn also beliebig oft wiederholen, auch auf einer Datenbank mit Testdaten (die Tests nutzen eigene Mandanten). Bricht ein Test ab, zeigt `ERROR:` den Grund, und die Datenbank ist ebenfalls unverändert.

**Nebenläufigkeitstest** (Sperren im Seitenbaum mit zwei gleichzeitigen Sitzungen, Benachrichtigungen an den Collab-Server per `NOTIFY`, dauert etwa 12 Sekunden):

```bash
PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" bash database/scripts/schema_test/schema_concurrency_test.sh
```

Erwartet: `OK 1` bis `OK 5`, dann `Alle Nebenläufigkeitstests bestanden`. Dieser Test muss committen und legt deshalb einen eigenen Mandanten `nebenlaeufig-<zeitstempel>` an. Am Ende löscht er ihn wieder, auch wenn ein Test fehlschlägt. Bleibt doch einer stehen (etwa nach einem Abbruch mit Strg+C), stört er nicht; wer ihn loswerden will, [setzt die Datenbank zurück](#datenbank-zurücksetzen).

**Migrationstest** (`schema/` und die Migrationen ergeben dasselbe Schema, etwa 15 Sekunden):

```bash
ADMIN="docker exec -i nf-pg18 psql -U postgres" OWNER="docker exec -i nf-pg18 psql -U wiki_owner" DUMP="docker exec -i nf-pg18 pg_dump -U postgres" bash database/scripts/schema_test/schema_migrations_test.sh
```

Erwartet: `OK 1` und `OK 2`, dann `Alle Migrationstests bestanden`. Der Test spielt beide Wege in je eine eigene, frische Datenbank (`nf_check_schema`, `nf_check_migrations`) ein, vergleicht sie mit `pg_dump` und löscht sie danach wieder. Die Datenbank `wiki` berührt er nicht. Schlägt er fehl, zeigt er die Unterschiede: Zeilen mit `<` stehen nur in `schema/`, Zeilen mit `>` nur in den Migrationen.

**Alle Datenbanktests wie in der CI** ([`ci.sh`](../database/scripts/schema_test/ci.sh), etwa 15 Sekunden): Rollen, Migrationen, Funktionstest ohne und mit Testdaten, ein zweiter Lauf von `migrate.sh`, Nebenläufigkeits- und Migrationstest. `ci.sh` braucht einen **leeren** Server und bricht ab, wenn es die Datenbank `wiki` schon gibt; gegen `nf-pg18` läuft es deshalb nicht. Lokal so, mit zwei Wegwerf-Containern wie in GitLab:

```bash
export MSYS_NO_PATHCONV=1
docker network create nf-ci
docker run -d --name nf-ci-service --network nf-ci --network-alias postgres -e POSTGRES_PASSWORD=ci -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18.6
docker run --rm --network nf-ci --entrypoint "" -e PGHOST=postgres -v "$(pwd -W):/builds/notefieber:ro" -w /builds/notefieber postgres:18.6 bash database/scripts/schema_test/ci.sh
docker rm -f nf-ci-service && docker network rm nf-ci
```

Erwartet: zum Schluss `Alle Datenbanktests bestanden.` (`$(pwd -W)` ist der Pfad des Repositorys in Git Bash; unter macOS und Linux `$(pwd)`.)

### CI (GitLab)

Das Repository liegt auf GitHub, die CI läuft auf GitLab:

- [`.github/workflows/sync-to-gitlab.yml`](../.github/workflows/sync-to-gitlab.yml) spiegelt bei jedem Push auf `main` das Repository nach `gitlab.com/peterforster101/notefieber`. Dafür braucht das GitHub-Repository das Secret `GITLAB_TOKEN`: ein Project Access Token in GitLab mit Scope `write_repository` und einer Rolle, die auf `main` pushen darf (standardmäßig Maintainer). Der Workflow pusht `main` und die Tags **ohne `--force`**, nacheinander (nie zwei Läufe gleichzeitig) und liest vom GitHub-Token nur. Weicht `main` auf GitLab ab (etwa weil dort jemand direkt committet oder auf GitHub der Verlauf umgeschrieben wurde), schlägt der Lauf mit `rejected … (fetch first)` bzw. `(non-fast-forward)` fehl. Dann auf GitLab nichts direkt ändern und den Unterschied bewusst auflösen, notfalls einmal von Hand mit `--force` pushen.
- [`.gitlab-ci.yml`](../.gitlab-ci.yml) startet dort bei jedem Push drei Jobs, die parallel laufen:
  - `database`: Image `postgres:18.6` (psql und pg_dump in derselben Version wie der Server) mit einem Service `postgres:18.6`, der ohne Passwort anmeldet (nur im Job). Er führt `ci.sh` aus, also genau die Schritte oben.
  - `apps`: Image `node:24.18.1`, führt `pnpm check` aus ([Abschnitt 7](#prüfen-wie-in-der-ci)).
  - `api`: Image `node:24.18.1` mit Service `postgres:18.6`. Richtet die Datenbank mit [`setup_test_db.sh`](../database/scripts/setup_test_db.sh) ein (Rollen, Migrationen, Login-Rollen, Testdaten; `psql` aus Debian) und führt die [API-Tests gegen die Datenbank](#api-tests-gegen-die-datenbank) aus.
- Andere Branches als `main` spiegelt der Workflow nicht; Pipelines gibt es also nur für `main`.
- Auf gitlab.com laufen Jobs auf den gemeinsamen Runnern. Neue Konten müssen dafür einmal ihre Identität bestätigen (Telefon oder Kreditkarte), sonst bleibt die Pipeline hängen.


### Das Schema ändern

Das Schema steht an zwei Stellen, und jede Änderung kommt in beide:

- **`database/scripts/schema/`** ist der vollständige, lesbare Stand: `schema.sql` bindet die Teile (`00_setup.sql` … `90_privileges.sql`) mit `\ir` ein. Welche Datei was enthält, zeigt die Tabelle am Anfang von [SCHEMA.md](SCHEMA.md). Hier liest man nach, wie etwas aussieht.
- **`database/scripts/migrations/`** sind die Schritte, mit denen jede Datenbank dorthin kommt, auch eine mit Daten. `0001_initial_schema.sql` ist der Stand vom 8. November 2026, erzeugt mit [`schema/bundle.sh`](../database/scripts/schema/bundle.sh). Jede spätere Änderung ist eine neue Datei. [`migrate.sh`](../database/scripts/migrate.sh) spielt ein, was fehlt, und führt darüber Buch in der Tabelle `migrations.applied`.

Dass beide Stellen dasselbe Schema ergeben, prüft der [Migrationstest](#tests-ausführen). Ein Änderungszyklus:

1. **Test zuerst:** Alles, was Rechte oder Sichtbarkeit berührt, bekommt zuerst einen Test (Regel aus der `CLAUDE.md`). Die Tests liegen in `database/scripts/schema_test/`: `schema_test.sql` ist der Einstieg, die Tests stehen in den Teilen `01_basics.sql` … `12_groups.sql`. Neue Tests hinten an den passenden Teil oder als neuer Teil am Ende (mit `\ir`-Zeile in `schema_test.sql`). Die Teile bauen aufeinander auf; welche Testdaten ein Teil nutzt und anlegt, steht in seinem Kopf. Die Tests laufen als `wiki_app` bzw. `wiki_worker`.
2. **`schema/` ändern:** den passenden Teil, z. B. eine neue Seitenfunktion in `60_functions_pages.sql`, ihre Freigabe in `90_privileges.sql`, eine neue Leseregel in `80_rls.sql`. Die Regeln für neue Funktionen stehen in der `CLAUDE.md` (Abschnitt 13) und in [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas): Mandant in jeder Abfrage prüfen, `require_actor` zuerst, neue Funktionen ausdrücklich freigeben. Ein **neuer Teil** braucht eine `\ir`-Zeile in `schema.sql` an der richtigen Stelle der Reihenfolge.
3. **Migration schreiben:** `database/scripts/migrations/NNNN_beschreibung.sql` mit der nächsten freien Nummer (siehe `ls database/scripts/migrations`), z. B. `0011_space_icon.sql`. Sie enthält dieselbe Änderung als Schritt: `ALTER TABLE …`, `CREATE OR REPLACE FUNCTION …` mit **genau** dem Text aus `schema/`, `GRANT`/`REVOKE` für neue Funktionen (sie sind sonst für niemanden ausführbar), neue Policies. Regeln:
   - reines SQL, kein `BEGIN`/`COMMIT` (`migrate.sh` legt eine Transaktion darum) und keine psql-Befehle wie `\ir`,
   - eingespielte Migrationen **nie ändern**; `migrate.sh` merkt sich eine Prüfsumme und bricht sonst ab,
   - nur vorwärts, und **eine Version rückwärtskompatibel**: Die bisherige App muss mit dem neuen Schema noch laufen (Spalte erst hinzufügen, später entfernen),
   - neue Spalten in `schema/` **ans Ende** der Tabelle schreiben, weil `ALTER TABLE … ADD COLUMN` sie hinten anhängt; sonst meldet der Migrationstest einen Unterschied.
4. **Einspielen**, ohne die Datenbank zurückzusetzen; die Daten bleiben:

   ```bash
   docker exec nf-pg18 bash /scripts/migrate.sh
   ```

   Erwartet: `Migration 0002_… eingespielt`, dann `Migrationen aktuell, 2 eingespielt.` Schlägt eine Migration fehl, ist nichts davon eingespielt (eine Transaktion pro Migration). Vom Rechner aus geht es auch mit `PSQL="psql -h localhost -U wiki_owner -d wiki" bash database/scripts/migrate.sh` (mit dem [Passwort von `wiki_owner`](#passwort-für-wiki_owner)).
5. Alle drei [Tests ausführen](#tests-ausführen), auch den Migrationstest. Scheitert `seed.sql` auf einer frischen Datenbank, nutzt es eine geänderte Funktion; dann das Skript mitziehen.
6. [SCHEMA.md](SCHEMA.md) und bei Bedarf `CLAUDE.md` nachziehen.

### Datenbank zurücksetzen

Nur die Datenbank `wiki`, z. B. um mit frischen Testdaten anzufangen. Für Schemaänderungen ist das nicht nötig ([Migration einspielen](#das-schema-ändern)). Schneller als [alles neu](#8-alltag-starten-stoppen-neu-anfangen), Garage bleibt unberührt, und das Passwort von `wiki_owner` bleibt erhalten (es hängt an der Rolle, nicht an der Datenbank). Die Hinweise `role "wiki_owner" has already been granted membership …` sind harmlos:

```bash
export MSYS_NO_PATHCONV=1
docker exec nf-pg18 psql -U postgres -c "DROP DATABASE IF EXISTS wiki WITH (FORCE)"
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -q -f /scripts/roles_database.sql
docker exec nf-pg18 bash /scripts/migrate.sh
```

Testdaten wieder einspielen (optional):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/seed/seed.sql
```

### Umstieg vom früheren `docker run`

Wer die Datenbank nach einer älteren Fassung dieser Anleitung mit `docker run --name nf-pg18 …` gestartet hat, entfernt nur den Container. Das Volume `notefieber-pgdata` mit allen Daten und dem Passwort von `wiki_owner` übernimmt Compose:

```bash
docker rm -f nf-pg18
```

```bash
docker compose up -d --wait
```

Compose meldet dabei einmal `volume "notefieber-pgdata" already exists but was not created by Docker Compose`. Das ist harmlos. Die Ersteinrichtung läuft nicht noch einmal (`Skipping initialization` im Log), die Daten bleiben.

## 5. Dateien (Garage)

Anhänge, Bilder und Import-Archive liegen in **Garage**, einem S3-kompatiblen Speicher (Image `dxflrs/garage:v2.5.0`, Container `nf-garage`). In der Datenbank steht dazu nur die Zeile in `files` mit dem Schlüssel des Objekts (`storage_key`), siehe [SCHEMA.md](SCHEMA.md). Garage startet mit `docker compose up` und braucht keine weiteren Schritte.

| In `compose.yaml` | Bedeutung |
|---|---|
| Port `127.0.0.1:3900` | S3-API für die Apps. |
| Port `127.0.0.1:3903` | Admin-API (Token `garage-admin-lokal`), nur für die Einrichtung. |
| Volumes `notefieber-garage-meta`, `notefieber-garage-data` | Metadaten und Dateien. Sie überstehen `stop` und `down`; `docker compose down -v` löscht sie mit allen anderen Daten. |
| `./docker/garage/garage.toml` → `/etc/garage.toml` | Konfiguration: ein Knoten, keine Replikation. |
| Dienst `garage-init` | Einrichtung beim Start ([unten](#einrichtung-beim-start)). |

### Einrichtung beim Start

Der Dienst `garage-init` ([`docker/garage/init.sh`](../docker/garage/init.sh)) spricht mit der Admin-API von Garage und

1. legt das Speicher-Layout für den einzigen Knoten fest (sonst nimmt Garage nichts an),
2. importiert den lokalen Zugangsschlüssel mit fester ID und festem Geheimnis,
3. legt den Bucket `wiki` an und gibt dem Schlüssel Lesen, Schreiben und Verwalten.

Jeder Schritt prüft, ob er schon erledigt ist; bei jedem weiteren Start ändert sich also nichts. Danach bleibt `garage-init` wartend stehen und meldet „healthy“: So wartet `docker compose up --wait`, bis Garage nutzbar ist (ein Dienst, der sich beendet, gilt für `--wait` als Fehler). Was passiert ist:

```bash
docker compose logs --no-log-prefix garage-init
```

Erwartet beim ersten Start: `Garage: … Schlüssel … importiert`, `Garage: Bucket wiki angelegt`, `Garage: bereit, …`; bei späteren Starts „schon vorhanden“.

### Werte für die Apps

Nur lokal; dieselben Werte stehen in der [`.env.example`](../.env.example).

| Einstellung | Wert |
|---|---|
| S3-Endpunkt | `http://localhost:3900` |
| Region | `garage` (muss genau so lauten, sonst passt die Signatur nicht) |
| Bucket | `wiki` |
| Access Key ID | `GK6e6f74656669656265720001` |
| Secret Access Key | `6c6f6b616c2d6e75722d7a756d2d656e747769636b656c6e2d67617261676521` |
| Adressierung | **Pfad-Stil** (`http://localhost:3900/wiki/<schlüssel>`), z. B. im AWS SDK `forcePathStyle: true` |

Zum Beispiel mit dem AWS SDK für JavaScript:

```ts
const s3 = new S3Client({
  endpoint: "http://localhost:3900",
  region: "garage",
  forcePathStyle: true,
  credentials: { accessKeyId: "GK6e6f…0001", secretAccessKey: "6c6f…6521" },
});
```

### Einstellungen für Garage

| Variable | Standard | Wofür |
|---|---|---|
| `NF_S3_PORT`, `NF_GARAGE_ADMIN_PORT` | `3900`, `3903` | Ports von Garage (S3-API, Admin-API). |
| `NF_S3_BUCKET` | `wiki` | Name des Buckets. |
| `NF_S3_ACCESS_KEY_ID`, `NF_S3_SECRET_ACCESS_KEY` | die Werte [oben](#werte-für-die-apps) | Zugang. Die Schlüssel-ID ist `GK` + 24 Hexziffern, das Geheimnis 64 Hexziffern. Garage vergibt eine ID nur einmal; wer sie ändert, nimmt eine neue ID oder fängt mit `docker compose down -v` neu an. |
| `NF_GARAGE_ADMIN_TOKEN`, `NF_GARAGE_RPC_SECRET` | lokale Werte | Token der Admin-API und interner Schlüssel von Garage. |
| `NF_GARAGE_CONTAINER`, `NF_GARAGE_VOLUME_PREFIX` | `nf-garage`, `notefieber-garage` | Nur für eine zweite, getrennte Umgebung. |

### Von Hand prüfen

Mit curl (signiert die Anfrage selbst, ab Version 7.75):

```bash
export S3_KEY="GK6e6f74656669656265720001:6c6f6b616c2d6e75722d7a756d2d656e747769636b656c6e2d67617261676521"
echo "Hallo" > /tmp/hallo.txt
curl --aws-sigv4 "aws:amz:garage:s3" --user "$S3_KEY" -T /tmp/hallo.txt http://localhost:3900/wiki/test/hallo.txt
curl --aws-sigv4 "aws:amz:garage:s3" --user "$S3_KEY" http://localhost:3900/wiki/test/hallo.txt
```

Ohne Schlüssel antwortet Garage mit `403`. Den Zustand zeigt das eingebaute Programm (das Image hat keine Shell, nur `/garage`; in Git Bash vorher `export MSYS_NO_PATHCONV=1`):

```bash
docker exec nf-garage /garage status
```

```bash
docker exec nf-garage /garage bucket info wiki
```

## 6. Login (Zitadel)

Zitadel (fest eingetragene Version `v4.20.1`) ist der Login-Dienst, später gemeinsam mit TalkFieber. Die Apps sprechen nur generisches OIDC mit ihm. Lokal ist alles unter **`http://localhost:8080`** erreichbar und startet mit `docker compose up` ohne weitere Schritte. Seit Version 4 besteht Zitadel aus zwei Programmen; zusammen mit Proxy und Einrichtung sind es vier Dienste:

| Dienst | Container | Aufgabe |
|---|---|---|
| `zitadel` | `nf-zitadel` | OIDC, Console, Verwaltungs-APIs. Speichert alles in der Datenbank **`zitadel`** im selben PostgreSQL (Rolle `zitadel`), wie später im gemeinsamen Cluster (CLAUDE.md, Abschnitt 11). |
| `zitadel-login` | `nf-zitadel-login` | Die Anmeldeseiten (Next.js) unter `/ui/v2/login`. |
| `zitadel-proxy` | `nf-zitadel-proxy` | Ein kleiner Traefik, der beide unter einem Ursprung zusammenführt ([`docker/zitadel/traefik.yml`](../docker/zitadel/traefik.yml)). Nur er hat einen Port auf dem Rechner. |
| `zitadel-init` | `notefieber-zitadel-init-1` | Einrichtung beim Start ([`docker/zitadel/init.mjs`](../docker/zitadel/init.mjs), [unten](#einrichtung-beim-start-1)). |

| In `compose.yaml` | Bedeutung |
|---|---|
| Port `127.0.0.1:8080` | Issuer, Anmeldeseiten und Console. Zitadel erkennt seine Instanz am Hostnamen: immer **`localhost:8080`**, nicht `127.0.0.1:8080`. |
| Datenbank `zitadel` im Volume `notefieber-pgdata` | Alle Daten von Zitadel. Sie überstehen `stop` und `down`; weg mit `docker compose down -v` oder beim [Zurücksetzen von Zitadel](#zitadel-zurücksetzen). |
| Volume `notefieber-zitadel-bootstrap` | Zugangstokens der beiden Dienstkonten aus der Ersteinrichtung. |
| `./.local` (auf dem Rechner, nicht im Repository) | Ausgabe der Einrichtung: [Werte für die Apps](#werte-für-die-apps-1). |

### Ersteinrichtung

Beim ersten Start (Datenbank `zitadel` gibt es noch nicht) richtet sich Zitadel selbst ein:

1. Rolle und Datenbank `zitadel` im PostgreSQL, angelegt als Superuser `postgres`.
2. Die Instanz **„NoteFieber lokal“**: Sprache Deutsch, keine Selbstregistrierung, keine Aufforderung zur Einrichtung eines zweiten Faktors.
3. Die Organisation **NoteFieber** (der Betreiber, kein Mandant) mit dem Admin `zitadel-admin` und zwei Dienstkonten: `nf-setup` für die Einrichtung und `login-client` für die Anmeldeseiten. Ihre Tokens landen im Volume `notefieber-zitadel-bootstrap`.

Das dauert etwa 20 Sekunden. Alles danach erledigt `zitadel-init`.

### Einrichtung beim Start

Der Dienst `zitadel-init` spricht mit dem Token von `nf-setup` mit der Verwaltungs-API (v2) und legt an, was fehlt:

1. das **Projekt `notefieber`** in der Organisation NoteFieber,
2. den OIDC-Client **`notefieber-login`**, mit dem die API Personen anmeldet, und den API-Client **`notefieber-api`**,
3. die Organisationen **Alpenwerk GmbH** (`org-alpenwerk`) und **Nordlicht GmbH** (`org-nordlicht`), denen das Projekt freigegeben wird,
4. die **Testpersonen** aus den [Testdaten](#testdaten) mit bestätigter E-Mail und dem Testpasswort: die sieben aus `seed.sql` und Nina Neu, die es nur in Zitadel gibt (zum Ausprobieren von Einladungen),
5. die Datei **`.local/zitadel.env`** mit den Werten für die Apps (und `.local/zitadel-admin.pat`).

Jeder Schritt prüft, ob er schon erledigt ist; bei jedem weiteren Start ändert sich nichts. Danach bleibt `zitadel-init` wartend stehen und meldet „healthy“ (wie `garage-init`). Was passiert ist:

```bash
docker compose logs --no-log-prefix zitadel-init
```

Erwartet beim ersten Start „angelegt“ für Projekt, Clients, Organisationen und Personen, zum Schluss `Zitadel: bereit: http://localhost:8080, Client web …`; bei späteren Starts „schon vorhanden“.

### Wie Zitadel und das Datenmodell zusammenpassen

| In Zitadel | In NoteFieber | In den Testdaten |
|---|---|---|
| Organisation | Mandant, `tenants.idp_org_id` | `org-alpenwerk`, `org-nordlicht` |
| Person (`sub` im Token) | `users.idp_subject`, pro Mandant eindeutig | `user-peter-forster`, `user-lukas-gruber` … (aus der E-Mail gebildet) |
| Organisation NoteFieber | kein Mandant, nur Betreiber | `zitadel-admin` |

- **Feste IDs:** Zitadel erlaubt eigene IDs für Organisationen und Personen. Die Einrichtung nutzt dieselben IDs wie [`seed.sql`](../database/scripts/seed/seed.sql). Deshalb passen Zitadel und Datenbank zusammen, egal in welcher Reihenfolge man sie aufsetzt. Wer Testpersonen oder Organisationen ändert, ändert **beide Dateien**. Echte Mandanten bekommen später von Zitadel erzeugte IDs.
- **Gruppen stehen nicht in Zitadel.** Zitadel v4.20 hat keine Gruppen (keine Gruppen-API, kein Gruppen-Claim). Die Gruppen gehören deshalb dem Wiki (`groups`, CLAUDE.md Abschnitt 8): Organisations-Admins pflegen sie, der Confluence-Import bringt welche mit, später kommen SCIM und ein Gruppen-Claim (etwa aus Entra ID) als Quellen dazu. Zitadel liefert nur Person und Mandant.
- **Elena Novak** ist in Zitadel ein normales Mitglied der Organisation Alpenwerk. Gast ist sie nur in NoteFieber (`workspace_members`).

### Anmelden als Testperson

Anmeldename ist die **E-Mail-Adresse** aus der Tabelle in den [Testdaten](#testdaten), das Passwort für alle **`NoteFieber-lokal-1`** (`NF_TEST_PASSWORD`).

- **In NoteFieber:** API und Frontend starten ([Abschnitt 7](#anmelden)), dann `http://localhost:3000` öffnen, Mandant `alpenwerk` (oder `nordlicht` für Eva) und „Anmelden“.

- **Console** (Verwaltung von Zitadel): `http://localhost:8080/ui/console`, Anmeldename `zitadel-admin@notefieber.localhost`, Passwort `NoteFieber-lokal-1` (`NF_ZITADEL_ADMIN_PASSWORD`). Dort sieht man die Organisationen Alpenwerk und Nordlicht mit ihren Personen und im Projekt NoteFieber die Clients.
- Die Testpersonen haben in der Console keine Rechte; sie melden sich nur über NoteFieber an.

Die Anmeldeseiten erscheinen in der Sprache des Browsers. Es werden keine E-Mails verschickt (kein SMTP); Passwort vergessen und ähnliche Abläufe gehen deshalb lokal nicht.

### Werte für die Apps

`zitadel-init` schreibt sie bei jedem Start nach **`.local/zitadel.env`** (in `.gitignore`), weil Zitadel die Client-IDs selbst vergibt:

```
OIDC_ISSUER=http://localhost:8080
OIDC_CLIENT_ID=3987298…
OIDC_CLIENT_SECRET=…
OIDC_REDIRECT_URI=http://localhost:3000/api/v1/auth/callback
ZITADEL_PROJECT_ID=notefieber
ZITADEL_API_CLIENT_ID=3987295…
ZITADEL_API_CLIENT_SECRET=…
```

Die API liest die Datei beim Start selbst (`pnpm dev:api`); kopieren muss man nichts.

| Client | Art | Einstellungen |
|---|---|---|
| `notefieber-login` | OIDC, **vertraulich**: Geheimnis (Basic Auth) und zusätzlich PKCE, **Authorization Code**, keine Refresh-Tokens | Die API meldet damit an ([Abschnitt 7](#anmelden)). Redirect `http://localhost:3000/api/v1/auth/callback` (über das Frontend zur API), nach dem Abmelden `http://localhost:3000/` (beides aus `NF_WEB_URL`). Entwicklungsmodus (erlaubt `http`). Name und E-Mail im ID-Token. |
| `notefieber-api` | API, Client-ID und Geheimnis (Basic Auth) | Für die **Token-Introspection** (`/oauth/v2/introspect`), derzeit ungenutzt. |

Bis zum 8. November 2026 gab es statt `notefieber-login` den öffentlichen Client `notefieber-web` (PKCE im Browser). In älteren Instanzen bleibt er stehen, die App nutzt ihn nicht mehr; ein [Zurücksetzen](#zitadel-zurücksetzen) räumt ihn weg.

Discovery: `http://localhost:8080/.well-known/openid-configuration`, Schlüssel unter `http://localhost:8080/oauth/v2/keys`, Issuer `http://localhost:8080`.

**Scopes**, die die API anfragt: `openid profile email urn:zitadel:iam:user:resourceowner` und `urn:zitadel:iam:org:id:<organisation>`. Der letzte beschränkt die Anmeldung auf die Organisation des Mandanten: Eva aus Nordlicht kommt bei Alpenwerk gar nicht erst durch. Was im ID-Token von Lukas steht (gekürzt, mit Zitadel v4.20.1 geprüft):

```json
{
  "iss": "http://localhost:8080",
  "sub": "user-lukas-gruber",
  "email": "lukas.gruber@alpenwerk.example",
  "name": "Lukas Gruber",
  "locale": "de",
  "urn:zitadel:iam:user:resourceowner:id": "org-alpenwerk"
}
```

Die API ordnet so zu: Mandant über `urn:zitadel:iam:user:resourceowner:id` = `tenants.idp_org_id`, Person über `(tenant_id, sub)` = `users.idp_subject`. Gruppen kommen nicht aus dem Token, sie stehen im Wiki. Die Claim-Namen stehen an einer Stelle ([`auth/claims.ts`](../apps/api/src/auth/claims.ts), einstellbar über `OIDC_CLAIM_*`), damit später auch ein anderer Login-Dienst passt.

Wer Zitadel schon vor dem 8. November 2026 eingerichtet hat, hat im Projekt noch die Rollen `entwicklung`, `vertrieb` und `geschaeftsleitung`, und sie stehen auch im Token (`urn:zitadel:iam:org:project:roles`). Die App wertet sie nicht aus; wer sie loswerden will, [setzt Zitadel zurück](#zitadel-zurücksetzen).

### Einstellungen für Zitadel

Fast alle wirken **nur beim allerersten Start** (leere Datenbank `zitadel`). Wer sie danach ändert, [setzt Zitadel zurück](#zitadel-zurücksetzen).

| Variable | Standard | Wofür |
|---|---|---|
| `NF_ZITADEL_PORT` | `8080` | Port auf dem Rechner. Steckt auch im Issuer (`http://localhost:<port>`). |
| `NF_ZITADEL_VERSION` | `v4.20.1` | Version von `zitadel` und `zitadel-login`; beide immer gleich. Beim Wechsel der Hauptversion vorher die Versionshinweise lesen. |
| `NF_ZITADEL_ADMIN_PASSWORD` | `NoteFieber-lokal-1` | Passwort von `zitadel-admin`. Muss die Passwortregeln erfüllen (8 Zeichen, Groß- und Kleinbuchstaben, Ziffer, Sonderzeichen), sonst scheitert die Ersteinrichtung. |
| `NF_TEST_PASSWORD` | `NoteFieber-lokal-1` | Passwort der Testpersonen. Gilt für neu angelegte Personen; bestehende behalten ihres. |
| `NF_WEB_URL` | `http://localhost:3000` | Frontend-Adresse für die Redirect-URLs. Gilt beim Anlegen des Clients. |
| `NF_ZITADEL_MASTERKEY` | lokaler Wert | Verschlüsselt Geheimnisse in der Datenbank. Genau 32 Zeichen; nach dem ersten Start nicht mehr ändern. |
| `NF_ZITADEL_DB_PASSWORD` | `zitadel-lokal` | Passwort der Datenbankrolle `zitadel`. |
| `NF_ZITADEL_COOKIE_SECRET` | lokaler Wert | Signiert die Cookies der Anmeldeseiten, mindestens 32 Zeichen. Darf sich ändern (dann einmal neu anmelden). |
| `NF_ZITADEL_CONTAINER`, `NF_ZITADEL_LOGIN_CONTAINER`, `NF_ZITADEL_PROXY_CONTAINER`, `NF_ZITADEL_VOLUME` | `nf-zitadel`, … | Nur für eine zweite, getrennte Umgebung. |

Zitadel meldet sich bei PostgreSQL als `postgres` mit `POSTGRES_PASSWORD` an ([Einstellungen für PostgreSQL](#einstellungen-für-postgresql)), um Rolle und Datenbank anzulegen.

### Von Hand prüfen

```bash
curl -s http://localhost:8080/.well-known/openid-configuration
```

Die Verwaltungs-API mit dem Token des Dienstkontos `nf-setup` (darf alles in der Instanz), z. B. alle Personen:

```bash
curl -s -H "Authorization: Bearer $(cat .local/zitadel-admin.pat)" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/zitadel.user.v2.UserService/ListUsers -d '{}'
```

### Zitadel zurücksetzen

Nur Zitadel neu, z. B. nach geänderten Einstellungen. Die Datenbank `wiki` und Garage bleiben unberührt. Danach vergibt Zitadel neue Client-IDs; `.local/zitadel.env` wird neu geschrieben, laufende Apps neu starten.

```bash
export MSYS_NO_PATHCONV=1
docker compose rm -sf zitadel-init zitadel-proxy zitadel-login zitadel
docker volume rm notefieber-zitadel-bootstrap
docker exec nf-pg18 psql -U postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)" -c "DROP ROLE IF EXISTS zitadel"
```

```bash
docker compose up -d --wait
```

## 7. Apps (Node.js)

Die Apps liegen in einem **pnpm-Monorepo** (ein Repository, mehrere Node-Projekte mit je eigener `package.json`, eine gemeinsame Lock-Datei):

| Paket | Ordner | Was | Datenbankrolle | Start | Adresse |
|---|---|---|---|---|---|
| `@notefieber/web` | `apps/web` | Frontend (Next.js 16, nur Oberfläche) | – (spricht nur mit der API) | `pnpm dev:web` | `http://localhost:3000` |
| `@notefieber/api` | `apps/api` | API (Express 5) **und** Worker: ein Paket, später ein Image, zwei Deployments | API: `wiki_api` (in `wiki_app`), Worker: `wiki_jobs` (in `wiki_worker`) | `pnpm dev:api`, `pnpm dev:worker` | `http://localhost:4000/api/v1/health` |
| `@notefieber/collab` | `apps/collab` | Collab-Server (Hocuspocus) | `wiki_collab` (in `wiki_worker`) | `pnpm dev:collab` | `ws://127.0.0.1:1234`, intern `http://127.0.0.1:1235` (nur für die API) |
| `@notefieber/shared` | `packages/shared` | gemeinsame Typen und Zod-Schemas: Rollen, Ereignisse, Kurznamen, Prüfung der Datenbankrolle | – | – | – |
| `@notefieber/editor-schema` | `packages/editor-schema` | BlockNote-Schema für Browser, Worker, Collab-Server und Import; Aufbau des Yjs-Dokuments (`page:<uuid>`, Fragment `content`, Text `title`), Klartext; `/server`: Yjs ↔ BlockNote-JSON ohne DOM | – | – | – |

Stand: Die API **meldet über Zitadel an** ([unten](#anmelden)) und kennt **Spaces und Seitenbaum** ([unten](#spaces-und-seitenbaum)). Der **Worker** sieht alle `WORKER_DERIVE_INTERVAL_SECONDS` (5 s) nach Arbeit (`app.pages_to_derive`): Seiten, die seit `WORKER_DERIVE_REST_SECONDS` (30 s) ruhen, bekommen BlockNote-JSON, Klartext und Suchindex (`app.store_derived`, ein `page.updated`), Seiten nur mit BlockNote-JSON (die Testdaten) ihren ersten Yjs-Zustand (`app.store_initial_ydoc`); dazu ein Lebenszeichen im Log. Der **Collab-Server** lässt Verbindungen mit dem Sitzungs-Cookie herein (`Origin` muss `PUBLIC_URL` sein, Rolle über `app.page_rank`: viewer und commenter lesend, editor schreibend, Seiten im Papierkorb lesend), lädt und speichert den Yjs-Zustand (`app.store_ydoc`, entprellt `COLLAB_DEBOUNCE_MS`, spätestens `COLLAB_MAX_DEBOUNCE_MS`); bei Rechteänderungen, Papierkorb und Abmelden (`LISTEN nf_events`, `nf_sessions`) prüft er offene Verbindungen neu und schließt die, deren Zugang sich geändert hat; der Browser meldet sich von selbst neu an. Zusätzlich prüft er alle `COLLAB_RECHECK_SECONDS` (300 s) alle offenen Verbindungen. Für Änderungen von der Serverseite (bisher: Umbenennen aus der Seitenleiste) lauscht er auf einem zweiten, internen Port (`COLLAB_INTERNAL_PORT`, 1235, nur `127.0.0.1`); die API ruft ihn mit dem geteilten Geheimnis `COLLAB_INTERNAL_SECRET` auf. Fehlt das Geheimnis in der `.env`, ist der interne Aufruf aus, und Umbenennen aus der Seitenleiste antwortet mit 503. Das Frontend zeigt Anmelden, die eigenen Spaces, pro Space die Seitenleiste mit dem Baum und die Seite im **Editor** (BlockNote, verbunden mit dem Collab-Server; lokal unter `ws://localhost:<COLLAB_PORT>`, ohne Einstellung). Zum Bearbeiten müssen also alle vier laufen: API, Collab-Server, Worker und Frontend. Jede geöffnete Seite hat eine lokale Kopie im Browser (IndexedDB `nf:<person>:page:<seite>`, in den Entwicklertools unter „Application“), damit Änderungen aus einem Funkloch ein Neuladen überstehen. Gemeinsames Bearbeiten probiert man mit zwei Personen in zwei verschiedenen Browsern (oder einem privaten Fenster) aus, siehe [USE_CASES](USE_CASES.md), UC-19 bis UC-22.

### Einrichten

Einmal pro Rechner pnpm über corepack einschalten. Corepack legt dafür kleine Starter neben `node`; liegt Node unter `C:\Program Files\nodejs`, braucht das eine Shell als Administrator. Ohne Administrator geht es auch mit `corepack enable --install-directory <ordner im PATH>`.

```bash
corepack enable
```

Dann im Repository die Pakete installieren und die Einstellungen anlegen:

```bash
pnpm install
```

```bash
cp .env.example .env
```

Die [`.env.example`](../.env.example) passt ohne Änderung zur lokalen Umgebung. Die `.env` liest auch `docker compose` (für seine eigenen Variablen); sie kommt nie ins Repository. Kommen in der `.env.example` neue Einstellungen dazu (zuletzt am 8. November 2026 für den Login), die `.env` neu kopieren oder die neuen Zeilen übernehmen. Die Werte für den Login (`OIDC_*`) liest die API zusätzlich aus `.local/zitadel.env`.

**Login-Rollen der Apps:** Jede App verbindet sich mit einer eigenen Login-Rolle, nie als `wiki_owner` oder `postgres`; sie prüft das beim Start und bricht sonst mit `Datenbank: Datenbankrolle … ist Superuser oder Eigentümer` bzw. `… muss Mitglied von … sein` ab. Die Rollen `wiki_api`, `wiki_collab` und `wiki_jobs` legt [`local_login_roles.sql`](../database/scripts/local_login_roles.sql) beim ersten Start mit an, mit den lokalen Passwörtern aus der `.env.example`. Für eine Datenbank aus der Zeit davor einmal von Hand (ein zweiter Lauf schadet nicht):

```bash
docker exec nf-pg18 psql -U postgres -d wiki -v ON_ERROR_STOP=1 -f /scripts/local_login_roles.sql
```

### Starten

Jede App in einem eigenen Terminal, sie laden sich bei Änderungen selbst neu:

```bash
pnpm dev:api
```

```bash
pnpm dev:worker
```

```bash
pnpm dev:collab
```

```bash
pnpm dev:web
```

Prüfen:

```bash
curl -s localhost:4000/api/v1/health
```

Erwartet: `{"status":"ok","database":{"login":"wiki_api"}}`. `curl -s localhost:4000/api/v1/tenants/alpenwerk` liefert Mandanten-ID, Name und `idpOrgId: org-alpenwerk`.

**Wie die Apps laufen:** Node 24 führt TypeScript direkt aus und streicht dabei nur die Typen weg; für API, Worker und Collab-Server gibt es deshalb keinen Build-Schritt. Erlaubt ist nur Syntax, die sich so wegstreichen lässt (keine `enum`, `namespace` oder Parameter-Properties, `erasableSyntaxOnly` in [`tsconfig.base.json`](../tsconfig.base.json)), und relative Importe mit Endung `.ts`. `tsc` prüft nur. Das Frontend baut Next.js selbst.

### Anmelden

Die API meldet über Zitadel an und hält die Sitzung selbst ([CONCEPTS.md, Abschnitt 5](CONCEPTS.md#5-login-und-sitzung)). Das Frontend leitet `/api` an die API weiter (`rewrites` in [`next.config.ts`](../apps/web/next.config.ts)), so wie später der Ingress: Für den Browser liegen beide unter `http://localhost:3000`, das Sitzungs-Cookie gilt für beide, und es braucht kein CORS.

1. `pnpm dev:api` und `pnpm dev:web` starten (für den Editor zusätzlich `pnpm dev:collab` und `pnpm dev:worker`), `http://localhost:3000` öffnen.
2. Mandant eingeben (`alpenwerk`), „Anmelden“: Das Formular geht an `GET /api/v1/auth/login?tenant=alpenwerk`. Die API leitet zu Zitadel weiter (Code-Flow mit PKCE, Scope auf die Organisation des Mandanten beschränkt) und merkt sich State, Nonce und PKCE-Verifier zehn Minuten lang im signierten Cookie `nf_login`.
3. Bei Zitadel anmelden, z. B. als `peter.forster@alpenwerk.example` mit `NoteFieber-lokal-1`.
4. Zitadel springt zu `/api/v1/auth/callback` zurück. Die API tauscht den Code (mit Client-Geheimnis), prüft das ID-Token und dass die Organisation zum Mandanten passt, sucht die Person über `idp_subject` und legt mit `app.create_session` eine Sitzung an. Der Browser bekommt nur das Cookie **`nf_session`** (`HttpOnly`, `SameSite=Lax`, auf dem Server zusätzlich `Secure`); die Tokens von Zitadel bleiben auf dem Server und werden nicht gespeichert.
5. `GET /api/v1/auth/me` liefert die angemeldete Person; „Abmelden“ ruft `POST /api/v1/auth/logout` (löscht die Sitzung), löscht im Browser alle lokalen Kopien von Seiten (IndexedDB-Datenbanken `nf:…`) und leitet zur Abmeldung bei Zitadel weiter, mit dem ID-Token aus dem Login als `id_token_hint`.

Regeln, die die API dabei durchsetzt:

- **Neue Personen nur über eine Einladung** ([unten](#einladungen)). Ohne Einladung endet die Anmeldung einer Person, die es im Mandanten nicht gibt, mit „noch kein Zugang“ (`?loginError=no_account`), statt ein Konto ohne Workspace anzulegen.
- **Sitzung in der Datenbank** (Tabelle `sessions`, nur der SHA-256-Hash des Tokens): Abmelden und Deaktivieren (`app.set_user_active`) löschen sie, beides wirkt sofort. Gültig `SESSION_HOURS` Stunden (Standard 12).
- **Kein Cross-Site-Missbrauch:** Ändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) nimmt die API nur an, wenn `Origin` (sonst `Referer`) zu `PUBLIC_URL` passt.
- **Rücksprung nur auf die eigene Adresse:** `returnTo` muss ein Pfad sein (`/…`), sonst geht es auf `/`.

Fehler beim Login führen auf die Startseite mit `?loginError=…` zurück: `unknown_tenant`, `login_failed`, `wrong_organization`, `no_account`, `deactivated`, `expired` (länger als zehn Minuten oder Cookie fehlt), `unavailable` (Zitadel nicht erreichbar), dazu für Einladungen `invite_invalid`, `invite_email_mismatch` und `invite_other_login`.

**Von Hand prüfen:** [`scripts/check-login.mjs`](../scripts/check-login.mjs) spielt den ganzen Ablauf mit Peter durch, dazu die Fehlerfälle. API und Frontend müssen laufen:

```bash
node scripts/check-login.mjs "$(docker compose exec -T zitadel-init cat /zitadel/bootstrap/login-client.pat)"
```

Erwartet: nur Zeilen mit `OK`, dann `Alle Prüfungen bestanden.` Beim ersten Lauf lädt das Skript Nina ein und meldet sie damit an; danach ist sie Mitglied von Alpenwerk, und spätere Läufe prüfen nur noch ihren normalen Login. Das Skript meldet sich bei Zitadel über die Session-API an (wie die Anmeldeseiten selbst), deshalb braucht es das Token von `login-client`.

### Spaces und Seitenbaum

Nach dem Anmelden zeigt `http://localhost:3000` die eigenen Spaces und „Neuer Space“. Ein Space öffnet sich unter `/spaces/<schlüssel>` (klein geschrieben, z. B. `/spaces/entw`; gespeichert und angezeigt wird `ENTW`), eine Seite unter `/spaces/entw/pages/<titel>-<kurze id>`, z. B. `/spaces/entw/pages/architektur-034uANlqQWodlcQ4FIOXYJ`. Die kurze ID ist die UUID der Seite in Base62 (22 Zeichen, [`urls.ts`](../packages/shared/src/urls.ts)); der Titel davor ist nur zum Lesen. Alte Links mit altem Titel oder großem Schlüssel funktionieren weiter, das Frontend zieht die Adresse dann nach. Die API selbst arbeitet mit UUIDs und nimmt Schlüssel in beiden Schreibweisen an. In der Seitenleiste: Space-Umschalter, „+ Neue Seite“ (unter der Startseite), der Eintrag „Startseite“, der Baum und der Papierkorb. Wie in Confluence steht die Startseite selbst nicht im Baum; der Baum beginnt mit ihren Unterseiten, „Ausrücken“ geht deshalb nur bis zu dieser obersten Ebene. Fährt man über eine Seite (oder springt mit der Tab-Taste hinein), erscheinen die Knöpfe: neue Unterseite, nach oben, nach unten, einrücken (unter die vorige Seite), ausrücken (hinter die Elternseite), in den Papierkorb. Wer nur liest, sieht keine Knöpfe. Drag & Drop kommt mit M2.

Die API dazu (alle nur mit Sitzung):

| Anfrage | Was | Funktion in der Datenbank |
|---|---|---|
| `GET /api/v1/workspaces` | eigene Workspaces | – |
| `GET /api/v1/spaces` | sichtbare Spaces mit eigener Rolle | – (RLS) |
| `POST /api/v1/spaces` | Space anlegen: `key`, `name`, optional `workspaceId` (nötig bei mehreren Workspaces), `workspaceAccess` (Standard `viewer`) | `app.create_space` |
| `GET /api/v1/spaces/:key` | ein Space | – |
| `GET /api/v1/spaces/:key/pages` | Seitenbaum, flach, sortiert nach `position, id`, mit eigener Rolle und `restricted` | – (RLS, `app.page_role`) |
| `GET /api/v1/spaces/:key/trash` | Papierkorb (die gemeinsam gelöschten Wurzeln) | – |
| `POST /api/v1/spaces/:key/pages` | Seite anlegen: `parentId` (`null` = oberste Ebene), `title`, optional `afterId` | `app.create_page` |
| `GET /api/v1/pages/:id` | Seite mit Brotkrume (nur lesbare Vorfahren) | – |
| `POST /api/v1/pages/:id/move` | verschieben: `parentId`, dazu `afterId` oder `beforeId` (sonst ans Ende) | `app.move_page` |
| `DELETE /api/v1/pages/:id` | in den Papierkorb, mit Unterseiten | `app.trash_page` |
| `POST /api/v1/pages/:id/restore` | aus dem Papierkorb zurück | `app.restore_page` |
| `POST /api/v1/pages/:id/title` | umbenennen: `title` (Leerraum außen fällt weg, über 255 Zeichen gekürzt); nur Bearbeitende, nicht im Papierkorb | – (`app.page_role`, dann interner Aufruf an den Collab-Server, der `app.store_ydoc` schreibt) |

Rechte prüft die Datenbank: Seiten, die die Person nicht sehen darf, fehlen im Baum, und was sie nicht ändern darf, lehnen die Funktionen ab (`403`; fachliche Regeln wie „nicht unter die eigene Unterseite“ oder „Startseite nicht löschen“ mit `409` und Meldung). Positionen rechnet die API mit dem Paket `fractional-indexing` aus den sichtbaren Nachbarn ([`positions.ts`](../apps/api/src/positions.ts)); dieselben Schlüssel erzeugt `app.next_position` in der Datenbank.

### Einladungen

Neue Personen kommen über einen Einladungslink in einen Workspace (E02). E-Mails verschickt NoteFieber noch nicht; den Link gibt die einladende Person selbst weiter.

1. **Einladen:** Owner und Admins eines Workspaces (und Organisations-Admins) sehen auf der Startseite den Bereich „Einladungen“: E-Mail-Adresse, Rolle (Mitglied, Admin, Gast), „Einladen“. Der Link (`/invite/<token>`, sieben Tage gültig) erscheint **nur dieses eine Mal**; in der Datenbank steht nur der Hash des Tokens. Darunter die Liste mit Status (offen, angenommen, zurückgenommen, abgelaufen) und „Zurücknehmen“.
2. **Annehmen:** Der Link zeigt, wer in welchen Workspace einlädt und für welche Adresse. „Annehmen und anmelden“ führt über `/api/v1/auth/login?invite=<token>` zu Zitadel; den Mandanten nimmt die API aus der Einladung.
3. **Beim Rücksprung** nimmt die API die Einladung an (`app.accept_invite`), aber nur, wenn die **bestätigte E-Mail aus dem Login** zur Einladung passt. Die Person wird angelegt und Mitglied; gab es sie schon ohne Login, wird das Login verknüpft. Die Einladung gilt danach nicht mehr.

Wichtig: **Das Konto in Zitadel muss es schon geben**, in der Organisation des Mandanten. NoteFieber spricht mit Zitadel nur über OIDC und legt dort keine Konten an; beim Kunden entstehen sie über das Firmen-Login (SSO, z. B. Entra ID) oder eine Admin legt sie in Zitadel an. Lokal gibt es dafür **Nina Neu** (`nina.neu@alpenwerk.example`, `NoteFieber-lokal-1`): in Zitadel, aber nicht im Wiki. Zum Ausprobieren als Peter Nina einladen, abmelden, den Link öffnen und als Nina anmelden.

| Anfrage | Was | Wer |
|---|---|---|
| `GET /api/v1/workspaces/:id/invites` | Einladungen des Workspaces mit Status | Workspace-Admins |
| `POST /api/v1/workspaces/:id/invites` | einladen: `email`, `role` (`member`, `admin`, `guest`), optional `days` (1–30); liefert den Link einmal | Workspace-Admins |
| `DELETE /api/v1/invites/:id` | zurücknehmen, solange nicht angenommen | Workspace-Admins |
| `GET /api/v1/invites/:token` | Angaben zum Link (Mandant, Workspace, E-Mail, Rolle, wer einlädt) | alle mit dem Link, ohne Anmeldung |

Wer schon Mitglied ist, wird nicht noch einmal eingeladen (`409`). Die Rechte prüft die Datenbank (Regel auf `invites`); jede Einladung und Rücknahme steht im Audit-Log (`invite.created`, `invite.revoked`, `invite.accepted`).

### API-Tests gegen die Datenbank

[`*.dbtest.ts`](../apps/api/src/routes/spaces.dbtest.ts) starten die API und prüfen gegen eine echte Datenbank mit den Testdaten, was Personen sehen und tun dürfen (Peter, Lukas, Max, Gast Elena). Angemeldet wird direkt über `app.create_session`, ohne Zitadel. Die Tests legen Spaces an, die sich nicht löschen lassen; sie laufen deshalb nie gegen `nf-pg18`, sondern gegen einen Wegwerf-Container, der sich mit denselben Init-Skripten einrichtet:

```bash
export MSYS_NO_PATHCONV=1
docker run -d --name nf-pg18-apitest -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD=probe -v "$(pwd -W)/database/scripts:/scripts:ro" -v "$(pwd -W)/docker/postgres/initdb:/docker-entrypoint-initdb.d:ro" postgres:18.6
```

Nach etwa 20 Sekunden (`docker logs nf-pg18-apitest` zeigt `Testdaten eingespielt`):

```bash
API_TEST_DATABASE_URL=postgres://wiki_api:api-lokal@localhost:55433/wiki WORKER_TEST_DATABASE_URL=postgres://wiki_jobs:jobs-lokal@localhost:55433/wiki COLLAB_TEST_DATABASE_URL=postgres://wiki_collab:collab-lokal@localhost:55433/wiki pnpm test:db
```

Erwartet: API mit Worker `pass 19`, Collab-Server `pass 14`, jeweils `fail 0` (Spaces und Seitenbaum, Einladungen, Annehmen beim Login mit erfundenen Identitäten statt Zitadel; beim Worker Testdaten zu Yjs, Ableiten nach der Ruhezeit, Weiterbearbeiten während des Ableitens; beim Collab-Server Ablehnungen, gemeinsames Bearbeiten mit lesender und schreibender Verbindung, Titel neuer Seiten beim Wiederöffnen mit lokaler Kopie, Seiten aus BlockNote-JSON, Papierkorb; Rechteentzug, Papierkorb und Abmelden bei offenen Verbindungen, regelmäßige Prüfung, Abriss der LISTEN-Verbindung). Die Collab-Tests starten einen eigenen Server auf einem freien Port und brauchen beide Verbindungen: `COLLAB_TEST_DATABASE_URL` für den Server, `API_TEST_DATABASE_URL` für Sitzungen und Seiten. Danach `docker rm -f nf-pg18-apitest`. Ohne `API_TEST_DATABASE_URL` überspringt `pnpm test:db` die Tests mit einem Hinweis. (`$(pwd -W)` ist der Pfad in Git Bash; unter macOS und Linux `$(pwd)`.)

### Lasttest des Collab-Servers

[`load-test.ts`](../apps/collab/src/load-test.ts) prüft die Abnahme aus E04: viele Personen bearbeiten eine Seite gleichzeitig, ohne dass etwas verloren geht (ROADMAP M1, ARCHITECTURE_REVIEW A-04). Es startet einen Collab-Server mit der Entprellung aus dem Betrieb (2 s, spätestens 10 s) gegen die Wegwerf-Datenbank aus dem vorigen Abschnitt, verbindet die Clients über WebSocket (je eigene Sitzung) mit einer neuen Seite in `ENTW` und lässt jeden alle 300 ms ein eindeutiges Stück Text an eine zufällige Stelle tippen, mit Cursor in der Awareness. Am Ende prüft es, dass alle Clients gleich sind und jedes Stück genau einmal im gespeicherten Yjs-Zustand steht, und meldet Laufzeit der Änderungen, Dauer jedes Speicherns und die WAL-Menge (`pg_current_wal_lsn`). Die Seite landet danach im Papierkorb.

```bash
API_TEST_DATABASE_URL=postgres://wiki_api:api-lokal@localhost:55433/wiki COLLAB_TEST_DATABASE_URL=postgres://wiki_collab:collab-lokal@localhost:55433/wiki pnpm --filter @notefieber/collab load-test
```

Einstellbar mit `LOAD_CLIENTS` (50), `LOAD_SECONDS` (60) und `LOAD_INTERVAL_MS` (300). Ergebnis am 19. November 2026 (Windows-Rechner, PostgreSQL im Docker-Container):

| Messung | Wert |
|---|---|
| Last | 50 Clients, 60 s, 9.613 Stücke (160 Änderungen pro Sekunde) |
| Datenverlust | keiner: 9.613 gespeichert, alle verschieden; alle Clients 0,3 s nach Tippende gleich |
| Laufzeit einer Änderung zu einem anderen Client | p50 11 ms, p95 35 ms, max 111 ms |
| Speichern | 6-mal (bei Dauertippen greift `maxDebounce`: alle 10 s), je 64–71 ms, keine Fehler |
| Yjs-Zustand | 203 KB am Ende |
| WAL | 0,4 MB gesamt, 0,4 MB pro Minute |

Grenzen: Server und Clients laufen in einem Prozess (Speicher zusammen 390 MB, Latenzen enthalten die Arbeit der Clients). Getestet ist Dauertippen auf einer Seite; tippt jemand in Schüben mit Pausen über 2 s, speichert der Server bis zu 30-mal pro Minute, die WAL-Menge wächst dann mit der Größe des Yjs-Zustands (PostgreSQL komprimiert ihn). Viele gleichzeitig bearbeitete Seiten und große Seiten (MB-Bereich) sind noch nicht gemessen; das gehört zur Überwachung im Pilot (A-12, Alarm bei zu großen Yjs-Dokumenten).

### Prüfen wie in der CI

```bash
pnpm check
```

Das sind nacheinander: `pnpm lint` (ESLint, eine Konfiguration für alles in [`eslint.config.mjs`](../eslint.config.mjs), die Next.js-Regeln nur für `apps/web`), `pnpm format:check` (Prettier; `pnpm format` formatiert), `pnpm typecheck` (alle Pakete), `pnpm test` (Unit-Tests mit dem Test-Runner von Node, Dateien `*.test.ts`, ohne Datenbank), `pnpm licenses:check` und `pnpm build`. Der CI-Job `apps` in [`.gitlab-ci.yml`](../.gitlab-ci.yml) führt genau das aus, im Image `node:24.18.1`.

**Lizenzprüfung** ([`scripts/check-licenses.mjs`](../scripts/check-licenses.mjs)): Der eigene Code ist proprietär ([`LICENSE`](../LICENSE)). Abgelehnt werden starke Copyleft-Lizenzen (GPL, AGPL, SSPL, EUPL), alle `@blocknote/xl-*`-Pakete und unbekannte Lizenzen; LGPL nur für geprüfte Pakete, derzeit `@img/sharp-*` (libvips, von Next.js für Bilder). Eine neue Ausnahme kommt mit Begründung in das Skript.

**Versionen:** alle Pakete mit fester Version. TypeScript bleibt vorerst auf 6.0 und ESLint auf 9, weil `typescript-eslint` TypeScript 7 und die Regeln von Next.js ESLint 10 noch nicht unterstützen.

**`apps/web/AGENTS.md`** schreibt `next dev` selbst (ein Hinweis für KI-Werkzeuge auf die Doku von Next.js in `node_modules/next/dist/docs/`). Die Datei ist im Repository, damit sie nicht bei jedem Start als Änderung auftaucht.

## 8. Alltag: starten, stoppen, neu anfangen

Alle Befehle im Hauptordner des Repositorys; sie gelten für alle Bausteine zusammen.

Anhalten und weitermachen (die Daten bleiben in den Volumes):

```bash
docker compose stop
```

```bash
docker compose start
```

Logs ansehen:

```bash
docker compose logs --tail 50 postgres
```

```bash
docker compose logs --tail 50 garage garage-init
```

```bash
docker compose logs --tail 50 zitadel zitadel-login zitadel-init
```

**Alles neu** (Container und alle Daten weg, auch die Dateien in Garage und die Zitadel-Instanz; danach Ersteinrichtung mit frischem Schema, Testdaten, leerem Bucket und neuer Zitadel-Instanz mit neuen Client-IDs). Danach muss das [Passwort von `wiki_owner`](#passwort-für-wiki_owner) neu gesetzt werden. Nur die Datenbank neu: [Datenbank zurücksetzen](#datenbank-zurücksetzen); nur Zitadel neu: [Zitadel zurücksetzen](#zitadel-zurücksetzen).

```bash
docker compose down -v
```

```bash
docker compose up -d --wait
```

**Alles entfernen** (Container, Netzwerk und Daten):

```bash
docker compose down -v
```

Ohne `-v` bleiben die Volumes (`notefieber-pgdata` mit den Datenbanken `wiki` und `zitadel`, `notefieber-garage-meta`, `notefieber-garage-data`, `notefieber-zitadel-bootstrap`) mit den Daten erhalten; ein späteres `docker compose up` nimmt sie wieder auf.

## 9. Fehlerbehebung

### Allgemein

| Meldung | Ursache und Abhilfe |
|---|---|
| `failed to connect to the docker API` / `Cannot connect to the Docker daemon` | Docker läuft nicht. Docker Desktop starten und warten, bis es bereit ist. |
| `psql: error: C:/Program Files/Git/scripts/…: No such file or directory` oder `exec: "C:/Program Files/Git/garage": … no such file` | Git Bash hat den Pfad umgewandelt. `export MSYS_NO_PATHCONV=1` vergessen ([Abschnitt 2](#2-voraussetzungen)). |
| `$'\r': command not found` (Init-Skript oder Nebenläufigkeitstest) | Windows-Zeilenenden im Skript, siehe [Abschnitt 2](#2-voraussetzungen). Betrifft es ein Init-Skript, danach `docker compose down -v` und neu starten. |

### Datenbank

| Meldung | Ursache und Abhilfe |
|---|---|
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | Auf dem Rechner läuft schon ein PostgreSQL (oder noch der alte `docker run`-Container, siehe [Umstieg](#umstieg-vom-früheren-docker-run)). Sonst anderen Port wählen (`NF_PG_PORT=5433` in `.env`) und in der IDE anpassen. |
| `Conflict. The container name "/nf-pg18" is already in use` | Der Container aus dem früheren `docker run` läuft noch. `docker rm -f nf-pg18`, die Daten bleiben im Volume ([Umstieg](#umstieg-vom-früheren-docker-run)). |
| `volume "notefieber-pgdata" already exists but was not created by Docker Compose` | Harmlos: Das Volume stammt aus dem früheren `docker run`, Compose nutzt es weiter. |
| `docker compose up --wait` endet mit `container nf-pg18 is unhealthy` oder `exited` | Die [Ersteinrichtung](#ersteinrichtung-rollen-datenbank-schema) ist gescheitert. `docker logs nf-pg18` zeigt nach `NoteFieber: …` den Fehler. Beheben, dann `docker compose down -v` und neu starten. |
| `role "wiki_owner" does not exist` | `roles_database.sql` fehlt ([Ersteinrichtung](#ersteinrichtung-rollen-datenbank-schema)). |
| `Rollen wiki_app und wiki_worker fehlen: zuerst roles_database.sql ausführen` | Ebenso: erst `roles_database.sql`, dann das Schema. |
| `database "wiki" already exists` | `roles_database.sql` wurde schon einmal ausgeführt. Zum Neuaufsetzen zuerst die [Datenbank zurücksetzen](#datenbank-zurücksetzen). |
| `relation "…" already exists` beim Schema | `schema.sql` wurde von Hand auf eine Datenbank gespielt, die das Schema schon hat. Das Schema kommt über `migrate.sh`, das nur Fehlendes einspielt. Geändert wurde nichts (eine Transaktion). |
| `migrate.sh: Das Schema wurde ohne Migrationen eingespielt` | Die Datenbank stammt aus der Zeit vor den Migrationen (vor dem 8. November 2026, mit `schema.sql` eingespielt) und hat keine Buchführung. Einmal die [Datenbank zurücksetzen](#datenbank-zurücksetzen); das Passwort von `wiki_owner` bleibt. |
| `migrate.sh: … wurde nach dem Einspielen geändert` | Eine schon eingespielte Migration wurde bearbeitet. Die Änderung rückgängig machen und als neue Migration schreiben. Nur lokal und nur mit Testdaten: alternativ die Datenbank zurücksetzen. |
| `migrate.sh: nicht als Superuser einspielen` | `migrate.sh` lief als `postgres`. Immer als `wiki_owner` (Standard im Container). |
| Fehlermeldungen beginnen mit `psql:/scripts/schema/60_functions_pages.sql:42:` | So soll es sein: Die Meldung nennt den Teil und die Zeile, in der der Fehler steckt. |
| `syntax error at or near "\"` oder `\ir` wird nicht erkannt | `schema.sql` wurde nicht mit `psql` ausgeführt, z. B. über „Run“ in der IDE. `\ir` ist ein Befehl von `psql`; das Schema immer mit `psql` einspielen. |
| `Testdaten sind schon eingespielt (Mandant alpenwerk vorhanden)` | `seed.sql` lief schon. Zum Neuaufsetzen die [Datenbank zurücksetzen](#datenbank-zurücksetzen) und Migrationen und Testdaten neu einspielen. |
| `function app.… does not exist` beim Einspielen der Testdaten | Die Datenbank hat einen älteren Stand des Schemas, oder `seed.sql` wurde nach einer Schemaänderung nicht mitgezogen. |
| `password authentication failed for user "wiki_owner"` in der IDE | Passwort noch nicht gesetzt oder falsch (nach `docker compose down -v` neu nötig), siehe [Passwort für `wiki_owner`](#passwort-für-wiki_owner). |
| In der IDE fehlen die Funktionen | Das Schema `app` ist in der Verbindung nicht ausgewählt, siehe [Mit der IDE verbinden](#mit-der-ide-verbinden). |
| Ein Test meldet `ERROR: …` mit `CONTEXT: … at ASSERT` | Ein Test ist fehlgeschlagen; die Meldung nennt, was nicht stimmt. Die Datenbank ist unverändert (Rollback). |
| Die Tests finden Funktionen oder Spalten nicht, die es im Schema gibt | Die Datenbank hat einen älteren Stand des Schemas. Zurücksetzen und neu einspielen. |

### Garage

| Meldung | Ursache und Abhilfe |
|---|---|
| `Bind for 127.0.0.1:3900 failed: port is already allocated` | Ein anderer S3-Speicher (z. B. MinIO) belegt den Port. `NF_S3_PORT=3910` in `.env` und den Endpunkt in den Apps anpassen. |
| `docker compose up --wait` endet mit `garage-init` „unhealthy“ oder `exited (1)` | Die [Einrichtung](#einrichtung-beim-start) ist gescheitert. `docker compose logs garage-init` zeigt, welcher Schritt (Layout, Schlüssel, Bucket). Häufig: eine selbst gesetzte Schlüssel-ID ohne `GK` und 24 Hexziffern. |
| `Garage: Schlüssel nicht importiert: … KeyAlreadyExists` mit anderem Geheimnis | Ein Schlüssel mit dieser ID existierte schon mit anderem Geheimnis (z. B. nach einer Änderung in `.env`). Neue ID wählen oder mit `docker compose down -v` neu anfangen. |
| S3 antwortet `SignatureDoesNotMatch` | Region nicht `garage`, falsches Geheimnis, oder der Client nutzt den virtuellen Host-Stil: `forcePathStyle: true` setzen. |
| S3 antwortet `403` bzw. `AccessDenied` | Ohne oder mit falschem Schlüssel angefragt. [Werte für die Apps](#werte-für-die-apps) prüfen. |

### Zitadel

| Meldung | Ursache und Abhilfe |
|---|---|
| `Bind for 127.0.0.1:8080 failed: port is already allocated` | Ein anderer Dienst belegt 8080. `NF_ZITADEL_PORT=8081` in `.env`; weil der Port im Issuer steckt, danach [Zitadel zurücksetzen](#zitadel-zurücksetzen). |
| `docker compose up --wait` endet mit `nf-zitadel` „unhealthy“, im Log `password authentication failed for user "postgres"` | `POSTGRES_PASSWORD` passt nicht zum Passwort im Volume (z. B. aus dem früheren `docker run` mit anderem Passwort). Das richtige Passwort in `.env` eintragen oder es angleichen: `docker exec -it nf-pg18 psql -U postgres -c "\password postgres"`. |
| Im Log von `nf-zitadel` Fehler zum Masterkey oder `cipher` | Der Masterkey wurde nach dem ersten Start geändert. Alten Wert zurück oder [Zitadel zurücksetzen](#zitadel-zurücksetzen). |
| `zitadel-init` „unhealthy“ oder `exited (1)` | `docker compose logs zitadel-init` zeigt den Schritt und die Antwort von Zitadel. Häufig nach einem halben Zurücksetzen (Datenbank weg, Volume noch da oder umgekehrt): [vollständig zurücksetzen](#zitadel-zurücksetzen). |
| Browser zeigt `Instance not found` oder `unable to set instance using origin` | Über `127.0.0.1` statt `localhost` aufgerufen. Zitadel erkennt die Instanz am Hostnamen: immer `http://localhost:8080`. |
| Anmeldung endet mit `redirect_uri is missing in the client configuration` | Die API nutzt eine andere Redirect-URL als `http://localhost:3000/api/v1/auth/callback` (etwa mit anderem `PUBLIC_URL`). In der Console im Projekt NoteFieber beim Client `notefieber-login` ergänzen, oder `NF_WEB_URL` setzen und [Zitadel zurücksetzen](#zitadel-zurücksetzen). |
| Anmeldung als Testperson scheitert mit falschem Passwort | Die Person wurde mit einem anderen `NF_TEST_PASSWORD` angelegt (gilt nur beim Anlegen). In der Console das Passwort setzen oder [Zitadel zurücksetzen](#zitadel-zurücksetzen). |

### Apps

| Meldung | Ursache und Lösung |
|---|---|
| `pnpm: command not found` bzw. „pnpm is not recognized“ | corepack ist noch nicht eingeschaltet: `corepack enable` ([Abschnitt 7](#einrichten)). Ohne Administrator unter Windows: `corepack enable --install-directory <ordner im PATH>`. |
| `API_DATABASE_URL fehlt …` (ZodError beim Start) | Keine `.env`: `cp .env.example .env`. |
| `OIDC_ISSUER fehlt …` oder `AUTH_COOKIE_SECRET fehlt …` | `.local/zitadel.env` fehlt (Zitadel läuft nicht oder `zitadel-init` ist noch nicht durch) bzw. die `.env` ist älter als die Vorlage: neu kopieren. |
| Nach „Anmelden“ `?loginError=unavailable` | Zitadel ist nicht erreichbar (`docker compose up -d --wait`). Die API versucht es beim nächsten Login erneut. |
| `?loginError=no_account` | Die Person gibt es in Zitadel, im Mandanten aber nicht (noch keine Einladungen). Mit einer Testperson aus `seed.sql` anmelden. |
| `?loginError=expired` gleich nach der Anmeldung | Das Cookie `nf_login` kam nicht zurück: Frontend über eine andere Adresse aufgerufen als `PUBLIC_URL` (z. B. `127.0.0.1` statt `localhost`). |
| `{"error":"cross_origin"}` bei `POST` | Die Anfrage kam nicht von `PUBLIC_URL` (fehlender oder fremder `Origin`). Aus dem Frontend heraus aufrufen, mit `curl` den Header `-H "Origin: http://localhost:3000"` setzen. |
| `password authentication failed for user "wiki_api"` oder `role "wiki_api" does not exist` | Die Login-Rollen fehlen (Datenbank aus der Zeit davor): `local_login_roles.sql` von Hand ausführen ([Abschnitt 7](#einrichten)). |
| `Datenbank: Datenbankrolle … ist Superuser oder Eigentümer` | Eine Datenbank-URL in der `.env` nutzt `postgres` oder `wiki_owner`. Die Werte aus der `.env.example` nehmen. |
| `EADDRINUSE` | Der Port ist belegt, meist läuft die App schon in einem anderen Terminal. Anderen Port in der `.env` setzen (`API_PORT`, `COLLAB_PORT`) oder die andere Instanz beenden. |
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` oder `… only supported in strip-only mode` | Syntax, die Node nicht einfach wegstreichen kann (`enum`, `namespace`, Parameter-Properties). Umschreiben, z. B. `as const`-Objekte statt `enum`. |
| `Cannot find module './…'` beim Start | Relativer Import ohne Endung. In den Node-Apps immer mit `.ts` importieren. |

## 10. Was noch dazukommt

Mit den nächsten Schritten aus der `CLAUDE.md` (Abschnitt 13) und Stufe 1 der [ROADMAP](ROADMAP.md) wächst die lokale Umgebung:

- **Fachlogik in den Apps:** Login über OIDC in der API (E03), Spaces und Seitenbaum per API (M0), Hocuspocus mit `onAuthenticate`, `onLoadDocument` und `onStoreDocument` (E04), Aufgaben im Worker mit pg-boss. Die Zitadel-Werte lesen die Apps dann aus [`.local/zitadel.env`](#werte-für-die-apps-1).
- **Container-Images** für die Apps (Next.js als `output: standalone`) mit den K3s-Manifesten.
- Weitere Quellen für Gruppen: SCIM (E17) und ein Gruppen-Claim im Token, etwa aus Entra ID (E03). Bis dahin gibt es Gruppen nur im Wiki ([Abschnitt 6](#wie-zitadel-und-das-datenmodell-zusammenpassen)).
- **k3d** erst, wenn die K3s-Manifeste entstehen (`CLAUDE.md`, Abschnitt 13, Schritt 3): Dann lassen sie sich lokal prüfen. Für die tägliche Arbeit bleibt Compose.

Diese Anleitung wird mit jedem dieser Schritte ergänzt.
