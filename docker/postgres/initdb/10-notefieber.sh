#!/usr/bin/env bash
# Ersteinrichtung der lokalen Datenbank (compose.yaml, docs/LOCAL_SETUP.md).
# Läuft nur beim allerersten Start, wenn das Volume noch leer ist: Das Image postgres:18
# führt Dateien aus /docker-entrypoint-initdb.d genau dann aus. Bei jedem weiteren Start
# bleibt die Datenbank, wie sie ist; neue Migrationen spielt dann
#   docker exec nf-pg18 bash /scripts/migrate.sh
# ein (docs/LOCAL_SETUP.md, „Das Schema ändern“).
#
# Spielt in dieser Reihenfolge ein:
#   1. roles_database.sql  als postgres    (Rollen, Datenbank wiki)
#   2. migrate.sh          als wiki_owner  (alle Migrationen aus migrations/; nie als
#                                           postgres, sonst liefen die SECURITY-DEFINER-
#                                           Funktionen als Superuser)
#   3. seed/seed.sql       als wiki_owner  (Testdaten, nur wenn NF_SEED=true)
#
# Der Entrypoint führt die Datei aus oder liest sie ein (je nach Dateirechten). Deshalb
# kein exit und kein set -u; ein Fehler bricht die Einrichtung über ON_ERROR_STOP ab.
set -e

echo "NoteFieber: Rollen und Datenbank (roles_database.sql)"
psql -v ON_ERROR_STOP=1 -q --username "$POSTGRES_USER" --dbname postgres -f /scripts/roles_database.sql

echo "NoteFieber: Schema (migrate.sh)"
PSQL="psql --username wiki_owner --dbname wiki" bash /scripts/migrate.sh

if [ "${NF_SEED:-true}" = "true" ]; then
  echo "NoteFieber: Testdaten (seed/seed.sql)"
  psql -v ON_ERROR_STOP=1 --username wiki_owner --dbname wiki -f /scripts/seed/seed.sql
else
  echo "NoteFieber: Testdaten übersprungen (NF_SEED=${NF_SEED})"
fi
