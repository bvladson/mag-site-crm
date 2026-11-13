#!/bin/sh
# Consistent session backup. Pauses only this WAHA connector, never the MAG app/Omie.
set -eu
umask 077
ROOT=${1:-/opt/mag-whatsapp}
OUT=${2:-/srv/mag-site/backups}
case "$ROOT" in /opt/mag-whatsapp|/opt/mag-waha-stage-*|/tmp/mag-waha-*) ;; *) echo "WAHA directory not approved" >&2; exit 2;; esac
[ -f "$ROOT/compose.yaml" ] && [ -d "$ROOT/secrets" ] || { echo "WAHA configuration not found" >&2; exit 1; }
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M%S)
PACKAGE=$OUT/waha-$STAMP.tar.gz
WAS_RUNNING=$(cd "$ROOT" && docker compose ps -q --status running waha)
resume() { if [ -n "$WAS_RUNNING" ]; then (cd "$ROOT" && docker compose start waha) >&2; fi; }
trap resume EXIT
if [ -n "$WAS_RUNNING" ]; then (cd "$ROOT" && docker compose stop -t 30 waha) >&2; fi
# No credentials or session files are sent to stdout.
if [ -f "$ROOT/.env" ]; then
  tar -C "$ROOT" -czf "$PACKAGE" compose.yaml .env secrets data
else
  tar -C "$ROOT" -czf "$PACKAGE" compose.yaml secrets data
fi
chmod 600 "$PACKAGE"
gzip -t "$PACKAGE"
echo "$PACKAGE"
