# Lokale Entwicklung einrichten

Diese Anleitung beschreibt, was man für die Entwicklung am eigenen Rechner braucht und wie man die Umgebung aufsetzt. Sie gilt für Windows (mit Git Bash), macOS und Linux.

## Inhalt

1. [Was es heute gibt](#1-was-es-heute-gibt)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Repository holen](#3-repository-holen)
4. [PostgreSQL 18 starten](#4-postgresql-18-starten)
5. [Rollen, Datenbank und Schema einspielen](#5-rollen-datenbank-und-schema-einspielen)
6. [Testdaten einspielen](#6-testdaten-einspielen)
7. [Tests ausführen](#7-tests-ausführen)
8. [Mit der IDE verbinden](#8-mit-der-ide-verbinden)
9. [Das Schema ändern](#9-das-schema-ändern)
10. [Alltag: starten, stoppen, zurücksetzen](#10-alltag-starten-stoppen-zurücksetzen)
11. [Fehlerbehebung](#11-fehlerbehebung)
12. [Was noch dazukommt](#12-was-noch-dazukommt)

---

## 1. Was es heute gibt

Das Projekt steht am Anfang von Stufe 1 der [ROADMAP](ROADMAP.md). Lokal lauffähig ist bisher nur die Datenbank.

| Baustein | Stand | Lokal |
|---|---|---|
| Datenbank (`database/scripts`) | fertig, mit Tests | PostgreSQL 18 per Docker Compose (`compose.yaml`), richtet sich beim ersten Start selbst ein |
| Testdaten (`database/scripts/seed`) | fertig | zwei Mandanten mit Personen, Spaces, Seiten und Kommentaren, beim ersten Start automatisch |
| Frontend, API, Collab-Server, Worker (`apps/…`) | geplant | später Node.js direkt auf dem Rechner |
| Zitadel (Login), Garage (Dateien) | geplant | später ebenfalls in `compose.yaml` |

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
- Shell-Skripte brauchen Unix-Zeilenenden (LF), sonst brechen sie mit `$'\r': command not found` ab. Die Datei `.gitattributes` im Repository sorgt dafür, dass Git `*.sh` immer mit LF auscheckt, auch mit `core.autocrlf=true`. Wurde das Repository vor dieser Datei ausgecheckt, die betroffenen Skripte löschen und neu holen, z. B. `rm database/docker/initdb/10-notefieber.sh` und `git checkout -- database/docker/initdb/10-notefieber.sh`.

## 3. Repository holen

```bash
git clone <url-des-repositorys> notefieber
```

```bash
cd notefieber
```

Wichtige Dateien für den Einstieg: `CLAUDE.md` (Entscheidungen und aktueller Stand), [CONCEPTS.md](CONCEPTS.md) (wie alles funktioniert), [SCHEMA.md](SCHEMA.md) (Datenmodell).

## 4. PostgreSQL 18 starten

Die lokale Umgebung beschreibt [`compose.yaml`](../compose.yaml) im Hauptordner des Repositorys. Bisher enthält sie nur PostgreSQL 18 (offizielles Image `postgres:18`); Zitadel und Garage kommen dazu ([Abschnitt 12](#12-was-noch-dazukommt)). Im Hauptordner des Repositorys:

```bash
docker compose up -d --wait
```

`--wait` wartet, bis die Datenbank fertig eingerichtet ist. Beim **ersten Start** (leeres Volume) spielt der Container dabei selbst Rollen, Datenbank, Schema und Testdaten ein ([Abschnitt 5](#5-rollen-datenbank-und-schema-einspielen) und [6](#6-testdaten-einspielen)); das dauert wenige Sekunden. Danach:

```bash
docker compose ps
```

Erwartet: `nf-pg18` mit Status `Up … (healthy)`.

Was `compose.yaml` festlegt:

| Einstellung | Bedeutung |
|---|---|
| Container `nf-pg18` | Die Befehle in dieser Anleitung und in der `CLAUDE.md` verwenden diesen Namen (`docker exec nf-pg18 …`). |
| Port `127.0.0.1:5432` | Nur auf dem eigenen Rechner offen, nicht im Netzwerk. |
| Volume `notefieber-pgdata` → `/var/lib/postgresql` | Die Daten. Sie überstehen `stop`, `down` und Neustarts; weg sind sie erst mit `docker compose down -v`. Beim Image `postgres:18` ist das der richtige Pfad (nicht mehr `…/data`). |
| `./database/scripts` → `/scripts` (nur lesend) | Rollen, Schema, Tests und Testdaten. Änderungen am Rechner sind sofort im Container sichtbar. |
| `./database/docker/initdb` → `/docker-entrypoint-initdb.d` | Das Skript für die Ersteinrichtung ([`10-notefieber.sh`](../database/docker/initdb/10-notefieber.sh)). |
| Healthcheck | „healthy“ erst, wenn die Ersteinrichtung durch ist. |

**Einstellungen ändern** (optional): über Umgebungsvariablen oder eine Datei `.env` neben `compose.yaml`. Sie ist in `.gitignore` eingetragen und kommt nie ins Repository.

| Variable | Standard | Wofür |
|---|---|---|
| `POSTGRES_PASSWORD` | `postgres-lokal` | Passwort des Superusers `postgres` für Verbindungen von außen. Nur lokal, nie für einen Server verwenden. Innerhalb des Containers (`docker exec`) braucht man kein Passwort. Wirkt nur beim ersten Start. |
| `NF_PG_PORT` | `5432` | Port auf dem eigenen Rechner, z. B. `5433`, wenn schon ein PostgreSQL läuft. |
| `NF_SEED` | `true` | `false`: beim ersten Start keine Testdaten einspielen. |
| `NF_PG_CONTAINER`, `NF_PG_VOLUME` | `nf-pg18`, `notefieber-pgdata` | Nur ändern, wenn man eine zweite, getrennte Umgebung braucht. |

Beispiel `.env`:

```
NF_PG_PORT=5433
NF_SEED=false
```

**Umstieg vom früheren `docker run`:** Wer die Datenbank nach einer älteren Fassung dieser Anleitung mit `docker run --name nf-pg18 …` gestartet hat, entfernt nur den Container. Das Volume `notefieber-pgdata` mit allen Daten und dem Passwort von `wiki_owner` übernimmt Compose:

```bash
docker rm -f nf-pg18
```

```bash
docker compose up -d --wait
```

Compose meldet dabei einmal `volume "notefieber-pgdata" already exists but was not created by Docker Compose`. Das ist harmlos. Die Ersteinrichtung läuft nicht noch einmal (`Skipping initialization` im Log), die Daten bleiben.

## 5. Rollen, Datenbank und Schema einspielen

Beim ersten Start mit Compose passiert das automatisch. Das Init-Skript [`10-notefieber.sh`](../database/docker/initdb/10-notefieber.sh) führt nacheinander aus:

1. **Rollen und Datenbank** als Superuser `postgres`: `roles_database.sql` legt die Rollen `wiki_owner`, `wiki_app` und `wiki_worker` an und die Datenbank `wiki` mit der Locale `C.UTF-8`.
2. **Schema** als Eigentümer `wiki_owner`, **nie** als `postgres`, sonst liefen alle `SECURITY DEFINER`-Funktionen als Superuser: `schema/schema.sql`.
3. **Testdaten** als `wiki_owner`, wenn `NF_SEED=true` ([Abschnitt 6](#6-testdaten-einspielen)).

Was dabei passiert ist, zeigt das Log:

```bash
docker logs nf-pg18 2>&1 | grep NoteFieber
```

Erwartet: `NoteFieber: Rollen und Datenbank …`, `NoteFieber: Schema …`, `NoteFieber: Testdaten …`. Bricht ein Schritt ab, steht der Fehler direkt darunter; der Container läuft dann nicht weiter. Den Fehler beheben und mit `docker compose down -v` und `docker compose up -d --wait` neu anfangen.

**Von Hand** braucht man die Schritte nur noch nach dem Zurücksetzen der Datenbank ([Abschnitt 10](#10-alltag-starten-stoppen-zurücksetzen)) oder mit einem PostgreSQL außerhalb von Docker:

```bash
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -f /scripts/roles_database.sql
```

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -q -f /scripts/schema/schema.sql
```

**Passwort für `wiki_owner`** (nur nötig, um sich von der IDE aus zu verbinden). Die Skripte setzen bewusst keine Passwörter. Einmal setzen; es bleibt im Volume erhalten:

```bash
docker exec -it nf-pg18 psql -U postgres -c "\password wiki_owner"
```

Die Rollen und Rechte erklärt [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas). Kurz: `wiki_owner` führt nur Migrationen aus und umgeht RLS; die Apps verbinden sich später mit eigenen Login-Rollen in `wiki_app` (API) bzw. `wiki_worker` (Collab-Server, Jobs).

## 6. Testdaten einspielen

[`database/scripts/seed/seed.sql`](../database/scripts/seed/seed.sql) legt zwei Mandanten mit Personen, Spaces, Seiten, Rechten und Kommentaren an. Die Namen und der Seitenbaum entsprechen dem Prototyp (`prototype/pages`) und den Beispielen in [CONCEPTS.md](CONCEPTS.md).

Mit Compose geschieht das **beim ersten Start automatisch** (außer mit `NF_SEED=false`, [Abschnitt 4](#4-postgresql-18-starten)). Von Hand, z. B. nach dem Zurücksetzen der Datenbank:

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

Das Skript läuft in einer Transaktion: Entweder ist danach alles da oder nichts. Ein zweiter Lauf bricht mit „Testdaten sind schon eingespielt“ ab; zum Neuaufsetzen die Datenbank zurücksetzen ([Abschnitt 10](#10-alltag-starten-stoppen-zurücksetzen)).

**Wer ist dabei und was sieht wer** (ohne Papierkorb, mit den Testdaten geprüft):

| Person | E-Mail | Rolle | Sieht |
|---|---|---|---|
| Anna Huber | `anna.huber@alpenwerk.example` | Organisations-Admin, Owner | ENTW (8 Seiten), VERT (3), PERS (3), ALT (2) |
| Lukas Gruber | `lukas.gruber@alpenwerk.example` | Gruppe Entwicklung | ENTW (8, auch „Personalplanung 2027“), VERT, ALT |
| Sophie Bauer | `sophie.bauer@alpenwerk.example` | Gruppe Entwicklung | ENTW (7), VERT, ALT |
| Markus Wagner | `markus.wagner@alpenwerk.example` | Gruppe Entwicklung | ENTW (7), VERT, ALT |
| Max Mustermann | `max.mustermann@alpenwerk.example` | Gruppe Vertrieb, Admin von VERT | ENTW (7, nur lesen), VERT, ALT |
| Elena Novak | `elena.novak@agentur-nord.example` | Gast (Agentur Nord) | nur „Kampagne Frühjahr“ in VERT |
| Eva Fischer | `eva.fischer@nordlicht.example` | anderer Mandant (Nordlicht) | nur DOKU (2), nichts von Alpenwerk |

**Spaces bei Alpenwerk:**

| Space | Rechte | Besonderheiten |
|---|---|---|
| ENTW Entwicklung | alle im Workspace lesen, Gruppe Entwicklung bearbeitet, Anna Admin | Baum wie im Prototyp (Architektur, Datenmodell, Rechte-Konzept, Release-Prozess, Betrieb, Backups). „Personalplanung 2027“ hat eigene Rechte (nur Anna und Lukas). „Datenmodell“ hat zwei Kommentare und eine Version, „Release-Prozess“ einen erledigten Thread. „Alte Notizen“ liegt im Papierkorb. |
| VERT Vertrieb | von Max angelegt, alle im Workspace kommentieren | „Kampagne Frühjahr“ hat eigene Rechte und ist für den Gast Elena freigegeben, mit einem Kommentar von ihr. |
| PERS Personal | privat, nur Anna | gut, um „Ansehen als …“ und Organisations-Admins auszuprobieren |
| ALT Altes Intranet | alle lesen | archiviert, also für alle höchstens lesbar |

**Was man über die Testdaten wissen muss:**

- **Inhalt:** Die Seiten haben BlockNote-JSON (`content_json`) und Klartext, aber noch keinen Yjs-Zustand (`ydoc` leer). Beim ersten Öffnen baut der Collab-Server das Dokument aus dem JSON (CLAUDE.md, Abschnitt 6). Der Suchindex ist gefüllt, die Suche geht also sofort.
- **Kommentare** sind Seitenkommentare. Kommentare an Textstellen brauchen eine Yjs-Position und kommen erst mit dem Collab-Server.
- **Login:** Die Personen haben noch kein `idp_subject`. Mit Zitadel verbindet sie erst die lokale Login-Einrichtung ([Abschnitt 12](#12-was-noch-dazukommt)).
- **Ereignisse** liegen unveröffentlicht in der Outbox, bis ein Worker läuft.
- **Tests:** `schema_test.sql` läuft auch auf einer Datenbank mit Testdaten (die Tests nutzen eigene Mandanten und rollen zurück). Der Nebenläufigkeitstest legt zusätzlich einen Mandanten `nebenlaeufig-…` an.
- Ändert sich eine Funktion, die das Skript aufruft (z. B. eine neue Signatur), muss `seed.sql` mitgezogen werden. Ein Lauf nach jeder Schemaänderung ist deshalb ein guter zusätzlicher Test.

## 7. Tests ausführen

**Funktionstest** (44 Tests für Rechte, Sichtbarkeit und Regeln):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/schema_test/schema_test.sql
```

Erwartet: `NOTICE: OK 1 …` bis `NOTICE: OK 44 …`, dann `Alle Tests bestanden (zurückgerollt, die Datenbank ist unverändert).` Der Test läuft in einer Transaktion und rollt am Ende zurück. Man kann ihn also beliebig oft wiederholen, und die Datenbank bleibt leer. Bricht ein Test ab, zeigt `ERROR:` den Grund, und die Datenbank ist ebenfalls unverändert.

**Nebenläufigkeitstest** (Sperren im Seitenbaum mit zwei gleichzeitigen Sitzungen, dauert etwa 10 Sekunden):

```bash
PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" bash database/scripts/schema_test/schema_concurrency_test.sh
```

Erwartet: `OK 1` bis `OK 4`, dann `Alle Nebenläufigkeitstests bestanden`. Dieser Test muss committen und lässt deshalb einen Mandanten `nebenlaeufig-<zeitstempel>` in der Datenbank stehen. Wer das nicht möchte, setzt die Datenbank danach zurück ([Abschnitt 10](#10-alltag-starten-stoppen-zurücksetzen)).

## 8. Mit der IDE verbinden

| Feld | Wert |
|---|---|
| Host | `localhost` |
| Port | `5432` (bzw. der gewählte) |
| Datenbank | `wiki` |
| Benutzer | `wiki_owner` |
| Passwort | aus [Abschnitt 5](#5-rollen-datenbank-und-schema-einspielen) |

**Achtung:** Als `wiki_owner` sieht man **alle** Zeilen aller Mandanten, weil der Eigentümer RLS umgeht. Um zu sehen, was eine bestimmte Person sieht, in einer Transaktion den Kontext setzen und die Rolle wechseln. Mit den Testdaten ([Abschnitt 6](#6-testdaten-einspielen)) geht das über die E-Mail-Adresse:

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

Mit `SET LOCAL ROLE wiki_worker` und ohne `app.user_id` sieht man, was Collab-Server und Worker sehen: alles im Mandanten. „Ansehen als …“ probiert man so aus wie oben, aber als Anna (`anna.huber@…`) mit `SELECT * FROM app.view_as(<space-id>, <personen-id>, app.current_user_id());`.

## 9. Das Schema ändern

Solange es keine Produktivdaten gibt, ist das Schema in `database/scripts/schema/` vollständig und es gibt noch keine Migrationen. `schema.sql` ist der Einstieg und bindet die Teile (`00_setup.sql` … `90_privileges.sql`) mit `\ir` in einer Transaktion ein. Welche Datei was enthält, zeigt die Tabelle am Anfang von [SCHEMA.md](SCHEMA.md). Ein Änderungszyklus sieht so aus:

1. **Test zuerst:** Alles, was Rechte oder Sichtbarkeit berührt, bekommt zuerst einen Test (Regel aus der `CLAUDE.md`). Die Tests liegen in `database/scripts/schema_test/`: `schema_test.sql` ist der Einstieg, die Tests stehen in den Teilen `01_basics.sql` … `11_content_json.sql`. Neue Tests hinten an den passenden Teil oder als neuer Teil am Ende (mit `\ir`-Zeile in `schema_test.sql`). Die Teile bauen aufeinander auf; welche Testdaten ein Teil nutzt und anlegt, steht in seinem Kopf. Die Tests laufen als `wiki_app` bzw. `wiki_worker`.
2. Den passenden Teil ändern, z. B. eine neue Seitenfunktion in `60_functions_pages.sql`, ihre Freigabe in `90_privileges.sql`, eine neue Leseregel in `80_rls.sql`. Die Regeln für neue Funktionen stehen in der `CLAUDE.md` (Abschnitt 13) und in [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas): Mandant in jeder Abfrage prüfen, `require_actor` zuerst, neue Funktionen ausdrücklich freigeben. Ein **neuer Teil** braucht eine `\ir`-Zeile in `schema.sql` an der richtigen Stelle der Reihenfolge.
3. Datenbank zurücksetzen und neu einspielen ([Abschnitt 10](#10-alltag-starten-stoppen-zurücksetzen)), dabei auch die Testdaten. Scheitert `seed.sql`, nutzt es eine geänderte Funktion; dann das Skript mitziehen.
4. Beide Tests ausführen ([Abschnitt 7](#7-tests-ausführen)).
5. [SCHEMA.md](SCHEMA.md) und bei Bedarf `CLAUDE.md` nachziehen.

## 10. Alltag: starten, stoppen, zurücksetzen

Alle Befehle im Hauptordner des Repositorys. Anhalten und weitermachen (die Daten bleiben im Volume):

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

**Alles neu, ganz einfach** (Container und Daten weg, danach Ersteinrichtung mit frischem Schema und Testdaten). Danach muss das Passwort von `wiki_owner` neu gesetzt werden ([Abschnitt 5](#5-rollen-datenbank-und-schema-einspielen)):

```bash
docker compose down -v
```

```bash
docker compose up -d --wait
```

**Nur die Datenbank `wiki` zurücksetzen** (z. B. nach einer Schemaänderung, schneller und ohne neues Passwort). Die Rollen bleiben bestehen; die Hinweise `role "wiki_owner" has already been granted membership …` sind harmlos:

```bash
export MSYS_NO_PATHCONV=1
docker exec nf-pg18 psql -U postgres -c "DROP DATABASE IF EXISTS wiki WITH (FORCE)"
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -q -f /scripts/roles_database.sql
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -q -f /scripts/schema/schema.sql
```

Testdaten wieder einspielen (optional):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/seed/seed.sql
```

Das Passwort von `wiki_owner` bleibt dabei erhalten, es hängt an der Rolle, nicht an der Datenbank.

**Alles entfernen** (Container, Netzwerk und Daten):

```bash
docker compose down -v
```

Ohne `-v` bleibt das Volume `notefieber-pgdata` mit den Daten erhalten; ein späteres `docker compose up` nimmt sie wieder auf.

## 11. Fehlerbehebung

| Meldung | Ursache und Abhilfe |
|---|---|
| `failed to connect to the docker API` / `Cannot connect to the Docker daemon` | Docker läuft nicht. Docker Desktop starten und warten, bis es bereit ist. |
| `Bind for 127.0.0.1:5432 failed: port is already allocated` | Auf dem Rechner läuft schon ein PostgreSQL (oder noch der alte `docker run`-Container, siehe Umstieg in [Abschnitt 4](#4-postgresql-18-starten)). Sonst anderen Port wählen (`NF_PG_PORT=5433` in `.env`) und in der IDE anpassen. |
| `Conflict. The container name "/nf-pg18" is already in use` | Der Container aus dem früheren `docker run` läuft noch. `docker rm -f nf-pg18`, die Daten bleiben im Volume ([Abschnitt 4](#4-postgresql-18-starten), Umstieg). |
| `volume "notefieber-pgdata" already exists but was not created by Docker Compose` | Harmlos: Das Volume stammt aus dem früheren `docker run`, Compose nutzt es weiter. |
| `docker compose up --wait` endet mit `container nf-pg18 is unhealthy` oder `exited` | Die Ersteinrichtung ist gescheitert. `docker logs nf-pg18` zeigt nach `NoteFieber: …` den Fehler. Beheben, dann `docker compose down -v` und neu starten. |
| `/docker-entrypoint-initdb.d/10-notefieber.sh: … $'\r': command not found` | Das Init-Skript hat Windows-Zeilenenden. `.gitattributes` verhindert das eigentlich; sonst siehe [Abschnitt 2](#2-voraussetzungen). Danach `docker compose down -v` und neu starten. |
| `psql: error: C:/Program Files/Git/scripts/…: No such file or directory` | Git Bash hat den Pfad umgewandelt. `export MSYS_NO_PATHCONV=1` vergessen. |
| `$'\r': command not found` beim Nebenläufigkeitstest | Windows-Zeilenenden im Skript, siehe [Abschnitt 2](#2-voraussetzungen). |
| `role "wiki_owner" does not exist` | Schritt 1 (`roles_database.sql`) fehlt. |
| `database "wiki" already exists` | `roles_database.sql` wurde schon einmal ausgeführt. Zum Neuaufsetzen zuerst die Datenbank löschen ([Abschnitt 10](#10-alltag-starten-stoppen-zurücksetzen)). |
| `relation "…" already exists` beim Schema | Das Schema ist schon eingespielt. `schema.sql` ist kein Migrationsskript und lässt sich nicht zweimal einspielen; Datenbank zurücksetzen. Es wird dabei nichts geändert (eine Transaktion). |
| `Rollen wiki_app und wiki_worker fehlen: zuerst roles_database.sql ausführen` | Schritt 1 aus [Abschnitt 5](#5-rollen-datenbank-und-schema-einspielen) fehlt. |
| Fehlermeldungen beginnen mit `psql:/scripts/schema/60_functions_pages.sql:42:` | So soll es sein: Die Meldung nennt den Teil und die Zeile, in der der Fehler steckt. |
| `syntax error at or near "\"` oder `\ir` wird nicht erkannt | `schema.sql` wurde nicht mit `psql` ausgeführt, z. B. über „Run“ in der IDE. `\ir` ist ein Befehl von `psql`; das Schema immer mit `psql` einspielen wie in [Abschnitt 5](#5-rollen-datenbank-und-schema-einspielen). |
| `Testdaten sind schon eingespielt (Mandant alpenwerk vorhanden)` | `seed.sql` lief schon. Zum Neuaufsetzen die Datenbank zurücksetzen und Schema und Testdaten neu einspielen ([Abschnitt 10](#10-alltag-starten-stoppen-zurücksetzen)). |
| `function app.… does not exist` beim Einspielen der Testdaten | Die Datenbank hat einen älteren Stand des Schemas, oder `seed.sql` wurde nach einer Schemaänderung nicht mitgezogen. |
| `password authentication failed for user "wiki_owner"` in der IDE | Passwort noch nicht gesetzt oder falsch (auch nach `docker compose down -v` neu nötig), siehe [Abschnitt 5](#5-rollen-datenbank-und-schema-einspielen). |
| Ein Test meldet `ERROR: …` mit `CONTEXT: … at ASSERT` | Ein Test ist fehlgeschlagen; die Meldung nennt, was nicht stimmt. Die Datenbank ist unverändert (Rollback). |
| Die Tests finden Funktionen oder Spalten nicht, die es im Schema gibt | Die Datenbank hat einen älteren Stand des Schemas. Zurücksetzen und neu einspielen. |

## 12. Was noch dazukommt

Mit den nächsten Schritten aus der `CLAUDE.md` (Abschnitt 13) und Stufe 1 der [ROADMAP](ROADMAP.md) wächst die lokale Umgebung. Geplant ist:

- **Zitadel und Garage in `compose.yaml`**, neben PostgreSQL. Zitadel bekommt eine eigene Datenbank `zitadel` im selben PostgreSQL, wie später im gemeinsamen Cluster.
- **k3d** erst, wenn die K3s-Manifeste entstehen (`CLAUDE.md`, Abschnitt 13, Schritt 3): Dann lassen sie sich lokal prüfen. Für die tägliche Arbeit bleibt Compose.
- **Zitadel** lokal als Login-Dienst, mit einer Test-Organisation als Mandant und je einem OIDC-Client für Frontend und API. Dazu gehört, die Personen aus den Testdaten in Zitadel anzulegen und ihr `idp_subject` einzutragen, damit man sich als Anna, Max oder Elena anmelden kann.
- **Garage** lokal mit dem Bucket `wiki` für Anhänge, Bilder und Import-Archive.
- **Die Apps** (`apps/web`, `apps/api`, `apps/collab`, `apps/worker`, siehe README) laufen mit Node.js direkt auf dem Rechner und verbinden sich mit eigenen Login-Rollen (`wiki_api` in `wiki_app`, `wiki_collab` und `wiki_jobs` in `wiki_worker`), nie als `wiki_owner`.
- Eine `.env.example` mit allen nötigen Einstellungen (Datenbank-URLs, Zitadel, Garage); die echte `.env` kommt nie ins Repository.

Diese Anleitung wird mit jedem dieser Schritte ergänzt.
