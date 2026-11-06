#!/bin/sh
# Einrichtung von Garage für die lokale Entwicklung (Dienst garage-init in compose.yaml).
# Läuft bei jedem Start des Dienstes. Jeder Schritt prüft, ob er schon erledigt ist; ein
# zweiter Lauf ändert also nichts. Danach bleibt der Container wartend stehen und meldet
# „healthy“: So wartet "docker compose up --wait", bis Garage nutzbar ist (ein Dienst, der
# sich beendet, gilt für --wait als Fehler, auch mit Exitcode 0).
#
#   1. Speicher-Layout für den einzigen Knoten festlegen (sonst nimmt Garage nichts an)
#   2. Zugangsschlüssel mit fester ID und festem Geheimnis importieren (aus der .env)
#   3. Bucket anlegen und dem Schlüssel Lesen, Schreiben und Verwalten erlauben
#
# Spricht nur mit der Admin-API (v2) von Garage; das Garage-Image selbst hat keine Shell.
set -eu

API="http://garage:3903"
AUTH="Authorization: Bearer ${GARAGE_ADMIN_TOKEN}"
JSON="Content-Type: application/json"

api() {  # api <Methode> <Pfad> [JSON-Daten]
  if [ $# -ge 3 ]; then
    curl -sS -X "$1" -H "$AUTH" -H "$JSON" "$API$2" -d "$3"
  else
    curl -sS -X "$1" -H "$AUTH" "$API$2"
  fi
}

echo "Garage: warte auf die Admin-API"
i=0
until api GET /v2/GetClusterStatus >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -le 30 ] || { echo "Garage antwortet nicht"; exit 1; }
  sleep 1
done

# 1. Layout
if api GET /v2/GetClusterLayout | grep -q '"version": 0'; then
  node=$(api GET /v2/GetClusterStatus | grep -m1 -o '"id": "[0-9a-f]*"' | cut -d'"' -f4)
  echo "Garage: Layout für Knoten ${node%"${node#????????????}"}… (${GARAGE_CAPACITY} Byte)"
  api POST /v2/UpdateClusterLayout \
    "{\"roles\":[{\"id\":\"$node\",\"zone\":\"local\",\"capacity\":${GARAGE_CAPACITY},\"tags\":[]}]}" >/dev/null
  api POST /v2/ApplyClusterLayout '{"version":1}' >/dev/null
else
  echo "Garage: Layout schon festgelegt"
fi

# 2. Zugangsschlüssel
out=$(api POST /v2/ImportKey \
  "{\"accessKeyId\":\"${S3_ACCESS_KEY_ID}\",\"secretAccessKey\":\"${S3_SECRET_ACCESS_KEY}\",\"name\":\"${S3_KEY_NAME}\"}")
case "$out" in
  *KeyAlreadyExists*) echo "Garage: Schlüssel ${S3_ACCESS_KEY_ID} schon vorhanden" ;;
  *'"accessKeyId"'*)  echo "Garage: Schlüssel ${S3_ACCESS_KEY_ID} importiert" ;;
  *) echo "Garage: Schlüssel nicht importiert: $out"; exit 1 ;;
esac

# 3. Bucket und Rechte
out=$(api POST /v2/CreateBucket "{\"globalAlias\":\"${S3_BUCKET}\"}")
case "$out" in
  *BucketAlreadyExists*) echo "Garage: Bucket ${S3_BUCKET} schon vorhanden" ;;
  *'"id"'*)              echo "Garage: Bucket ${S3_BUCKET} angelegt" ;;
  *) echo "Garage: Bucket nicht angelegt: $out"; exit 1 ;;
esac
bucket=$(api GET "/v2/GetBucketInfo?globalAlias=${S3_BUCKET}" | grep -m1 -o '"id": "[0-9a-f]*"' | cut -d'"' -f4)
api POST /v2/AllowBucketKey \
  "{\"bucketId\":\"$bucket\",\"accessKeyId\":\"${S3_ACCESS_KEY_ID}\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" >/dev/null

# Bereit, sobald Garage das Layout übernommen hat
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$API/health")" = "200" ]; do
  i=$((i + 1)); [ "$i" -le 30 ] || { echo "Garage wird nicht bereit"; exit 1; }
  sleep 1
done
echo "Garage: bereit, Bucket ${S3_BUCKET} mit Schlüssel ${S3_ACCESS_KEY_ID}"

# Für den Healthcheck markieren und warten, bis Compose den Container stoppt
touch /tmp/garage-ready
exec tail -f /dev/null
