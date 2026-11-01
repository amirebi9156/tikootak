#!/usr/bin/env bash
# Load images on a server without access to Docker Hub.
# After this, install.sh uses the local images without pulling.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
FILE="${1:-images.tar.gz}"
[ -f "$FILE" ] || { echo "[FAIL] File not found: $FILE"; exit 1; }
gunzip -c "$FILE" | docker load
