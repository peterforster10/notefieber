# Lokale Entwicklung einrichten

Diese Anleitung beschreibt, was man für die Entwicklung am eigenen Rechner braucht und wie man die Umgebung aufsetzt. Sie gilt für Windows (mit Git Bash), macOS und Linux.

## Inhalt

1. [Was es heute gibt](#1-was-es-heute-gibt)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Repository holen](#3-repository-holen)
4. [PostgreSQL 18 starten](#4-postgresql-18-starten)
5. [Rollen, Datenbank und Schema einspielen](#5-rollen-datenbank-und-schema-einspielen)
6. [Tests ausführen](#6-tests-ausführen)
7. [Mit der IDE verbinden](#7-mit-der-ide-verbinden)
8. [Das Schema ändern](#8-das-schema-ändern)
9. [Alltag: starten, stoppen, zurücksetzen](#9-alltag-starten-stoppen-zurücksetzen)
10. [Fehlerbehebung](#10-fehlerbehebung)
11. [Was noch dazukommt](#11-was-noch-dazukommt)

---

## 1. Was es heute gibt

Das Projekt steht am Anfang von Stufe 1 der [ROADMAP](ROADMAP.md). Lokal lauffähig ist bisher nur die Datenbank.

| Baustein | Stand | Lokal |
|---|---|---|
| Datenbank (`database/scripts`) | fertig, mit Tests | PostgreSQL 18 im Docker-Container |
| Frontend, API, Collab-Server, Worker (`apps/…`) | geplant | später Node.js direkt auf dem Rechner |
| Zitadel (Login), Garage (Dateien) | geplant | später Docker Compose oder k3d |

Wer heute mitarbeitet, braucht also Git, Docker und eine Bash. Node.js wird erst mit den Apps nötig, lohnt sich aber gleich mit zu installieren.

## 2. Voraussetzungen

| Was | Version | Wofür | Hinweise |
|---|---|---|---|
| **Git** | aktuell | Repository | Unter Windows „Git for Windows“, bringt Git Bash mit. |
| **Docker** | Docker Desktop (Windows, macOS) oder Docker Engine (Linux) | PostgreSQL 18, später Zitadel und Garage | Docker 4 GB Arbeitsspeicher geben, später mit Zitadel eher 6–8 GB. |
| **Bash** | 4 oder neuer | `schema_concurrency_test.sh` | Unter Windows Git Bash, unter macOS und Linux die vorhandene Shell. |
| **Node.js** | 24 (LTS) mit npm | später die Apps; jetzt schon für Prüfungen gegen npm-Pakete | Am einfachsten über einen Versionsmanager (`fnm`, `nvm`, `nvm-windows`). |
| **IDE** | z. B. IntelliJ IDEA Ultimate oder DataGrip, VS Code | Code und Datenbank | Ein Datenbank-Werkzeug in der IDE erleichtert das Ansehen von Tabellen und Abfragen. |
| `psql` (optional) | 18 | Datenbank vom Rechner aus | Nicht nötig: Alle Befehle unten laufen mit `docker exec` über das `psql` im Container. |

**Windows:** Alle Befehle unten sind für **Git Bash** geschrieben. Zwei Dinge sind dort anders:

- Git Bash wandelt Pfade wie `/scripts/…` in Windows-Pfade um, was `docker exec` durcheinanderbringt. Deshalb steht vor den Befehlen `export MSYS_NO_PATHCONV=1` (einmal pro Shell genügt).
- Shell-Skripte brauchen Unix-Zeilenenden (LF). Wenn Git beim Auschecken in CRLF umwandelt, bricht `schema_concurrency_test.sh` mit `$'\r': command not found` ab. Abhilfe: `git config --global core.autocrlf input` und das Repository neu auschecken.

## 3. Repository holen

```bash
git clone <url-des-repositorys> notefieber
```

```bash
cd notefieber
```

Wichtige Dateien für den Einstieg: `CLAUDE.md` (Entscheidungen und aktueller Stand), [CONCEPTS.md](CONCEPTS.md) (wie alles funktioniert), [SCHEMA.md](SCHEMA.md) (Datenmodell).

## 4. PostgreSQL 18 starten

PostgreSQL läuft in einem Container mit dem offiziellen Image `postgres:18`. Die Skripte aus `database/scripts` werden nur lesend eingebunden, die Daten liegen in einem benannten Volume und überstehen einen Neustart des Containers.

**Git Bash (Windows):**

```bash
export MSYS_NO_PATHCONV=1
docker run -d --name nf-pg18 \
  -e POSTGRES_PASSWORD=postgres-lokal \
  -p 127.0.0.1:5432:5432 \
  -v notefieber-pgdata:/var/lib/postgresql \
  -v "$(pwd -W)/database/scripts:/scripts:ro" \
  postgres:18
```

**macOS und Linux:** derselbe Befehl, aber `$(pwd)` statt `$(pwd -W)` und ohne `export MSYS_NO_PATHCONV=1`.

**PowerShell (falls lieber):**

```powershell
docker run -d --name nf-pg18 -e POSTGRES_PASSWORD=postgres-lokal -p 127.0.0.1:5432:5432 -v notefieber-pgdata:/var/lib/postgresql -v "${PWD}\database\scripts:/scripts:ro" postgres:18
```

Was die Angaben bedeuten:

| Angabe | Bedeutung |
|---|---|
| `--name nf-pg18` | Name des Containers; die Befehle in dieser Anleitung und in der `CLAUDE.md` verwenden ihn. |
| `POSTGRES_PASSWORD` | Passwort des Superusers `postgres` für Verbindungen von außerhalb des Containers. Nur lokal, nie für einen Server verwenden. Innerhalb des Containers (`docker exec`) braucht man kein Passwort. |
| `-p 127.0.0.1:5432:5432` | Port nur auf dem eigenen Rechner öffnen, nicht im Netzwerk. Ist 5432 belegt, z. B. `127.0.0.1:5433:5432`. |
| `-v notefieber-pgdata:/var/lib/postgresql` | Daten im Volume `notefieber-pgdata`. Beim Image `postgres:18` ist das der richtige Pfad (nicht mehr `…/data`). |
| `-v …/database/scripts:/scripts:ro` | Die SQL-Skripte des Repositorys im Container unter `/scripts`, nur lesend. Änderungen am Rechner sind sofort im Container sichtbar. |

Warten, bis die Datenbank bereit ist:

```bash
docker exec nf-pg18 pg_isready -U postgres
```

Erwartet: `/var/run/postgresql:5432 - accepting connections`.

## 5. Rollen, Datenbank und Schema einspielen

**Schritt 1: Rollen und Datenbank** (als Superuser `postgres`). Legt die Rollen `wiki_owner`, `wiki_app` und `wiki_worker` an und die Datenbank `wiki` mit der Locale `C.UTF-8`:

```bash
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -f /scripts/roles_database.sql
```

**Schritt 2: Schema** (als Eigentümer `wiki_owner`, **nie** als `postgres`, sonst liefen alle `SECURITY DEFINER`-Funktionen als Superuser):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -q -f /scripts/schema/schema.sql
```

Ohne Ausgabe heißt: alles eingespielt.

**Schritt 3: Passwort für `wiki_owner`** (nur nötig, um sich von der IDE aus zu verbinden). Das Skript setzt bewusst keine Passwörter:

```bash
docker exec -it nf-pg18 psql -U postgres -c "\password wiki_owner"
```

Die Rollen und Rechte erklärt [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas). Kurz: `wiki_owner` führt nur Migrationen aus und umgeht RLS; die Apps verbinden sich später mit eigenen Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Jobs).

## 6. Tests ausführen

**Funktionstest** (42 Tests für Rechte, Sichtbarkeit und Regeln):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/schema/schema_test.sql
```

Erwartet: `NOTICE: OK 1 …` bis `NOTICE: OK 42 …`, dann `Alle Tests bestanden (zurückgerollt, die Datenbank ist unverändert).` Der Test läuft in einer Transaktion und rollt am Ende zurück. Man kann ihn also beliebig oft wiederholen, und die Datenbank bleibt leer. Bricht ein Test ab, zeigt `ERROR:` den Grund, und die Datenbank ist ebenfalls unverändert.

**Nebenläufigkeitstest** (Sperren im Seitenbaum mit zwei gleichzeitigen Sitzungen, dauert etwa 10 Sekunden):

```bash
PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" bash database/scripts/schema/schema_concurrency_test.sh
```

Erwartet: `OK 1` bis `OK 4`, dann `Alle Nebenläufigkeitstests bestanden`. Dieser Test muss committen und lässt deshalb einen Mandanten `nebenlaeufig-<zeitstempel>` in der Datenbank stehen. Wer das nicht möchte, setzt die Datenbank danach zurück ([Abschnitt 9](#9-alltag-starten-stoppen-zurücksetzen)).

## 7. Mit der IDE verbinden

| Feld | Wert |
|---|---|
| Host | `localhost` |
| Port | `5432` (bzw. der gewählte) |
| Datenbank | `wiki` |
| Benutzer | `wiki_owner` |
| Passwort | aus Schritt 3 |

**Achtung:** Als `wiki_owner` sieht man **alle** Zeilen aller Mandanten, weil der Eigentümer RLS umgeht. Um zu sehen, was eine bestimmte Person sieht, in einer Transaktion die Rolle wechseln und den Kontext setzen:

```sql
BEGIN;
SET LOCAL ROLE wiki_app;
SELECT set_config('app.tenant_id', '<mandanten-id>', true),
       set_config('app.user_id',   '<personen-id>',  true);
SELECT id, title FROM pages ORDER BY position, id;   -- nur, was diese Person lesen darf
ROLLBACK;
```

Mit `SET LOCAL ROLE wiki_worker` und ohne `app.user_id` sieht man, was Collab-Server und Worker sehen: alles im Mandanten.

## 8. Das Schema ändern

Solange es keine Produktivdaten gibt, ist `schema.sql` das vollständige Schema und es gibt noch keine Migrationen. Ein Änderungszyklus sieht so aus:

1. **Test zuerst:** Alles, was Rechte oder Sichtbarkeit berührt, bekommt zuerst einen Test in `schema_test.sql` (Regel aus der `CLAUDE.md`). Die Tests laufen als `wiki_app` bzw. `wiki_worker`.
2. `schema.sql` ändern. Die Regeln für neue Funktionen stehen in der `CLAUDE.md` (Abschnitt 13) und in [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas): Mandant in jeder Abfrage prüfen, `require_actor` zuerst, neue Funktionen ausdrücklich freigeben.
3. Datenbank zurücksetzen und neu einspielen ([Abschnitt 9](#9-alltag-starten-stoppen-zurücksetzen)).
4. Beide Tests ausführen ([Abschnitt 6](#6-tests-ausführen)).
5. [SCHEMA.md](SCHEMA.md) und bei Bedarf `CLAUDE.md` nachziehen.

## 9. Alltag: starten, stoppen, zurücksetzen

Container stoppen und wieder starten (die Daten bleiben im Volume):

```bash
docker stop nf-pg18
```

```bash
docker start nf-pg18
```

Logs ansehen:

```bash
docker logs --tail 50 nf-pg18
```

**Datenbank zurücksetzen** (z. B. nach einer Schemaänderung). Die Rollen bleiben bestehen; die Hinweise `role "wiki_owner" has already been granted membership …` sind harmlos:

```bash
export MSYS_NO_PATHCONV=1
docker exec nf-pg18 psql -U postgres -c "DROP DATABASE IF EXISTS wiki WITH (FORCE)"
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -q -f /scripts/roles_database.sql
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -q -f /scripts/schema/schema.sql
```

Das Passwort von `wiki_owner` bleibt dabei erhalten, es hängt an der Rolle, nicht an der Datenbank.

**Alles entfernen** (Container und Daten):

```bash
docker rm -f nf-pg18
```

```bash
docker volume rm notefieber-pgdata
```

## 10. Fehlerbehebung

| Meldung | Ursache und Abhilfe |
|---|---|
| `failed to connect to the docker API` / `Cannot connect to the Docker daemon` | Docker läuft nicht. Docker Desktop starten und warten, bis es bereit ist. |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | Auf dem Rechner läuft schon ein PostgreSQL. Anderen Port wählen (`-p 127.0.0.1:5433:5432`) und in der IDE anpassen. |
| `psql: error: C:/Program Files/Git/scripts/…: No such file or directory` | Git Bash hat den Pfad umgewandelt. `export MSYS_NO_PATHCONV=1` vergessen. |
| `$'\r': command not found` beim Nebenläufigkeitstest | Windows-Zeilenenden im Skript, siehe [Abschnitt 2](#2-voraussetzungen). |
| `role "wiki_owner" does not exist` | Schritt 1 (`roles_database.sql`) fehlt. |
| `database "wiki" already exists` | `roles_database.sql` wurde schon einmal ausgeführt. Zum Neuaufsetzen zuerst die Datenbank löschen ([Abschnitt 9](#9-alltag-starten-stoppen-zurücksetzen)). |
| `relation "…" already exists` beim Schema | Das Schema ist schon eingespielt. `schema.sql` ist kein Migrationsskript und lässt sich nicht zweimal einspielen; Datenbank zurücksetzen. |
| `password authentication failed for user "wiki_owner"` in der IDE | Passwort noch nicht gesetzt oder falsch, Schritt 3 wiederholen. |
| Ein Test meldet `ERROR: …` mit `CONTEXT: … at ASSERT` | Ein Test ist fehlgeschlagen; die Meldung nennt, was nicht stimmt. Die Datenbank ist unverändert (Rollback). |
| Die Tests finden Funktionen oder Spalten nicht, die es im Schema gibt | Die Datenbank hat einen älteren Stand des Schemas. Zurücksetzen und neu einspielen. |

## 11. Was noch dazukommt

Mit den nächsten Schritten aus der `CLAUDE.md` (Abschnitt 13) und Stufe 1 der [ROADMAP](ROADMAP.md) wächst die lokale Umgebung. Geplant ist:

- **Docker Compose oder k3d** für PostgreSQL 18, Zitadel und Garage, mit denselben Manifesten, die später auf dem Server laufen. Der einzelne Container aus Abschnitt 4 wird dann davon abgelöst.
- **Zitadel** lokal als Login-Dienst, mit einer Test-Organisation als Mandant und je einem OIDC-Client für Frontend und API.
- **Garage** lokal mit dem Bucket `wiki` für Anhänge, Bilder und Import-Archive.
- **Die Apps** (`apps/web`, `apps/api`, `apps/collab`, `apps/worker`, siehe README) laufen mit Node.js direkt auf dem Rechner und verbinden sich mit eigenen Login-Rollen (`wiki_api` in `wiki_app`, `wiki_collab` und `wiki_jobs` in `wiki_worker`), nie als `wiki_owner`.
- Eine `.env.example` mit allen nötigen Einstellungen (Datenbank-URLs, Zitadel, Garage); die echte `.env` kommt nie ins Repository.

Diese Anleitung wird mit jedem dieser Schritte ergänzt.
