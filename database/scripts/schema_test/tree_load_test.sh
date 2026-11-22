#!/usr/bin/env bash
# Lastprüfung für den Seitenbaum (ARCHITECTURE_REVIEW.md, A-01; ROADMAP M2/M3): ein Space mit
# gut 10.000 Seiten, jede 50. Seite mit eigenen Rechten. Misst app.tree_level als wiki_app für
# mehrere Ebenen und zwei Personen, einmal direkt nach dem Anlegen (ohne Statistik, wie nach
# einem Import) und einmal nach ANALYZE. Zum Vergleich einmal der frühere flache Baum
# (alle Seiten mit page_role, über die Leseregel).
#
# Aufruf auf einer Datenbank mit eingespieltem Schema, nie mit echten Daten, z. B. im
# Wegwerf-Container der API-Tests (docs/LOCAL_SETUP.md, Abschnitt 7):
#   PSQL="docker exec -i nf-pg18-apitest psql -U wiki_owner -d wiki" bash database/scripts/schema_test/tree_load_test.sh
#
# Legt einen eigenen Mandanten an und löscht ihn am Ende wieder (auch nach einem Fehler).
# Ziel: unter 100 ms pro Ebene. Scheitert, wenn eine Ebene länger als 1 s braucht (Gate M3:
# Seitenbaum unter einer Sekunde). Etwa eine Minute. Nicht Teil von ci.sh.
set -euo pipefail

PSQL=${PSQL:-psql -U wiki_owner -d wiki}
RUNS=${RUNS:-5}       # Wiederholungen pro Messung, gemeldet wird die schnellste und der Median
LIMIT_MS=1000

q()    { $PSQL -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FEHLER: $*" >&2; exit 1; }

# --- Aufbau ------------------------------------------------------------------------
SLUG="baumlast-$(date +%s)"
T=$(q -c "SET ROLE wiki_app" \
      -c "SELECT app.create_tenant('$SLUG', 'Baumlast', 'eu-central', 'peter@$SLUG.example', 'Peter')" | tail -1)

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL || echo "FEHLER: Mandant $SLUG nicht gelöscht" >&2
BEGIN;
UPDATE spaces SET home_page_id = NULL WHERE tenant_id = '$T';
DELETE FROM outbox        WHERE tenant_id = '$T';
DELETE FROM audit_log     WHERE tenant_id = '$T';
DELETE FROM page_contents WHERE tenant_id = '$T';
DELETE FROM grants        WHERE tenant_id = '$T';
DELETE FROM pages         WHERE tenant_id = '$T';
DELETE FROM spaces        WHERE tenant_id = '$T';
DELETE FROM workspaces    WHERE tenant_id = '$T';
ALTER TABLE users DISABLE TRIGGER protect_last_org_admin;
DELETE FROM users         WHERE tenant_id = '$T';
ALTER TABLE users ENABLE TRIGGER protect_last_org_admin;
DELETE FROM tenants       WHERE id = '$T';
COMMIT;
SQL
}
trap cleanup EXIT

PETER=$(q -c "SELECT id FROM users WHERE tenant_id = '$T'")
WS=$(q -c "SELECT id FROM workspaces WHERE tenant_id = '$T'")
ctx() { echo "SET ROLE wiki_app; SELECT set_config('app.tenant_id', '$T', false), set_config('app.user_id', '$1', false);"; }
as()  { local user=$1; shift; q -c "$(ctx "$user")" "$@" | tail -1; }

BEN=$(q -c "SELECT uuidv7()")
q -c "INSERT INTO users (id, tenant_id, email, display_name) VALUES ('$BEN', '$T', 'ben@$SLUG.example', 'Ben')" >/dev/null
as "$PETER" -c "SELECT app.add_workspace_member('$WS', '$BEN', 'member', '$PETER')" >/dev/null
# Alle im Workspace lesen, Peter ist Admin
SPACE=$(as "$PETER" -c "SELECT app.create_space('$WS', 'LAST', 'Lastprüfung', '$PETER')")
HOME_PAGE=$(q -c "SELECT home_page_id FROM spaces WHERE id = '$SPACE'")

# Seiten direkt als Eigentümer (die Funktionen wären für 10.000 Seiten zu langsam): unter der
# Startseite 100 Bereiche, je 10 Abschnitte, je 9 Seiten. Jede 50. Seite hat eigene Rechte:
# Peter Admin, Ben bei jeder zweiten davon Leser. Eine Transaktion, damit admin_remains passt.
echo "Lege 10.100 Seiten an …"
q >/dev/null <<SQL
BEGIN;
CREATE FUNCTION pg_temp.pos(i integer) RETURNS text LANGUAGE sql IMMUTABLE AS \$\$
  SELECT CASE WHEN i < 62 THEN 'a' || substr(d, i + 1, 1)
              ELSE 'b' || substr(d, i / 62 + 1, 1) || substr(d, i % 62 + 1, 1) END
  FROM (SELECT '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS d) x
\$\$;
CREATE TEMP TABLE plan (id uuid, parent_id uuid, n integer, lvl integer, i integer);
INSERT INTO plan SELECT uuidv7(), '$HOME_PAGE', a, 1, a FROM generate_series(0, 99) a;
INSERT INTO plan SELECT uuidv7(), p.id, 0, 2, s FROM plan p, generate_series(0, 9) s WHERE p.lvl = 1;
INSERT INTO plan SELECT uuidv7(), p.id, 0, 3, l FROM plan p, generate_series(0, 8) l WHERE p.lvl = 2;
UPDATE plan SET n = x.rn FROM (SELECT id, row_number() OVER (ORDER BY lvl, id) AS rn FROM plan) x WHERE x.id = plan.id;
INSERT INTO pages (id, tenant_id, space_id, parent_id, position, title, inherit_perms, created_by)
SELECT id, '$T', '$SPACE', parent_id, pg_temp.pos(i), 'Seite ' || n, n % 50 <> 0, '$PETER'
FROM plan ORDER BY lvl, id;
INSERT INTO grants (tenant_id, page_id, subject_type, user_id, role, created_by)
SELECT '$T', id, 'user', '$PETER', 'admin', '$PETER' FROM plan WHERE n % 50 = 0;
INSERT INTO grants (tenant_id, page_id, subject_type, user_id, role, created_by)
SELECT '$T', id, 'user', '$BEN', 'viewer', '$PETER' FROM plan WHERE n % 100 = 0;
COMMIT;
SQL

AREA=$(q -c "SELECT id FROM pages WHERE parent_id = '$HOME_PAGE' AND inherit_perms ORDER BY position, id LIMIT 1")
SECTION=$(q -c "SELECT id FROM pages WHERE parent_id = '$AREA' AND inherit_perms ORDER BY position, id LIMIT 1")
echo "$(q -c "SELECT count(*) FROM pages WHERE space_id = '$SPACE'") Seiten, davon $(q -c "SELECT count(*) FROM pages WHERE space_id = '$SPACE' AND NOT inherit_perms") mit eigenen Rechten"

# --- Messen -----------------------------------------------------------------------
# Schnellste und mittlere Laufzeit von app.tree_level in ms, dazu die Zahl der Seiten
measure() {
  local user=$1 parent=$2
  as "$user" -c "
    CREATE FUNCTION pg_temp.ms(p_parent uuid) RETURNS text LANGUAGE plpgsql AS \$\$
    DECLARE t timestamptz; d numeric[] := '{}'; n integer;
    BEGIN
      FOR i IN 1..$RUNS LOOP
        t := clock_timestamp();
        SELECT count(*) INTO n FROM app.tree_level('$SPACE', p_parent);
        d := d || (extract(epoch FROM clock_timestamp() - t) * 1000)::numeric;
      END LOOP;
      SELECT array_agg(x ORDER BY x) INTO d FROM unnest(d) x;
      RETURN round(d[1], 1) || ' ' || round(d[($RUNS + 1) / 2], 1) || ' ' || n;
    END \$\$;" \
    -c "SELECT pg_temp.ms(${parent})"
}

WORST=0
report() {
  local title=$1
  echo
  echo "$title (ms, schnellste / Median, Seiten in der Ebene)"
  for who in PETER BEN; do
    local user=${!who}
    for level in "oberste Ebene:NULL" "unter der Startseite:'$HOME_PAGE'" "Bereich:'$AREA'" "Abschnitt:'$SECTION'"; do
      read -r best median n <<<"$(measure "$user" "${level#*:}")"
      printf '  %-6s %-22s %8s %8s %6s\n' "$who" "${level%%:*}" "$best" "$median" "$n"
      WORST=$(awk -v a="$WORST" -v b="$median" 'BEGIN { print (b > a) ? b : a }')
    done
  done
}

report "Ohne Statistik (direkt nach dem Anlegen)"
q -c "ANALYZE pages; ANALYZE grants;" >/dev/null
report "Nach ANALYZE"

echo
FLAT=$(as "$BEN" -c "
  CREATE FUNCTION pg_temp.flat() RETURNS text LANGUAGE plpgsql AS \$\$
  DECLARE t timestamptz := clock_timestamp(); n integer;
  BEGIN
    SELECT count(*) INTO n FROM (SELECT id, app.page_role(id) FROM pages
                                 WHERE space_id = '$SPACE' AND deleted_at IS NULL) x;
    RETURN round((extract(epoch FROM clock_timestamp() - t) * 1000)::numeric) || ' ms für ' || n || ' Seiten';
  END \$\$;" -c "SELECT pg_temp.flat()")
echo "Zum Vergleich der frühere flache Baum (Ben, nach ANALYZE): $FLAT"

if awk -v w="$WORST" -v l="$LIMIT_MS" 'BEGIN { exit !(w > l) }'; then
  fail "langsamste Ebene $WORST ms (Grenze $LIMIT_MS ms)"
fi
echo "Lastprüfung bestanden: langsamste Ebene (Median) $WORST ms (Ziel unter 100 ms, Grenze $LIMIT_MS ms)."
