#!/usr/bin/env bash
# Update this server from a GitHub Release (or from a tar file / mirror).
#   ./scripts/update.sh                 # latest release of the repo in .update.conf
#   ./scripts/update.sh 0.42.0          # a specific version
#   ./scripts/update.sh --file x.tar.gz # offline: use a tar you copied by hand
# First-time setup: cp .update.conf.example .update.conf  and set REPO (and TOKEN if the repo is private).
# If GitHub is blocked on the server: set MIRROR_BASE in .update.conf (any URL that serves the same file names),
# or download the release on another machine and use --file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
[ -f .update.conf ] && . ./.update.conf
REPO="${REPO:-}"; TOKEN="${TOKEN:-}"; MIRROR_BASE="${MIRROR_BASE:-}"
FILE=""; VER=""
while [ $# -gt 0 ]; do case "$1" in --file) FILE="$2"; shift 2;; *) VER="$1"; shift;; esac; done
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CUR="$(cat VERSION 2>/dev/null || echo unknown)"
auth=(); [ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")

if [ -z "$FILE" ]; then
  if [ -n "$MIRROR_BASE" ]; then
    [ -n "$VER" ] || VER="$(curl -fsSL "$MIRROR_BASE/LATEST")"
    A="tikootak-$VER.tar.gz"
    curl -fSL -o "$TMP/$A" "$MIRROR_BASE/$A"; curl -fsSL -o "$TMP/$A.sha256" "$MIRROR_BASE/$A.sha256"
  else
    [ -n "$REPO" ] || { echo "[FAIL] Set REPO in .update.conf (see .update.conf.example) or use --file"; exit 1; }
    API="https://api.github.com/repos/$REPO/releases"
    if [ -n "$VER" ]; then REL="$API/tags/v$VER"; else REL="$API/latest"; fi
    JSON="$(curl -fsSL ${auth[@]+"${auth[@]}"} -H 'Accept: application/vnd.github+json' "$REL")" || { echo "[FAIL] Cannot reach GitHub. Use --file or MIRROR_BASE."; exit 1; }
    command -v python3 >/dev/null || { echo "[FAIL] python3 is required to read the release info (apt install python3)"; exit 1; }
    VER="$(printf '%s' "$JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"].lstrip("v"))')"
    A="tikootak-$VER.tar.gz"
    for n in "$A" "$A.sha256"; do
      URL="$(printf '%s' "$JSON" | python3 -c 'import sys,json;n=sys.argv[1];print(next((a["url"] for a in json.load(sys.stdin)["assets"] if a["name"]==n),""))' "$n")"
      [ -n "$URL" ] || { echo "[FAIL] asset $n not found in release"; exit 1; }
      curl -fSL ${auth[@]+"${auth[@]}"} -H 'Accept: application/octet-stream' -o "$TMP/$n" "$URL"
    done
  fi
  (cd "$TMP" && sha256sum -c "$A.sha256")
  FILE="$TMP/$A"
fi
echo "Current: $CUR  ->  applying $(basename "$FILE")"
mkdir -p "$TMP/x"; tar xzf "$FILE" -C "$TMP/x"
SRC="$(find "$TMP/x" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -f "$SRC/VERSION" ] || { echo "[FAIL] archive does not look like TIKOOTAK"; exit 1; }
NEW="$(cat "$SRC/VERSION")"
[ "$NEW" = "$CUR" ] && [ -z "${FORCE:-}" ] && { echo "Already on $CUR (FORCE=1 to reapply)."; exit 0; }
[ -n "${DRY_RUN:-}" ] && { echo "[DRY] would apply $NEW over $CUR"; exit 0; }
# copy new code over, never touching secrets/data
(cd "$SRC" && tar cf - --exclude=./config --exclude=./.env --exclude=./data --exclude=./backups --exclude=./certs --exclude=./.update.conf .) | tar xf - -C "$ROOT"
chmod +x scripts/*.sh install.sh 2>/dev/null || true
./scripts/upgrade.sh
echo "[OK] Updated $CUR -> $NEW"
