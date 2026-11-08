#!/usr/bin/env bash
# Prüft, dass schema/ und die Migrationen dasselbe Schema ergeben. Beide Wege werden in je
# einer frischen Datenbank eingespielt und mit pg_dump (nur Struktur, mit Rechten)
# verglichen. Danach läuft migrate.sh ein zweites Mal und darf nichts mehr tun.
#
# Braucht einen Superuser zum Anlegen und Löschen der beiden Datenbanken, z. B.:
#   ADMIN="docker exec -i nf-pg18 psql -U postgres" \
#   OWNER="docker exec -i nf-pg18 psql -U wiki_owner" \
#   DUMP="docker exec -i nf-pg18 pg_dump -U postgres" \
#   bash database/scripts/schema_test/schema_migrations_test.sh
# Ohne Angaben: psql und pg_dump auf diesem Rechner (dieselbe Hauptversion wie der Server).
# Die Datenbanken nf_check_schema und nf_check_migrations werden am Ende wieder gelöscht.
set -euo pipefail

ADMIN=${ADMIN:-psql -U postgres}
OWNER=${OWNER:-psql -U wiki_owner}
DUMP=${DUMP:-pg_dump -U postgres}
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS=$(cd "$HERE/.." && pwd)
A=nf_check_schema
B=nf_check_migrations

fail() { echo "FEHLER: $*" >&2; exit 1; }
ok()   { echo "OK  $*"; }

DIFF=$(mktemp)
drop() { $ADMIN -X -q -d postgres -c "DROP DATABASE IF EXISTS $A" -c "DROP DATABASE IF EXISTS $B" >/dev/null 2>&1 || true; }
trap 'drop; rm -f "$DIFF"' EXIT
drop
for db in $A $B; do
  # Wie roles_database.sql: byteweise Sortierung (pages.position)
  $ADMIN -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE $db OWNER wiki_owner ENCODING 'UTF8'
    TEMPLATE template0 LOCALE_PROVIDER 'builtin' LOCALE 'C' BUILTIN_LOCALE 'C.UTF-8'" >/dev/null
done

# Weg 1: schema/ (wie schema.sql, über bundle.sh, damit psql auch im Container laufen kann)
{ echo '\set ON_ERROR_STOP on'; echo 'BEGIN;'; bash "$SCRIPTS/schema/bundle.sh"; echo 'COMMIT;'; } \
  | $OWNER -X -q -d $A >/dev/null
# Weg 2: alle Migrationen
PSQL="$OWNER -d $B" bash "$SCRIPTS/migrate.sh" >/dev/null

# Vergleich ohne die Buchführung der Migrationen. \restrict-Zeilen enthalten einen
# zufälligen Schlüssel (pg_dump ab 18), sie unterscheiden sich bei jedem Aufruf.
dump() { $DUMP -d "$1" --schema-only --exclude-schema=migrations | tr -d '\r' | grep -v '^\\\(un\)\?restrict '; }
if ! diff <(dump $A) <(dump $B) > "$DIFF" 2>&1; then
  head -60 "$DIFF" >&2
  fail "schema/ und die Migrationen ergeben unterschiedliche Schemas (oben: < schema/, > Migrationen). Fehlt eine Migration, oder weicht sie von schema/ ab?"
fi
ok "1 schema/ und die Migrationen ergeben dasselbe Schema"

OUT=$(PSQL="$OWNER -d $B" bash "$SCRIPTS/migrate.sh")
if grep -q '^Migration [0-9]' <<<"$OUT"; then fail "zweiter Lauf von migrate.sh spielt erneut ein: $OUT"; fi
ok "2 Ein zweiter Lauf von migrate.sh ändert nichts"

echo "Alle Migrationstests bestanden (Datenbanken $A und $B werden wieder gelöscht)."
