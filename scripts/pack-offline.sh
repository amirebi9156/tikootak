#!/usr/bin/env bash
# Build an offline bundle of Docker images (for a server without Docker Hub access):
#   ./scripts/pack-offline.sh     ->  offline-images.tar.gz  (next to the project; migrate.sh --offline sends it)
# On the target server, install.sh and restore.sh docker-load this file automatically if present.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env 2>/dev/null || true; set +a
docker compose pull --ignore-buildable 2>/dev/null || docker compose pull 2>/dev/null || true
docker compose build
IMAGES="$(docker compose config --images | sort -u)"
echo "$IMAGES"
# shellcheck disable=SC2086
docker save $IMAGES | gzip > offline-images.tar.gz
echo "[OK] Created: offline-images.tar.gz ($(du -h offline-images.tar.gz | cut -f1))"
