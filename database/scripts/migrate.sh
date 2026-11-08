#!/usr/bin/env bash
# Spielt die noch fehlenden Migrationen aus migrations/ ein, in der Reihenfolge der
# Dateinamen, jede in einer eigenen Transaktion. Als Eigentümer (wiki_owner), nie als
# Superuser, sonst gehörten Tabellen und SECURITY-DEFINER-Funktionen postgres.
#
#   PSQL="psql -U wiki_owner -d wiki" bash database/scripts/migrate.sh
#   PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" bash database/scripts/migrate.sh
#   docker exec nf-pg18 bash /scripts/migrate.sh          (im Container, Standard für PSQL)
#
# Regeln (docs/LOCAL_SETUP.md, „Das Schema ändern“):
#   - Dateien heißen NNNN_beschreibung.sql (0001_initial_schema.sql, 0002_…). Reines SQL,
#     ohne BEGIN/COMMIT (das Skript legt die Transaktion selbst darum) und ohne psql-Befehle
#     wie \ir: Die Datei geht über stdin an psql, das auch in einem Container laufen kann.
#   - Eingespielte Migrationen werden nie geändert. Das Skript merkt sich eine Prüfsumme
#     jeder Datei und bricht ab, wenn sich eine schon eingespielte geändert hat.
#   - Nur vorwärts: Es gibt keine Rückwärts-Migrationen. Jede Migration muss eine Version
#     rückwärtskompatibel sein (die alte App läuft mit dem neuen Schema).
#
# Buch führt die Tabelle migrations.applied (eigenes Schema, nicht public: dort verlangt
# der Test für Mandantentrennung RLS auf jeder Tabelle; die App hat darauf keine Rechte).
# Zwei gleichzeitige Läufe warten aufeinander (Advisory Lock).
set -euo pipefail

PSQL=${PSQL:-psql -U wiki_owner -d wiki}
DIR=$(cd "$(dirname "$0")/migrations" && pwd)
LOCK=727001   # beliebige, feste Zahl für pg_advisory_lock

shopt -s nullglob
FILES=("$DIR"/[0-9][0-9][0-9][0-9]_*.sql)
[[ ${#FILES[@]} -gt 0 ]] || { echo "migrate.sh: keine Migrationen in $DIR" >&2; exit 1; }

# Prüfungen vorab, damit eine fehlerhafte Datei gar nicht erst an die Datenbank geht
DUP=$(for f in "${FILES[@]}"; do basename "$f" | cut -c1-4; done | sort | uniq -d)
[[ -z "$DUP" ]] || { echo "migrate.sh: Nummer doppelt vergeben: $DUP" >&2; exit 1; }
for f in "${FILES[@]}"; do
  name=$(basename "$f" .sql)
  if tr -d '\r' < "$f" | grep -Eiq '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION)[[:space:]]*;'; then
    echo "migrate.sh: $name enthält BEGIN/COMMIT; die Transaktion legt das Skript selbst darum" >&2; exit 1
  fi
  if tr -d '\r' < "$f" | grep -Eq '^[[:space:]]*\\'; then
    echo "migrate.sh: $name enthält psql-Befehle (\\…); nur reines SQL" >&2; exit 1
  fi
done

# Ein psql-Aufruf für alles: Sperre für den ganzen Lauf, dann pro Datei prüfen und einspielen.
# Ob eine Migration fehlt, entscheidet die Datenbank (nach der Sperre), nicht das Skript.
{
  cat <<'SQL'
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = warning;
SQL
  echo "SELECT pg_advisory_lock($LOCK) IS NULL AS locked \\gset"
  cat <<'SQL'
DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'migrate.sh: nicht als Superuser einspielen, sondern als Eigentümer (wiki_owner)';
  END IF;
  IF to_regnamespace('app') IS NOT NULL AND to_regclass('migrations.applied') IS NULL THEN
    RAISE EXCEPTION 'migrate.sh: Das Schema wurde ohne Migrationen eingespielt (vor dem 8. November 2026). Datenbank zurücksetzen, siehe docs/LOCAL_SETUP.md, „Datenbank zurücksetzen“';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS migrations;
CREATE TABLE IF NOT EXISTS migrations.applied (
  version    text PRIMARY KEY,                  -- Dateiname ohne .sql
  checksum   text NOT NULL,                     -- SHA-256 der Datei (ohne \r)
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
);
SQL
  for f in "${FILES[@]}"; do
    name=$(basename "$f" .sql)
    sum=$(tr -d '\r' < "$f" | sha256sum | cut -d' ' -f1)
    cat <<SQL
SELECT NOT EXISTS (SELECT 1 FROM migrations.applied WHERE version = '$name') AS pending,
       coalesce((SELECT checksum = '$sum' FROM migrations.applied WHERE version = '$name'), true) AS unchanged \gset
\if :unchanged
\else
DO \$\$ BEGIN RAISE EXCEPTION 'migrate.sh: % wurde nach dem Einspielen geändert. Eingespielte Migrationen nie ändern, sondern eine neue anlegen', '$name'; END \$\$;
\endif
\if :pending
BEGIN;
SQL
    tr -d '\r' < "$f"
    cat <<SQL

INSERT INTO migrations.applied (version, checksum) VALUES ('$name', '$sum');
COMMIT;
\echo 'Migration $name eingespielt'
\endif
SQL
  done
  cat <<'SQL'
SELECT count(*) AS n FROM migrations.applied \gset
\echo 'Migrationen aktuell,' :n 'eingespielt.'
SQL
} | $PSQL -X -q
