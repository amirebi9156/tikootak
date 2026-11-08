#!/usr/bin/env bash
# Tests for the offline-install logic WITHOUT real Docker (a fake `docker` records every call).
# Run: bash tests/scripts/offline.test.sh
# Covers: bundle detection (regression of the old `ls a b c` bug), OFFLINE_LOADED, digest-pin handling,
# offline update + rollback in tikootak.sh, the kit builder's staging/excludes, mirror-test.sh, static checks.
# NOT covered (needs a real server): actual docker load/pull, apt/dpkg installs, Caddy, LiveKit.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$(mktemp -d)"; ok=0; bad=0
chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (expected '$3' got '$2')"; fi; }
has() { if grep -qE -- "$3" "$2" 2>/dev/null; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (pattern '$3' not found)"; fi; }
hasnt() { if grep -qE -- "$3" "$2" 2>/dev/null; then bad=$((bad+1)); echo "FAIL $1 (pattern '$3' found but must not be)"; else ok=$((ok+1)); echo "PASS $1"; fi; }

# ---------------------------------------------------------------- fake docker
mkdir -p "$S/bin"
cat > "$S/bin/docker" <<'STUB'
#!/bin/bash
echo "docker $*" >> "${DOCKER_LOG:-/dev/null}"
case "$1" in
  save) echo FAKEIMAGEDATA; exit 0;;
  image) for m in ${MISSING:-}; do [ "$3" = "$m" ] && exit 1; done; exit 0;;
  compose)
    case " $* " in *" config "*) for i in ${COMPOSE_IMAGES:-caddy:2 postgres:16-alpine matrixdotorg/synapse:latest livekit/livekit-server:latest tikootak-gateway:local}; do echo "$i"; done;; esac
    exit 0;;
esac
exit 0
STUB
chmod +x "$S/bin/docker"; export PATH="$S/bin:$PATH"; export DOCKER_LOG="$S/docker.log"

# ---------------------------------------------------------------- A. bundle detection
P="$S/proj"; mkdir -p "$P"; cd "$P" || exit 1
( . "$ROOT/scripts/lib.sh"; offline_bundle_file >/dev/null ); chk "A1 no bundle -> not found" "$?" 1
for n in offline-images.tar.gz offline-images.tar images.tar.gz; do
  touch "$n"; r="$( . "$ROOT/scripts/lib.sh"; offline_bundle_file )"; chk "A2 only $n present is detected" "$r" "$n"; rm -f "$n"
done

# ---------------------------------------------------------------- B/C. OFFLINE_LOADED
touch offline-images.tar.gz
r="$( . "$ROOT/scripts/lib.sh"; load_offline_images >/dev/null; echo "$OFFLINE_LOADED" )"; chk "B all images present -> OFFLINE_LOADED=1" "$r" 1
r="$( export MISSING="tikootak-gateway:local"; . "$ROOT/scripts/lib.sh"; load_offline_images >/dev/null; echo "$OFFLINE_LOADED" )"; chk "C gateway image missing -> OFFLINE_LOADED=0" "$r" 0
r="$( export MISSING="tikootak-gateway:local"; . "$ROOT/scripts/lib.sh"; load_offline_images 2>&1 | grep -c 'missing image: tikootak-gateway:local' )"; chk "C2 missing image is named" "$r" 1
rm -f offline-images.tar.gz

# ---------------------------------------------------------------- D. digest pins
printf 'DOMAIN=x.ir\nSYNAPSE_IMAGE=matrixdotorg/synapse@sha256:aaa\nCADDY_IMAGE=caddy@sha256:bbb\nPOSTGRES_IMAGE=postgres:16-alpine\n' > .env
( export MISSING="matrixdotorg/synapse@sha256:aaa"; . "$ROOT/scripts/lib.sh"; offline_unpin_missing >/dev/null )
has "D1 missing pinned image is commented out" .env '^# \(unpinned for offline install\) SYNAPSE_IMAGE='
has "D2 available pinned image is kept" .env '^CADDY_IMAGE=caddy@sha256:bbb$'
has "D3 plain tags untouched" .env '^POSTGRES_IMAGE=postgres:16-alpine$'
rm -f .env

# ---------------------------------------------------------------- E/F. offline update + rollback (tikootak.sh)
A="$S/app"; N="$S/new/tikootak"; mkdir -p "$A/scripts" "$A/gateway" "$A/web/dist" "$A/data" "$N"/{gateway,scripts,web/dist}
cp "$ROOT/scripts/tikootak.sh" "$ROOT/scripts/netlib.sh" "$ROOT/scripts/lib.sh" "$A/scripts/"
for d in "$A" "$N"; do touch "$d/docker-compose.yml"; printf '#!/bin/bash\nexit 0\n' > "$d/scripts/backup.sh"; printf '#!/bin/bash\n[ -f "%s/fail" ] && exit 1\nexit 0\n' "$S" > "$d/scripts/doctor.sh"; done
chmod +x "$A"/scripts/*.sh "$N"/scripts/*.sh
echo 1.0.0 > "$A/VERSION"; echo DOMAIN=x.ir > "$A/.env"; echo ok > "$A/web/dist/index.html"
mkkit() { echo "$1" > "$N/VERSION"; echo "$1" > "$N/web/dist/index.html"; [ "${2:-}" = kit ] && echo FAKE > "$N/offline-images.tar.gz" || rm -f "$N/offline-images.tar.gz"; (cd "$S/new" && tar czf "../$1.tgz" tikootak); }
cd "$A" || exit 1

: > "$DOCKER_LOG"; mkkit 1.1.0 kit; ./scripts/tikootak.sh update "$S/1.1.0.tgz" --yes >/dev/null 2>&1
chk "E1 kit update applied" "$(cat VERSION)" 1.1.0
has  "E2 kit images were loaded" "$DOCKER_LOG" 'docker load -i .*offline-images.tar.gz'
has  "E3 kit update starts services WITHOUT building" "$DOCKER_LOG" 'compose up -d --no-build'
hasnt "E4 kit update never builds" "$DOCKER_LOG" 'compose up -d --build'
chk  "E5 kit payload is not copied into the app dir" "$([ -f "$A/offline-images.tar.gz" ] && echo copied || echo clean)" clean
has  "E6 running gateway image saved for rollback" "$DOCKER_LOG" 'docker tag tikootak-gateway:local tikootak-gateway:rollback'

: > "$DOCKER_LOG"; mkkit 1.2.0; ./scripts/tikootak.sh update "$S/1.2.0.tgz" --yes >/dev/null 2>&1
chk  "E7 normal tar (no kit) update applied" "$(cat VERSION)" 1.2.0
has  "E8 normal update builds as before" "$DOCKER_LOG" 'compose up -d --build'
hasnt "E9 normal update loads no images" "$DOCKER_LOG" 'docker load'

# the real kit is a PLAIN .tar with a .sha256 next to it (tar must auto-detect the compression; checksum is verified)
: > "$DOCKER_LOG"; mkkit 1.2.5 kit; ( cd "$S/new" && tar cf "$S/kit-1.2.5.tar" tikootak ) && ( cd "$S" && sha256sum kit-1.2.5.tar > kit-1.2.5.tar.sha256 )
./scripts/tikootak.sh update "$S/kit-1.2.5.tar" --yes >/dev/null 2>&1
chk  "E10 plain .tar kit with .sha256 updates" "$(cat VERSION)" 1.2.5
has  "E11 plain .tar kit starts without building" "$DOCKER_LOG" 'compose up -d --no-build'
mkkit 1.2.6 kit; ( cd "$S/new" && tar cf "$S/kit-1.2.6.tar" tikootak ); echo "0000000000000000000000000000000000000000000000000000000000000000  kit-1.2.6.tar" > "$S/kit-1.2.6.tar.sha256"
./scripts/tikootak.sh update "$S/kit-1.2.6.tar" --yes >/dev/null 2>&1
chk  "E12 damaged kit (checksum mismatch) is refused" "$(cat VERSION)" 1.2.5

: > "$DOCKER_LOG"; mkkit 1.3.0 kit; touch "$S/fail"; ./scripts/tikootak.sh update "$S/1.3.0.tgz" --yes >/dev/null 2>&1; rm -f "$S/fail"
chk  "F1 failed health -> code rolled back" "$(cat VERSION)" 1.2.5
has  "F2 rollback restores the saved gateway image" "$DOCKER_LOG" 'docker tag tikootak-gateway:rollback tikootak-gateway:local'

# ---------------------------------------------------------------- G. kit builder staging (fake docker)
K="$S/repo"; mkdir -p "$K"; cd "$ROOT" || exit 1
tar cf - --exclude=.git --exclude=node_modules --exclude=./kit-out --exclude=./web-src . 2>/dev/null | tar xf - -C "$K"
cd "$K" || exit 1
mkdir -p web/dist data backups certs config; echo ui > web/dist/index.html; echo SECRET=1 > .env; echo db > data/x.db; echo k > certs/key.pem
: > "$DOCKER_LOG"; bash scripts/make-kit.sh --out "$S/out" >"$S/kit.log" 2>&1; chk "G1 make-kit exits 0" "$?" 0
KIT="$(ls "$S"/out/tikootak-full-*.tar 2>/dev/null | head -1)"; chk "G2 kit tar created" "$([ -n "$KIT" ] && echo yes || echo no)" yes
( cd "$S/out" && sha256sum -c ./*.tar.sha256 >/dev/null 2>&1 ); chk "G3 kit checksum file verifies" "$?" 0
tar tf "$KIT" > "$S/kit.list" 2>/dev/null
has   "G4 kit holds the image bundle" "$S/kit.list" '^tikootak/offline-images\.tar\.gz$'
has   "G5 kit holds the prebuilt web UI" "$S/kit.list" '^tikootak/web/dist/index\.html$'
has   "G6 kit holds bootstrap.sh" "$S/kit.list" '^tikootak/scripts/bootstrap\.sh$'
hasnt "G7 kit has no .env" "$S/kit.list" '^tikootak/\.env$'
hasnt "G8 kit has no data/" "$S/kit.list" '^tikootak/data/'
hasnt "G9 kit has no certs/" "$S/kit.list" '^tikootak/certs/'
has   "G10 kit builds the gateway image" "$DOCKER_LOG" 'compose .*build gateway'
has   "G11 kit uses an empty env file (no secret leak)" "$DOCKER_LOG" 'compose --env-file /tmp/'

# ---------------------------------------------------------------- H. mirror-test.sh against a local server
cat > "$S/srv.py" <<'PYSRV'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/v2/': self.send_response(401)
        elif self.path.startswith('/v2/library/caddy') or self.path.endswith('.tgz') or self.path.startswith('/ubuntu/dists'): self.send_response(200)
        else: self.send_response(404)
        self.end_headers()
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 18097), H).serve_forever()
PYSRV
python3 -I "$S/srv.py" & SRV=$!; sleep 1
printf 'docker http://127.0.0.1:18097\ndocker http://127.0.0.1:18096\nnpm http://127.0.0.1:18097\napt http://127.0.0.1:18097\n' > "$S/list"
cd "$ROOT" && MIRRORS_LIST="$S/list" PROBE_TIMEOUT=3 bash scripts/mirror-test.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g' > "$S/mt.txt"; kill "$SRV" 2>/dev/null
has "H1 working docker mirror is listed as best" "$S/mt.txt" 'docker: http://127.0.0.1:18097'
has "H2 dead mirror shows code 000" "$S/mt.txt" '18096 +000'
has "H3 npm and apt mirrors detected" "$S/mt.txt" 'npm: http://127.0.0.1:18097 +apt: http://127.0.0.1:18097'

# ---------------------------------------------------------------- I. static checks
cd "$ROOT" || exit 1
for f in scripts/bootstrap.sh scripts/tikootak.sh scripts/lib.sh scripts/cert.sh scripts/mirror-test.sh scripts/make-kit.sh scripts/fetch-docker-debs.sh scripts/install.sh scripts/restore.sh scripts/upgrade.sh scripts/update.sh; do
  bash -n "$f" 2>/dev/null; chk "I1 syntax $f" "$?" 0
done
hasnt "I2 old multi-file ls check is gone" scripts/bootstrap.sh 'ls offline-images\.tar\.gz images\.tar\.gz'
has   "I3 bootstrap auto-detects the bundle" scripts/bootstrap.sh 'offline_bundle_file'
has   "I4 restore re-checks pins after copying .env" scripts/restore.sh '^offline_settle$'
has   "I5 install.sh honours OFFLINE_LOADED (--no-build)" scripts/install.sh 'OFFLINE_LOADED:-0.*= 1 \] && UP_BUILD=\(--no-build\)'
has   "I6 upgrade.sh honours OFFLINE_LOADED" scripts/upgrade.sh 'OFFLINE_LOADED:-0.*--no-build'

rm -rf "$S"; echo "ok=$ok bad=$bad"; [ "$bad" = 0 ]
