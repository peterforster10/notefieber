#!/usr/bin/env bash
# Alle Datenbanktests auf einem leeren PostgreSQL 18, so wie in der CI (.gitlab-ci.yml):
#   1. Rollen und Datenbank (roles_database.sql, als postgres)
#   2. alle Migrationen (migrate.sh, als wiki_owner)
#   3. Funktionstest (schema_test.sql) auf der leeren Datenbank
#   4. Testdaten (seed.sql), danach der Funktionstest noch einmal: Tests und Testdaten
#      vertragen sich (die Tests nutzen eigene Mandanten)
#   5. migrate.sh ein zweites Mal: darf nichts mehr einspielen
#   6. Nebenläufigkeitstest (schema_concurrency_test.sh)
#   7. Migrationstest (schema_migrations_test.sh): schema/ und Migrationen ergeben dasselbe
#
# Verbindung über die üblichen Variablen von libpq (PGHOST, PGPORT, PGPASSWORD …). Der
# Server muss postgres und wiki_owner ohne Passwort (trust) oder mit PGPASSWORD hineinlassen.
# psql und pg_dump müssen dieselbe Hauptversion haben wie der Server (Image postgres:18).
#
#   PGHOST=postgres bash database/scripts/schema_test/ci.sh
#
# Nie gegen eine Datenbank mit echten Daten: Schritt 1 legt die Datenbank wiki neu an und
# bricht ab, wenn es sie schon gibt.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS=$(cd "$HERE/.." && pwd)
ADMIN="psql -X -U postgres"
OWNER="psql -X -U wiki_owner"

step() { printf '\n=== %s\n' "$*"; }

# Funktionstest: kurze Ausgabe (Zahl der Tests und Schlusszeile), bei einem Fehler alles
run_tests() {
  local log; log=$(mktemp)
  if ! $OWNER -d wiki -v ON_ERROR_STOP=1 -f "$HERE/schema_test.sql" >"$log" 2>&1; then
    cat "$log"; rm -f "$log"; echo "FEHLER: Funktionstest" >&2; exit 1
  fi
  echo "$(grep -c 'NOTICE: *OK' "$log") Tests: $(tail -1 "$log")"
  rm -f "$log"
}

step "Warten auf PostgreSQL (${PGHOST:-lokal}:${PGPORT:-5432})"
for i in $(seq 1 60); do
  pg_isready -q -U postgres && break
  [[ $i -lt 60 ]] || { echo "FEHLER: PostgreSQL antwortet nicht" >&2; exit 1; }
  sleep 1
done
psql --version
$ADMIN -d postgres -Atc "SELECT 'Server ' || version()"

step "1. Rollen und Datenbank"
if [[ -n "$($ADMIN -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'wiki'")" ]]; then
  echo "FEHLER: Datenbank wiki gibt es schon; ci.sh braucht einen leeren Server" >&2; exit 1
fi
$ADMIN -d postgres -q -v ON_ERROR_STOP=1 -f "$SCRIPTS/roles_database.sql"

step "2. Migrationen"
PSQL="$OWNER -d wiki" bash "$SCRIPTS/migrate.sh"

step "3. Funktionstest auf der leeren Datenbank"
run_tests

step "4. Testdaten und Funktionstest mit Testdaten"
$OWNER -d wiki -v ON_ERROR_STOP=1 -f "$SCRIPTS/seed/seed.sql" 2>&1 | tail -1
run_tests

step "5. Migrationen ein zweites Mal"
OUT=$(PSQL="$OWNER -d wiki" bash "$SCRIPTS/migrate.sh")
echo "$OUT"
if grep -q '^Migration [0-9]' <<<"$OUT"; then echo "FEHLER: zweiter Lauf spielt erneut ein" >&2; exit 1; fi

step "6. Nebenläufigkeitstest"
PSQL="$OWNER -d wiki" bash "$HERE/schema_concurrency_test.sh"

step "7. Migrationstest"
ADMIN="$ADMIN" OWNER="$OWNER" DUMP="pg_dump -U postgres" bash "$HERE/schema_migrations_test.sh"

printf '\nAlle Datenbanktests bestanden.\n'
