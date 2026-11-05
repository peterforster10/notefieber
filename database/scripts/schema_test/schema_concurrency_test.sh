#!/usr/bin/env bash
# Prüft die Sperren aus schema.sql mit zwei gleichzeitigen Sitzungen. Das kann
# schema_test.sql nicht, weil ein psql-Skript nur eine Sitzung hat.
#
# Aufruf auf einer Datenbank mit eingespieltem Schema, z. B.:
#   PSQL="psql -U wiki_owner -d wiki" ./schema_concurrency_test.sh
#   PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" ./schema_concurrency_test.sh
#
# Legt einen eigenen Mandanten an (Slug mit Zeitstempel) und lässt ihn stehen: Die Sitzungen
# müssen committen, damit die andere Sitzung warten muss.
set -euo pipefail

PSQL=${PSQL:-psql -U wiki_owner -d wiki}
HOLD=2   # Sekunden, die Sitzung 1 ihre Sperre hält

q()    { $PSQL -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FEHLER: $*" >&2; exit 1; }
ok()   { echo "OK  $*"; }

# --- Aufbau: Mandant, zwei Personen, Space ---------------------------------------
SLUG="nebenlaeufig-$(date +%s)"
T=$(q -c "SET ROLE wiki_app" \
      -c "SELECT app.create_tenant('$SLUG', 'Nebenläufigkeit', 'eu-central', 'anna@$SLUG.example', 'Anna')" | tail -1)
ANNA=$(q -c "SELECT id FROM users WHERE tenant_id = '$T'")
WS=$(q -c "SELECT id FROM workspaces WHERE tenant_id = '$T'")
ctx() { echo "SET ROLE wiki_app; SELECT set_config('app.tenant_id', '$T', false), set_config('app.user_id', '$1', false);"; }
as()  { local user=$1; shift; q -c "$(ctx "$user")" "$@" | tail -1; }

BEN=$(q -c "SELECT uuidv7()")
as "$ANNA" -c "INSERT INTO users (id, tenant_id, email, display_name) VALUES ('$BEN', '$T', 'ben@$SLUG.example', 'Ben')" >/dev/null
as "$ANNA" -c "SELECT app.add_workspace_member('$WS', '$BEN', 'member', '$ANNA')" >/dev/null
SPACE=$(as "$ANNA" -c "SELECT app.create_space('$WS', 'NEBEN', 'Nebenläufig', '$ANNA')")
X=$(as "$ANNA" -c "SELECT app.create_page('$SPACE', NULL, 'X', '$ANNA')")
Y=$(as "$ANNA" -c "SELECT app.create_page('$SPACE', NULL, 'Y', '$ANNA')")

# Sitzung 1 im Hintergrund: Befehl in einer Transaktion, Sperre $HOLD Sekunden halten
hold() {
  local user=$1 sql=$2
  q -c "$(ctx "$user")" -c "BEGIN" -c "$sql" -c "SELECT pg_sleep($HOLD)" -c "COMMIT" >/dev/null &
  sleep 0.5
}
# Sitzung 2: Fehlermeldung zurückgeben (leer, wenn es geklappt hat)
try() { local user=$1 sql=$2; as "$user" -c "$sql" 2>&1 >/dev/null || true; }

# --- 1. Kreuzweises Verschieben erzeugt keinen Zyklus -----------------------------
hold "$ANNA" "SELECT app.move_page('$X', '$Y', 'a0', '$ANNA')"
ERR=$(try "$ANNA" "SELECT app.move_page('$Y', '$X', 'a0', '$ANNA')")
wait
[[ "$ERR" == *"unter sich selbst"* ]] || fail "kreuzweises Verschieben nicht abgelehnt: ${ERR:-kein Fehler}"
ok "1 Kreuzweises Verschieben: die zweite Sitzung wartet und erkennt den Zyklus"

# --- 2. Neue Seite, während die Elternseite verschoben wird: aktueller Pfad -------
hold "$ANNA" "SELECT app.move_page('$X', NULL, 'a5', '$ANNA')"
K=$(as "$ANNA" -c "SELECT app.create_page('$SPACE', '$X', 'Kind', '$ANNA')")
wait
R=$(q -c "SELECT c.path <@ x.path AND nlevel(c.path) = 2 FROM pages c, pages x WHERE c.id = '$K' AND x.id = '$X'")
[[ "$R" == "t" ]] || fail "neue Seite hat einen veralteten Pfad"
ok "2 Neue Seite während des Verschiebens bekommt den neuen Pfad"

# --- 3. Neue Seite, während die Elternseite in den Papierkorb wandert -------------
hold "$ANNA" "SELECT app.trash_page('$X', '$ANNA')"
ERR=$(try "$ANNA" "SELECT app.create_page('$SPACE', '$K', 'Enkel', '$ANNA')")
wait
[[ "$ERR" == *"Papierkorb"* ]] || fail "Seite unter einer Seite im Papierkorb angelegt: ${ERR:-kein Fehler}"
ok "3 Keine neue Seite unter einer Seite, die gerade in den Papierkorb wandert"

# --- 4. Zwei Admins entfernen sich gleichzeitig gegenseitig ----------------------
as "$ANNA" -c "SELECT app.set_grant('$SPACE', NULL, 'user', '$BEN', NULL, 'admin', '$ANNA')" >/dev/null
hold "$ANNA" "SELECT app.set_grant('$SPACE', NULL, 'user', '$BEN', NULL, NULL, '$ANNA')"
ERR=$(try "$BEN" "SELECT app.set_grant('$SPACE', NULL, 'user', '$ANNA', NULL, NULL, '$BEN')")
wait
[[ -n "$ERR" ]] || fail "beide Admins entfernt"
N=$(q -c "SELECT count(*) FROM grants WHERE space_id = '$SPACE' AND role = 'admin'")
[[ "$N" -ge 1 ]] || fail "Space ohne Admin"
ok "4 Zwei Admins entfernen sich gleichzeitig: einer bleibt"

echo "Alle Nebenläufigkeitstests bestanden (Mandant $SLUG bleibt stehen)."
