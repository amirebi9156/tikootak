#!/usr/bin/env bash
# Save the Docker images of THIS server as an offline bundle (for moving to a server without Docker Hub access).
# For a brand-new full kit (app + images + Docker packages) use ./scripts/make-kit.sh on a machine with internet.
# Build an offline bundle of Docker images (for a server without Docker Hub access):
#   ./scripts/pack-offline.sh     ->  offline-images.tar.gz  (next to the project; migrate.sh --offline sends it)
# On the target server, install.sh and restore.sh docker-load this file automatically if present.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
. ./scripts/lib.sh
set -a; . ./.env 2>/dev/null || true; set +a
# On the running server every image already exists locally: save them as they are, no internet needed
# (this is what makes  migrate.sh --offline  work during a blackout). Otherwise pull/build first.
if compose_images_present >/dev/null 2>&1; then
  echo "All images are present locally: no download or build needed"
else
  docker compose pull --ignore-buildable 2>/dev/null || docker compose pull 2>/dev/null || true
  docker compose build
fi
IMAGES="$(docker compose config --images | sort -u)"
echo "$IMAGES"
# shellcheck disable=SC2086
docker save $IMAGES | gzip > offline-images.tar.gz
echo "[OK] Created: offline-images.tar.gz ($(du -h offline-images.tar.gz | cut -f1))"
