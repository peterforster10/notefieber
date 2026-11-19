#!/usr/bin/env bash
# Prüft die Sperren aus schema.sql mit zwei gleichzeitigen Sitzungen. Das kann
# schema_test.sql nicht, weil ein psql-Skript nur eine Sitzung hat.
#
# Aufruf auf einer Datenbank mit eingespieltem Schema, z. B.:
#   PSQL="psql -U wiki_owner -d wiki" ./schema_concurrency_test.sh
#   PSQL="docker exec -i nf-pg18 psql -U wiki_owner -d wiki" ./schema_concurrency_test.sh
#
# Legt einen eigenen Mandanten an (Slug mit Zeitstempel), weil die Sitzungen committen
# müssen, damit die andere Sitzung warten muss. Am Ende, auch nach einem Fehler, löscht das
# Skript ihn wieder (als wiki_owner, der RLS umgeht).
set -euo pipefail

PSQL=${PSQL:-psql -U wiki_owner -d wiki}
HOLD=2   # Sekunden, die Sitzung 1 ihre Sperre hält

q()    { $PSQL -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FEHLER: $*" >&2; exit 1; }
ok()   { echo "OK  $*"; }

# --- Aufbau: Mandant, zwei Personen, Space ---------------------------------------
SLUG="nebenlaeufig-$(date +%s)"
T=$(q -c "SET ROLE wiki_app" \
      -c "SELECT app.create_tenant('$SLUG', 'Nebenläufigkeit', 'eu-central', 'peter@$SLUG.example', 'Peter')" | tail -1)

# Mandanten mit allem, was an ihm hängt, wieder löschen. Eine Funktion zum Löschen von
# Mandanten gibt es nicht; die Reihenfolge folgt den Fremdschlüsseln. Der Trigger für den
# letzten Organisations-Admin würde das Löschen der letzten Person verhindern und ist
# deshalb nur in dieser Transaktion abgeschaltet (wiki_owner besitzt die Tabelle).
cleanup() {
  wait 2>/dev/null || true   # Sitzungen im Hintergrund zuerst beenden lassen
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL || echo "FEHLER: Mandant $SLUG nicht gelöscht" >&2
BEGIN;
UPDATE users  SET avatar_file_id = NULL WHERE tenant_id = '$T';
UPDATE spaces SET home_page_id = NULL   WHERE tenant_id = '$T';
DELETE FROM outbox       WHERE tenant_id = '$T';
DELETE FROM audit_log    WHERE tenant_id = '$T';
DELETE FROM import_items WHERE tenant_id = '$T';
DELETE FROM imports      WHERE tenant_id = '$T';
DELETE FROM comments     WHERE tenant_id = '$T';
DELETE FROM page_links   WHERE tenant_id = '$T';
DELETE FROM page_search  WHERE tenant_id = '$T';
DELETE FROM page_versions WHERE tenant_id = '$T';
DELETE FROM page_contents WHERE tenant_id = '$T';
DELETE FROM grants       WHERE tenant_id = '$T';
DELETE FROM files        WHERE tenant_id = '$T';
DELETE FROM pages        WHERE tenant_id = '$T';
DELETE FROM spaces       WHERE tenant_id = '$T';
DELETE FROM invites      WHERE tenant_id = '$T';
DELETE FROM workspaces   WHERE tenant_id = '$T';   -- Mitgliedschaften fallen mit
DELETE FROM groups       WHERE tenant_id = '$T';   -- Gruppenmitglieder fallen mit
ALTER TABLE users DISABLE TRIGGER protect_last_org_admin;
DELETE FROM users        WHERE tenant_id = '$T';
ALTER TABLE users ENABLE TRIGGER protect_last_org_admin;
DELETE FROM tenants      WHERE id = '$T';
COMMIT;
SQL
}
trap cleanup EXIT

PETER=$(q -c "SELECT id FROM users WHERE tenant_id = '$T'")
WS=$(q -c "SELECT id FROM workspaces WHERE tenant_id = '$T'")
ctx() { echo "SET ROLE wiki_app; SELECT set_config('app.tenant_id', '$T', false), set_config('app.user_id', '$1', false);"; }
as()  { local user=$1; shift; q -c "$(ctx "$user")" "$@" | tail -1; }

BEN=$(q -c "SELECT uuidv7()")
# Als Eigentümer: wiki_app legt keine Personen an, neue kommen nur über Einladungen (R-06)
q -c "INSERT INTO users (id, tenant_id, email, display_name) VALUES ('$BEN', '$T', 'ben@$SLUG.example', 'Ben')" >/dev/null
as "$PETER" -c "SELECT app.add_workspace_member('$WS', '$BEN', 'member', '$PETER')" >/dev/null
SPACE=$(as "$PETER" -c "SELECT app.create_space('$WS', 'NEBEN', 'Nebenläufig', '$PETER')")
X=$(as "$PETER" -c "SELECT app.create_page('$SPACE', NULL, 'X', '$PETER')")
Y=$(as "$PETER" -c "SELECT app.create_page('$SPACE', NULL, 'Y', '$PETER')")

# Sitzung 1 im Hintergrund: Befehl in einer Transaktion, Sperre $HOLD Sekunden halten
hold() {
  local user=$1 sql=$2
  q -c "$(ctx "$user")" -c "BEGIN" -c "$sql" -c "SELECT pg_sleep($HOLD)" -c "COMMIT" >/dev/null &
  sleep 0.5
}
# Sitzung 2: Fehlermeldung zurückgeben (leer, wenn es geklappt hat)
try() { local user=$1 sql=$2; as "$user" -c "$sql" 2>&1 >/dev/null || true; }

# --- 1. Kreuzweises Verschieben erzeugt keinen Zyklus -----------------------------
hold "$PETER" "SELECT app.move_page('$X', '$Y', 'a0', '$PETER')"
ERR=$(try "$PETER" "SELECT app.move_page('$Y', '$X', 'a0', '$PETER')")
wait
[[ "$ERR" == *"unter sich selbst"* ]] || fail "kreuzweises Verschieben nicht abgelehnt: ${ERR:-kein Fehler}"
ok "1 Kreuzweises Verschieben: die zweite Sitzung wartet und erkennt den Zyklus"

# --- 2. Neue Seite, während die Elternseite verschoben wird: aktueller Pfad -------
hold "$PETER" "SELECT app.move_page('$X', NULL, 'a5', '$PETER')"
K=$(as "$PETER" -c "SELECT app.create_page('$SPACE', '$X', 'Kind', '$PETER')")
wait
R=$(q -c "SELECT c.path <@ x.path AND nlevel(c.path) = 2 FROM pages c, pages x WHERE c.id = '$K' AND x.id = '$X'")
[[ "$R" == "t" ]] || fail "neue Seite hat einen veralteten Pfad"
ok "2 Neue Seite während des Verschiebens bekommt den neuen Pfad"

# --- 3. Neue Seite, während die Elternseite in den Papierkorb wandert -------------
hold "$PETER" "SELECT app.trash_page('$X', '$PETER')"
ERR=$(try "$PETER" "SELECT app.create_page('$SPACE', '$K', 'Enkel', '$PETER')")
wait
[[ "$ERR" == *"Papierkorb"* ]] || fail "Seite unter einer Seite im Papierkorb angelegt: ${ERR:-kein Fehler}"
ok "3 Keine neue Seite unter einer Seite, die gerade in den Papierkorb wandert"

# --- 4. Zwei Admins entfernen sich gleichzeitig gegenseitig ----------------------
as "$PETER" -c "SELECT app.set_grant('$SPACE', NULL, 'user', '$BEN', NULL, 'admin', '$PETER')" >/dev/null
hold "$PETER" "SELECT app.set_grant('$SPACE', NULL, 'user', '$BEN', NULL, NULL, '$PETER')"
ERR=$(try "$BEN" "SELECT app.set_grant('$SPACE', NULL, 'user', '$PETER', NULL, NULL, '$BEN')")
wait
[[ -n "$ERR" ]] || fail "beide Admins entfernt"
N=$(q -c "SELECT count(*) FROM grants WHERE space_id = '$SPACE' AND role = 'admin'")
[[ "$N" -ge 1 ]] || fail "Space ohne Admin"
ok "4 Zwei Admins entfernen sich gleichzeitig: einer bleibt"

# --- 5. Ereignisse und Abmelden kommen per NOTIFY beim Collab-Server an ---------
# Sitzung 1 hört zu (wie der Collab-Server, als wiki_worker); psql gibt Benachrichtigungen
# nach dem nächsten Befehl aus. Sitzung 2 ändert ein Recht und meldet eine Sitzung ab.
TOKEN=$(printf "abmelden-%s" "$SLUG" | sha256sum | cut -c1-64)   # wie hashToken: 64 Hex-Zeichen
as "$BEN" -c "SELECT app.create_session('$BEN', '$TOKEN', now() + interval '1 hour', 'test')" >/dev/null
SID=$(q -c "SELECT id FROM sessions WHERE token_hash = '$TOKEN'")
LOG=$(mktemp)
q -c "SET ROLE wiki_worker" -c "LISTEN nf_events" -c "LISTEN nf_sessions" \
  -c "SELECT pg_sleep($HOLD)" -c "SELECT 1" > "$LOG" 2>&1 &
sleep 0.5
as "$PETER" -c "SELECT app.set_grant('$SPACE', NULL, 'user', '$BEN', NULL, 'viewer', '$PETER')" >/dev/null
q -c "SET ROLE wiki_app" -c "SELECT app.end_session('$TOKEN')" >/dev/null
# Zurückgerollt: keine Benachrichtigung
q -c "$(ctx "$PETER")" -c "BEGIN" \
  -c "SELECT app.set_grant('$SPACE', NULL, 'user', '$BEN', NULL, 'editor', '$PETER')" -c "ROLLBACK" >/dev/null
wait
grep -q "\"tenant\" : \"$T\", \"space\" : \"$SPACE\", \"type\" : \"grant.changed\"" "$LOG" \
  || { cat "$LOG" >&2; rm -f "$LOG"; fail "grant.changed nicht per NOTIFY nf_events gemeldet"; }
grep -q "\"session\" : \"$SID\"" "$LOG" \
  || { cat "$LOG" >&2; rm -f "$LOG"; fail "Abmelden nicht per NOTIFY nf_sessions gemeldet"; }
N=$(grep -c "grant.changed" "$LOG" || true)
rm -f "$LOG"
[[ "$N" -eq 1 ]] || fail "$N Benachrichtigungen für grant.changed statt einer (zurückgerollt mitgemeldet?)"
ok "5 Ereignisse und Abmelden kommen per NOTIFY an, zurückgerollte nicht"

echo "Alle Nebenläufigkeitstests bestanden (Mandant $SLUG wird wieder gelöscht)."
