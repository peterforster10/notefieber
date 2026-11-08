#!/usr/bin/env bash
# Richtet einen leeren PostgreSQL-18-Server so ein wie der erste Start der lokalen Umgebung
# (docker/postgres/initdb/10-notefieber.sh): Rollen und Datenbank, Migrationen, Login-Rollen
# der Apps, Testdaten. Für die API-Tests in der CI (.gitlab-ci.yml, Job api), wo psql nicht
# im Container des Servers läuft, sondern im Job.
#
#   PGHOST=postgres bash database/scripts/setup_test_db.sh
#
# Verbindung über die Variablen von libpq (PGHOST, PGPORT, PGPASSWORD …); postgres und
# wiki_owner müssen ohne Passwort (trust) oder mit PGPASSWORD hineinkommen. Bricht ab, wenn
# es die Datenbank wiki schon gibt: nie gegen eine Datenbank, mit der man arbeitet.
set -euo pipefail

SCRIPTS=$(cd "$(dirname "$0")" && pwd)

for i in $(seq 1 60); do
  pg_isready -q -U postgres && break
  [[ $i -lt 60 ]] || { echo "FEHLER: PostgreSQL antwortet nicht" >&2; exit 1; }
  sleep 1
done
if [[ -n "$(psql -X -U postgres -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'wiki'")" ]]; then
  echo "FEHLER: Datenbank wiki gibt es schon; setup_test_db.sh braucht einen leeren Server" >&2; exit 1
fi

echo "Rollen und Datenbank"
psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$SCRIPTS/roles_database.sql"
echo "Migrationen"
PSQL="psql -X -U wiki_owner -d wiki" bash "$SCRIPTS/migrate.sh"
echo "Login-Rollen der Apps"
psql -X -q -v ON_ERROR_STOP=1 -U postgres -d wiki -f "$SCRIPTS/local_login_roles.sql"
echo "Testdaten"
psql -X -v ON_ERROR_STOP=1 -U wiki_owner -d wiki -f "$SCRIPTS/seed/seed.sql" | tail -1
