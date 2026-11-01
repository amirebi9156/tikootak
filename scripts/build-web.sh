#!/usr/bin/env bash
# Only needed when you change the UI code (web-src folder).
# The prebuilt UI is already in web/dist and needs no Node to run.
# This script does the build inside a temporary Node container, so you do not need Node installed.
# Requires internet (downloads the node image and npm packages).
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/repo -w /repo/web-src \
  node:20-bookworm-slim \
  sh -c "npm ci --no-audit --no-fund && npx vite build"

echo "[OK] Done. Output is in web/dist. Refresh the page with Ctrl+Shift+R."
