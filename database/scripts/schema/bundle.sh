#!/usr/bin/env bash
# Gibt das Schema als eine Datei aus: die Teile in der Reihenfolge der \ir-Zeilen von
# schema.sql, ohne BEGIN/COMMIT und ohne psql-Befehle. Damit lässt es sich über stdin
# einspielen, auch wenn psql woanders läuft als die Dateien liegen (z. B. im Container).
#
#   bash database/scripts/schema/bundle.sh > bundle.sql
#
# Genutzt für die erste Migration (migrations/0001_initial_schema.sql) und für
# schema_test/schema_migrations_test.sh, der prüft, dass schema/ und die Migrationen
# dasselbe Schema ergeben.
set -euo pipefail

DIR=$(cd "$(dirname "$0")" && pwd)
PARTS=$(sed -n 's/^\\ir[[:space:]]\{1,\}\([^[:space:]]*\)[[:space:]]*$/\1/p' "$DIR/schema.sql" | tr -d '\r')
[[ -n "$PARTS" ]] || { echo "bundle.sh: keine \\ir-Zeilen in schema.sql" >&2; exit 1; }

for part in $PARTS; do
  [[ -f "$DIR/$part" ]] || { echo "bundle.sh: $part fehlt" >&2; exit 1; }
  printf '\n-- =============================================================================\n'
  printf -- '-- schema/%s\n' "$part"
  printf -- '-- =============================================================================\n'
  tr -d '\r' < "$DIR/$part"
done
