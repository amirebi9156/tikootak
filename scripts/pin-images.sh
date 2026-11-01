#!/usr/bin/env bash
# Pins the running image versions (by digest) in .env to prevent unwanted upgrades.
# Run only when all services are up and healthy. For a deliberate upgrade: ./scripts/upgrade.sh
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] || { echo "[FAIL] .env not found"; exit 1; }
setv() { sed -i "/^$1=/d;/^# $1=/d" .env; echo "$1=$2" >> .env; }
for pair in caddy:CADDY_IMAGE postgres:POSTGRES_IMAGE synapse:SYNAPSE_IMAGE livekit:LIVEKIT_IMAGE; do
  svc="${pair%%:*}"; key="${pair##*:}"
  cid="$(docker compose ps -q "$svc")"
  [ -n "$cid" ] || { echo "[FAIL] Service $svc is not up"; exit 1; }
  img="$(docker inspect --format '{{.Config.Image}}' "$cid")"
  id="$(docker inspect --format '{{.Image}}' "$cid")"
  repo="${img%%:*}"; repo="${repo%%@*}"
  digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$id" 2>/dev/null || true)"
  if [ -z "$digest" ]; then echo "[WARN] No digest found for $svc; skipped"; continue; fi
  setv "$key" "$digest"
  echo "[OK] $key=$digest"
done
echo "Pinned. To apply: docker compose up -d"
