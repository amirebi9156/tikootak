#!/usr/bin/env bash
# Downloads the Docker engine .deb packages (with all dependencies) for ONE target OS, using a throw-away container.
# Run it where Docker and the internet work (not on the Iran server). Used by make-kit.sh --with-docker-debs.
#   ./scripts/fetch-docker-debs.sh ubuntu:24.04 outdir
# Result: outdir/*.deb  (install on a fresh server with no internet: apt-get install -y --no-download ./*.deb)
# Why a container: its minimal package set is a SUBSET of a normal server's, so everything a server could be
# missing (containerd, runc, iptables, ...) ends up in the folder.
set -euo pipefail
IMAGE="${1:?Usage: fetch-docker-debs.sh ubuntu:24.04|ubuntu:22.04|debian:12 OUTDIR}"; OUT="${2:?OUTDIR}"
command -v docker >/dev/null || { echo "Docker is required here"; exit 1; }
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
PLAT="${PLATFORM:-linux/amd64}"
docker run --rm --platform "$PLAT" -v "$OUT:/out" "$IMAGE" bash -c '
  set -e
  rm -f /etc/apt/apt.conf.d/docker-clean
  apt-get update -qq
  apt-get install -y -qq --download-only -o Dir::Cache::archives=/out docker.io docker-compose-v2 ca-certificates iptables \
    || { echo "docker-compose-v2 is not available for this release: downloading docker.io only (the compose plugin binary is added separately)";
         apt-get install -y -qq --download-only -o Dir::Cache::archives=/out docker.io ca-certificates iptables; }
  rm -rf /out/lock /out/partial
'
n="$(ls "$OUT"/*.deb 2>/dev/null | wc -l)"
[ "$n" -gt 0 ] || { echo "[FAIL] no .deb files were downloaded for $IMAGE"; exit 1; }
echo "[OK] $n packages for $IMAGE in $OUT ($(du -sh "$OUT" | cut -f1))"
