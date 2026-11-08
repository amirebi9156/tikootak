#!/usr/bin/env bash
# Builds the FULL OFFLINE KIT: one file that installs TIKOOTAK on a server with NO access to GitHub, Docker Hub, npm or apt.
# Run it on a machine that has Docker and free internet (a foreign server, WSL2, a Linux PC). Not on the Iran server.
#
#   ./scripts/make-kit.sh [--with-docker-debs ubuntu:24.04,ubuntu:22.04] [--platform linux/amd64] [--out DIR]
#
# Result (in --out, default ./kit-out):
#   tikootak-full-<version>.tar          copy this to the server (scp / USB / any file host)
#   tikootak-full-<version>.tar.sha256
# On the server:
#   tar -xf tikootak-full-<version>.tar && cd tikootak && sudo ./scripts/bootstrap.sh --domain YOUR.DOMAIN --yes
# The kit contains: the app (with the prebuilt web UI), all Docker images (Caddy, Postgres, Synapse, LiveKit and the
# already-built gateway), and optionally the Docker engine packages for a fresh Ubuntu/Debian server.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"

DEBS=""; PLATFORM="linux/amd64"; OUTDIR="$ROOT/kit-out"
while [ $# -gt 0 ]; do
  case "$1" in
    --with-docker-debs) DEBS="$2"; shift;;
    --platform) PLATFORM="$2"; shift;;
    --out) OUTDIR="$2"; shift;;
    -h|--help) sed -n 2,16p "$0"; exit 0;;
    *) echo "Unknown option: $1"; exit 1;;
  esac; shift
done
command -v docker >/dev/null && docker compose version >/dev/null 2>&1 || { echo "[FAIL] Docker with the compose plugin is required on this machine"; exit 1; }
VER="$(tr -d ' \r\n' < VERSION)"
echo "== Building the offline kit for TIKOOTAK $VER ($PLATFORM)"
export DOCKER_DEFAULT_PLATFORM="$PLATFORM"

# 1) the web UI must exist (the release tar already has it; a git checkout does not)
if [ ! -f web/dist/index.html ]; then
  echo "== web/dist is missing: building the UI (needs npm access inside a node container)"
  ./scripts/build-web.sh
fi

# 2) images: resolve the list from docker-compose.yml with an EMPTY env file (so a real .env never leaks into the kit)
EMPTY_ENV="$(mktemp)"; STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE" "$EMPTY_ENV"' EXIT
CP=(docker compose --env-file "$EMPTY_ENV")
echo "== Pulling third-party images"
"${CP[@]}" pull --ignore-buildable
echo "== Building the gateway image (this is what makes the server need no npm/apt)"
"${CP[@]}" build gateway
IMAGES="$("${CP[@]}" config --images 2>/dev/null | sort -u)"
echo "Images in the kit:"; echo "$IMAGES" | sed 's/^/  - /'

# 3) stage the project tree
mkdir -p "$STAGE/tikootak"
tar cf - --exclude=.git --exclude=.github --exclude=node_modules --exclude='*.db' \
  --exclude=./config --exclude=./.env --exclude=./data --exclude=./backups --exclude=./certs \
  --exclude=./gateway/bin --exclude=./web-src/node_modules --exclude=./kit-out --exclude='./offline-images*' \
  --exclude=./offline --exclude=./images.tar.gz --exclude=./.releases --exclude=./updates --exclude=./.update.conf \
  --exclude=./.monitor.state . | tar xf - -C "$STAGE/tikootak"
[ -f "$STAGE/tikootak/web/dist/index.html" ] || { echo "[FAIL] web/dist/index.html is not in the kit"; exit 1; }

# 4) images -> offline-images.tar.gz (inside the project folder, where bootstrap/restore look for it)
echo "== Saving images (a few minutes)"
# shellcheck disable=SC2086
docker save $IMAGES | gzip -6 > "$STAGE/tikootak/offline-images.tar.gz"
printf '%s\n' "$IMAGES" > "$STAGE/tikootak/offline-images.list"

# 5) Docker engine packages for fresh servers (optional)
if [ -n "$DEBS" ]; then
  IFS=',' read -ra TARGETS <<< "$DEBS"
  for t in "${TARGETS[@]}"; do
    name="${t/:/-}"   # ubuntu:24.04 -> ubuntu-24.04 (bootstrap matches /etc/os-release ID-VERSION_ID)
    echo "== Docker packages for $t"
    ./scripts/fetch-docker-debs.sh "$t" "$STAGE/tikootak/offline/docker/$name"
  done
  echo "== docker compose plugin binary (fallback for releases without docker-compose-v2)"
  case "$PLATFORM" in linux/arm64) CARCH=aarch64;; *) CARCH=x86_64;; esac
  curl -fsSL -o "$STAGE/tikootak/offline/docker/docker-compose" \
    "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$CARCH" \
    && chmod 755 "$STAGE/tikootak/offline/docker/docker-compose" \
    || echo "[WARN] could not download the compose binary; the kit still works on releases that have docker-compose-v2"
fi

# 6) pack
mkdir -p "$OUTDIR"
OUT="$OUTDIR/tikootak-full-$VER.tar"
tar cf "$OUT" -C "$STAGE" tikootak
( cd "$OUTDIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo
echo "[OK] Kit ready: $OUT ($(du -h "$OUT" | cut -f1))"
echo "     Check later with:  sha256sum -c $(basename "$OUT").sha256"
echo "     On the server:     tar -xf $(basename "$OUT") && cd tikootak && sudo ./scripts/bootstrap.sh --domain YOUR.DOMAIN --yes"
echo "     Keep copies of this file in several places (PC, phone/USB, a second server): it is your way back online."
