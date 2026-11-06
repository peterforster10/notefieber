# Lokale Entwicklung einrichten

Diese Anleitung beschreibt, was man für die Entwicklung am eigenen Rechner braucht und wie man die Umgebung aufsetzt. Sie gilt für Windows (mit Git Bash), macOS und Linux. Nach dem allgemeinen Teil (Abschnitte 1–3) hat jeder Baustein der Umgebung einen eigenen Abschnitt.

## Inhalt

1. [Überblick](#1-überblick)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Repository holen und Umgebung starten](#3-repository-holen-und-umgebung-starten)
4. [Datenbank (PostgreSQL)](#4-datenbank-postgresql)
5. [Dateien (Garage)](#5-dateien-garage)
6. [Login (Zitadel), geplant](#6-login-zitadel-geplant)
7. [Alltag: starten, stoppen, neu anfangen](#7-alltag-starten-stoppen-neu-anfangen)
8. [Fehlerbehebung](#8-fehlerbehebung)
9. [Was noch dazukommt](#9-was-noch-dazukommt)

---

## 1. Überblick

Das Projekt steht am Anfang von Stufe 1 der [ROADMAP](ROADMAP.md). Lokal laufen bisher die Datenbank und der Dateispeicher, beide per Docker Compose ([`compose.yaml`](../compose.yaml)) und beide richten sich beim ersten Start selbst ein.

| Baustein | Stand | Container | Erreichbar unter | Abschnitt |
|---|---|---|---|---|
| Datenbank: PostgreSQL 18 mit Schema, Tests und Testdaten | fertig | `nf-pg18` | `localhost:5432` | [4](#4-datenbank-postgresql) |
| Dateien: Garage (S3), Bucket `wiki` | fertig | `nf-garage`, `garage-init` | `localhost:3900` (S3), `localhost:3903` (Admin) | [5](#5-dateien-garage) |
| Login: Zitadel | geplant | – | – | [6](#6-login-zitadel-geplant) |
| Frontend, API, Collab-Server, Worker (`apps/…`) | geplant | – (Node.js direkt auf dem Rechner) | – | [9](#9-was-noch-dazukommt) |

Wer heute mitarbeitet, braucht also Git, Docker und eine Bash. Node.js wird erst mit den Apps nötig, lohnt sich aber gleich mit zu installieren.

## 2. Voraussetzungen

| Was | Version | Wofür | Hinweise |
|---|---|---|---|
| **Git** | aktuell | Repository | Unter Windows „Git for Windows“, bringt Git Bash mit. |
| **Docker** | Docker Desktop (Windows, macOS) oder Docker Engine (Linux), mit Compose | PostgreSQL 18 und Garage, später Zitadel | Docker 4 GB Arbeitsspeicher geben, später mit Zitadel eher 6–8 GB. |
| **Bash** | 4 oder neuer | `schema_concurrency_test.sh` | Unter Windows Git Bash, unter macOS und Linux die vorhandene Shell. |
| **curl** | 7.75 oder neuer | Dateien in Garage von Hand prüfen (`--aws-sigv4`) | Unter Windows bringt Git Bash ein passendes curl mit. |
| **Node.js** | 24 (LTS) mit npm | später die Apps; jetzt schon für Prüfungen gegen npm-Pakete | Am einfachsten über einen Versionsmanager (`fnm`, `nvm`, `nvm-windows`). |
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

`--wait` wartet, bis alle Bausteine fertig eingerichtet sind. Beim **ersten Start** (leere Volumes) spielt PostgreSQL selbst Rollen, Datenbank, Schema und Testdaten ein ([Abschnitt 4](#4-datenbank-postgresql)), und `garage-init` legt in Garage Bucket und Schlüssel an ([Abschnitt 5](#5-dateien-garage)). Das dauert wenige Sekunden. Danach:

```bash
docker compose ps
```

Erwartet, alle mit Status `Up … (healthy)`:

```
nf-garage                  Up … (healthy)   127.0.0.1:3900->3900/tcp, 127.0.0.1:3903->3903/tcp
nf-pg18                    Up … (healthy)   127.0.0.1:5432->5432/tcp
notefieber-garage-init-1   Up … (healthy)
```

Alle Ports sind nur auf dem eigenen Rechner offen, nicht im Netzwerk.

**Einstellungen ändern** (optional): über Umgebungsvariablen oder eine Datei `.env` neben `compose.yaml`. Sie ist in `.gitignore` eingetragen und kommt nie ins Repository. Die Variablen stehen bei den Bausteinen ([PostgreSQL](#einstellungen-für-postgresql), [Garage](#einstellungen-für-garage)) und gesammelt im Kopf von `compose.yaml`. Alle Standardwerte sind nur für den eigenen Rechner gedacht, nie für einen Server. Beispiel `.env`:

```
NF_PG_PORT=5433
NF_SEED=false
```

Starten, anhalten und neu anfangen für alle Bausteine zusammen: [Abschnitt 7](#7-alltag-starten-stoppen-neu-anfangen).

## 4. Datenbank (PostgreSQL)

PostgreSQL 18 läuft im Container `nf-pg18` (offizielles Image `postgres:18`). Die Befehle in dieser Anleitung und in der `CLAUDE.md` verwenden diesen Namen (`docker exec nf-pg18 …`).

| In `compose.yaml` | Bedeutung |
|---|---|
| Port `127.0.0.1:5432` | Für IDE und später die Apps. |
| Volume `notefieber-pgdata` → `/var/lib/postgresql` | Die Daten. Sie überstehen `stop`, `down` und Neustarts; weg sind sie erst mit `docker compose down -v`. Beim Image `postgres:18` ist das der richtige Pfad (nicht mehr `…/data`). |
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
2. **Schema** als Eigentümer `wiki_owner`, **nie** als `postgres`, sonst liefen alle `SECURITY DEFINER`-Funktionen als Superuser: `schema/schema.sql`.
3. **Testdaten** als `wiki_owner`, wenn `NF_SEED=true` ([unten](#testdaten)).

Was dabei passiert ist, zeigt das Log:

```bash
docker logs nf-pg18 2>&1 | grep NoteFieber
```

Erwartet: `NoteFieber: Rollen und Datenbank …`, `NoteFieber: Schema …`, `NoteFieber: Testdaten …`. Bricht ein Schritt ab, steht der Fehler direkt darunter; der Container läuft dann nicht weiter. Den Fehler beheben und mit `docker compose down -v` und `docker compose up -d --wait` neu anfangen.

**Von Hand** braucht man die Schritte nur nach dem [Zurücksetzen der Datenbank](#datenbank-zurücksetzen) oder mit einem PostgreSQL außerhalb von Docker:

```bash
docker exec nf-pg18 psql -U postgres -v ON_ERROR_STOP=1 -f /scripts/roles_database.sql
```

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -q -f /scripts/schema/schema.sql
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
- **Dateien:** Die Testdaten enthalten keine Anhänge; der Bucket in Garage ist leer.
- **Login:** Die Personen haben noch kein `idp_subject`. Mit Zitadel verbindet sie erst die lokale Login-Einrichtung ([Abschnitt 6](#6-login-zitadel-geplant)).
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

Mit `SET LOCAL ROLE wiki_worker` und ohne `app.user_id` sieht man, was Collab-Server und Worker sehen: alles im Mandanten. „Ansehen als …“ probiert man so aus wie oben, aber als Anna (`anna.huber@…`) mit `SELECT * FROM app.view_as(<space-id>, <personen-id>, app.current_user_id());`.

### Tests ausführen

**Funktionstest** (44 Tests für Rechte, Sichtbarkeit und Regeln):

```bash
docker exec nf-pg18 psql -U wiki_owner -d wiki -v ON_ERROR_STOP=1 -f /scripts/schema_test/schema_test.sql
```

Erwartet: `NOTICE: OK 1 …` bis `NOTICE: OK 44 …`, dann `Alle Tests bestanden (zurückgerollt, die Datenbank ist unverändert).` Der Test läuft in einer Transaktion und rollt am Ende zurück. Man kann ihn also beliebig oft wiederholen, auch auf einer Datenbank mit Testdaten (die Tests nutzen eigene Mandanten). Bricht ein Test ab, zeigt `ERROR:` den Grund, und die Datenbank ist ebenfalls unverändert.

**Nebenläufigkeitstest** (Sperren im Seitenbaum mit zwei gleichzeitigen Sitzungen, dauert etwa 10 Sekunden):

```bash
PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" bash database/scripts/schema_test/schema_concurrency_test.sh
```

Erwartet: `OK 1` bis `OK 4`, dann `Alle Nebenläufigkeitstests bestanden`. Dieser Test muss committen und lässt deshalb einen Mandanten `nebenlaeufig-<zeitstempel>` in der Datenbank stehen. Wer das nicht möchte, [setzt die Datenbank danach zurück](#datenbank-zurücksetzen).

### Das Schema ändern

Solange es keine Produktivdaten gibt, ist das Schema in `database/scripts/schema/` vollständig und es gibt noch keine Migrationen. `schema.sql` ist der Einstieg und bindet die Teile (`00_setup.sql` … `90_privileges.sql`) mit `\ir` in einer Transaktion ein. Welche Datei was enthält, zeigt die Tabelle am Anfang von [SCHEMA.md](SCHEMA.md). Ein Änderungszyklus sieht so aus:

1. **Test zuerst:** Alles, was Rechte oder Sichtbarkeit berührt, bekommt zuerst einen Test (Regel aus der `CLAUDE.md`). Die Tests liegen in `database/scripts/schema_test/`: `schema_test.sql` ist der Einstieg, die Tests stehen in den Teilen `01_basics.sql` … `11_content_json.sql`. Neue Tests hinten an den passenden Teil oder als neuer Teil am Ende (mit `\ir`-Zeile in `schema_test.sql`). Die Teile bauen aufeinander auf; welche Testdaten ein Teil nutzt und anlegt, steht in seinem Kopf. Die Tests laufen als `wiki_app` bzw. `wiki_worker`.
2. Den passenden Teil ändern, z. B. eine neue Seitenfunktion in `60_functions_pages.sql`, ihre Freigabe in `90_privileges.sql`, eine neue Leseregel in `80_rls.sql`. Die Regeln für neue Funktionen stehen in der `CLAUDE.md` (Abschnitt 13) und in [SCHEMA.md, Abschnitt 9](SCHEMA.md#9-datenbank-rollen-und-schemas): Mandant in jeder Abfrage prüfen, `require_actor` zuerst, neue Funktionen ausdrücklich freigeben. Ein **neuer Teil** braucht eine `\ir`-Zeile in `schema.sql` an der richtigen Stelle der Reihenfolge.
3. [Datenbank zurücksetzen](#datenbank-zurücksetzen) und neu einspielen, dabei auch die Testdaten. Scheitert `seed.sql`, nutzt es eine geänderte Funktion; dann das Skript mitziehen.
4. Beide [Tests ausführen](#tests-ausführen).
5. [SCHEMA.md](SCHEMA.md) und bei Bedarf `CLAUDE.md` nachziehen.

### Datenbank zurücksetzen

Nur die Datenbank `wiki`, z. B. nach einer Schemaänderung. Schneller als [alles neu](#7-alltag-starten-stoppen-neu-anfangen), Garage bleibt unberührt, und das Passwort von `wiki_owner` bleibt erhalten (es hängt an der Rolle, nicht an der Datenbank). Die Hinweise `role "wiki_owner" has already been granted membership …` sind harmlos:

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

Nur lokal; später auch in der `.env.example` ([Abschnitt 9](#9-was-noch-dazukommt)).

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

## 6. Login (Zitadel), geplant

Noch nicht eingebaut. Geplant ist derselbe Aufbau wie bei den anderen Bausteinen:

- **Zitadel in `compose.yaml`**, erreichbar unter `http://localhost:8080`. Zitadel bekommt eine eigene Datenbank `zitadel` im selben PostgreSQL, wie später im gemeinsamen Cluster (CLAUDE.md, Abschnitt 11). Die Version wird fest eingetragen, weil sich Konfiguration und Einrichtungs-API zwischen Hauptversionen merklich ändern.
- **Einrichtung beim Start als Skript**, wiederholbar wie bei Garage:
  - Organisationen **Alpenwerk** und **Nordlicht** passend zu den [Testdaten](#testdaten); ihre Zitadel-ID landet in `tenants.idp_org_id`,
  - die Testpersonen (Anna, Lukas, Max, Elena …) als Zitadel-Nutzer mit einem gemeinsamen Testpasswort; ihre Zitadel-ID landet in `users.idp_subject`, damit man sich als sie anmelden kann,
  - die Gruppen Entwicklung, Vertrieb und Geschäftsleitung, damit `app.sync_user_groups` beim Login etwas zu tun hat,
  - ein Projekt „NoteFieber“ mit je einem OIDC-Client für Frontend und API, mit Redirect-URLs für `localhost`.
- **Werte für die Apps** (Issuer, Client-IDs) und die Anmeldung als Testperson stehen dann hier.

## 7. Alltag: starten, stoppen, neu anfangen

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

**Alles neu** (Container und alle Daten weg, auch die Dateien in Garage; danach Ersteinrichtung mit frischem Schema, Testdaten und leerem Bucket). Danach muss das [Passwort von `wiki_owner`](#passwort-für-wiki_owner) neu gesetzt werden. Nur die Datenbank neu: [Datenbank zurücksetzen](#datenbank-zurücksetzen).

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

Ohne `-v` bleiben die Volumes (`notefieber-pgdata`, `notefieber-garage-meta`, `notefieber-garage-data`) mit den Daten erhalten; ein späteres `docker compose up` nimmt sie wieder auf.

## 8. Fehlerbehebung

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
| `relation "…" already exists` beim Schema | Das Schema ist schon eingespielt. `schema.sql` ist kein Migrationsskript und lässt sich nicht zweimal einspielen; Datenbank zurücksetzen. Es wird dabei nichts geändert (eine Transaktion). |
| Fehlermeldungen beginnen mit `psql:/scripts/schema/60_functions_pages.sql:42:` | So soll es sein: Die Meldung nennt den Teil und die Zeile, in der der Fehler steckt. |
| `syntax error at or near "\"` oder `\ir` wird nicht erkannt | `schema.sql` wurde nicht mit `psql` ausgeführt, z. B. über „Run“ in der IDE. `\ir` ist ein Befehl von `psql`; das Schema immer mit `psql` einspielen. |
| `Testdaten sind schon eingespielt (Mandant alpenwerk vorhanden)` | `seed.sql` lief schon. Zum Neuaufsetzen die [Datenbank zurücksetzen](#datenbank-zurücksetzen) und Schema und Testdaten neu einspielen. |
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

## 9. Was noch dazukommt

Mit den nächsten Schritten aus der `CLAUDE.md` (Abschnitt 13) und Stufe 1 der [ROADMAP](ROADMAP.md) wächst die lokale Umgebung:

- **Zitadel** als dritter Baustein ([Abschnitt 6](#6-login-zitadel-geplant)).
- **Die Apps** (`apps/web`, `apps/api`, `apps/collab`, `apps/worker`, siehe README) laufen mit Node.js direkt auf dem Rechner und verbinden sich mit eigenen Login-Rollen (`wiki_api` in `wiki_app`, `wiki_collab` und `wiki_jobs` in `wiki_worker`), nie als `wiki_owner`. Diese Rollen legt dann die [Ersteinrichtung](#ersteinrichtung-rollen-datenbank-schema) mit an.
- Eine **`.env.example`** mit allen Einstellungen für die Apps: Datenbank-URLs pro Login-Rolle, Zitadel, die [Garage-Werte](#werte-für-die-apps). Die echte `.env` kommt nie ins Repository.
- **k3d** erst, wenn die K3s-Manifeste entstehen (`CLAUDE.md`, Abschnitt 13, Schritt 3): Dann lassen sie sich lokal prüfen. Für die tägliche Arbeit bleibt Compose.

Diese Anleitung wird mit jedem dieser Schritte ergänzt.
