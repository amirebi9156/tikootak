#!/usr/bin/env bash
# Safe upgrade: backup first, then rebuild gateway and web, then run doctor.
# Upgrade third-party images (Synapse/LiveKit/...): ./scripts/upgrade.sh --images
# (pulls the latest versions and pins them again; if something breaks, the backup is right here.)
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
echo "1) Backup..."
./scripts/backup.sh
if [ "${1:-}" = "--images" ]; then
  echo "2) Pulling new images (previous pins are removed)..."
  sed -i '/^\(CADDY\|POSTGRES\|SYNAPSE\|LIVEKIT\)_IMAGE=/d' .env
  docker compose pull
fi
echo "3) Building web and gateway..."
[ -x scripts/build-web.sh ] && ./scripts/build-web.sh || true
chown -R 1000:1000 data/gateway 2>/dev/null || true
docker compose up -d --build
docker compose up -d --force-recreate caddy   # Caddyfile may have changed (bind mount)
sleep 8
./scripts/doctor.sh || { echo "[FAIL] doctor found a problem. Roll back: ./scripts/restore.sh backups/<latest-file>"; exit 1; }
[ "${1:-}" = "--images" ] && ./scripts/pin-images.sh || true
echo "[OK] Upgrade finished."
