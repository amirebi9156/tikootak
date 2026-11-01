#!/usr/bin/env bash
# Automatic restore test: opens the latest backup, checks its integrity and (if docker is available) loads the Postgres dump
# into a temporary container. Result goes to backups/verify.log; sends a notification on failure.
#   ./scripts/verify-backup.sh [file]     (default: newest backup)
cd "$(dirname "$0")/.." || exit 1
. ./scripts/lib.sh
set -a; . ./.env 2>/dev/null; set +a
# shellcheck disable=SC2010  # controlled backup globs (file names are safe)
F="${1:-$(ls -1t backups/tikootak-*.tar.gz* backups/hamdam-*.tar.gz* 2>/dev/null | grep -v '\.sha256$' | head -1)}"
LOG=backups/verify.log; mkdir -p backups
fail() { notify "TIKOOTAK ($(hostname)): backup restore test FAILED: $1"; echo "$(date -u +%FT%TZ) FAIL $F $1" >> "$LOG"; exit 1; }
[ -n "$F" ] && [ -f "$F" ] || fail "no backup found"
AGE=$(( ( $(date +%s) - $(stat -c %Y "$F") ) / 3600 ))
[ "$AGE" -le 48 ] || fail "newest backup is ${AGE} hours old (did the nightly backup fail?)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"; docker rm -f tikootak-verify-pg >/dev/null 2>&1 || true' EXIT
open_backup "$F" "$WORK" > "$WORK/log" 2>&1 || { cat "$WORK/log"; fail "could not open the backup (passphrase or file)"; }
verify_archive "$OPEN_TAR" "$WORK/x" >> "$WORK/log" 2>&1 || { cat "$WORK/log"; fail "backup contents are not healthy"; }
cat "$WORK/log"
if command -v docker >/dev/null && docker info >/dev/null 2>&1 && [ "${VERIFY_DEEP:-1}" = 1 ]; then
  IMG="${POSTGRES_IMAGE:-postgres:16-alpine}"
  if docker image inspect "$IMG" >/dev/null 2>&1; then
    docker run -d --rm --name tikootak-verify-pg -e POSTGRES_USER=synapse -e POSTGRES_PASSWORD=x -e POSTGRES_DB=synapse "$IMG" >/dev/null
    for _ in $(seq 1 30); do docker exec tikootak-verify-pg pg_isready -U synapse >/dev/null 2>&1 && break; sleep 1; done
    gunzip -c "$WORK/x/db.sql.gz" | docker exec -i tikootak-verify-pg psql -U synapse -d synapse -q >/dev/null 2>&1
    N="$(docker exec tikootak-verify-pg psql -U synapse -d synapse -tAc 'select count(*) from users' 2>/dev/null | tr -d ' ')"
    [ -n "$N" ] && echo "[OK] Postgres dump loaded for real (Matrix accounts: $N)" || fail "Postgres dump failed to load into a temporary database"
  else echo "[WARN] postgres image is not available locally; Postgres load test skipped"; fi
fi
echo "$(date -u +%FT%TZ) OK $F" >> "$LOG"
echo "[OK] Restore test passed: $F"
