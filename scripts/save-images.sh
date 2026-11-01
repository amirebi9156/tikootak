#!/usr/bin/env bash
# Run on a server (or your own machine) that can reach Docker Hub.
# Copy the resulting images.tar.gz to the Iran server and load it with load-images.sh.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
docker compose pull --ignore-buildable
docker compose build
IMAGES="$(docker compose config --images | sort -u)"
echo "Saving: $IMAGES"
# shellcheck disable=SC2086
docker save $IMAGES | gzip > images.tar.gz
ls -lh images.tar.gz
