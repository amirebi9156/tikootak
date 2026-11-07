#!/usr/bin/env bash
# Full migration to a new server with one command (from the current server or a laptop with SSH to both):
#   ./scripts/migrate.sh root@NEW_IP [--ip NEW_IP] [--port 22] [--dir /root/tikootak] [--offline] [--no-backup] [--final]
#     --offline    also sends the Docker images (when the new server cannot reach Docker Hub)
#     --final      stops this server's services after the backup (prevents data from diverging into two copies)
#     --no-backup  use the newest existing backup
# Target requirements: Ubuntu/Debian with Docker and docker compose, and key-based SSH.
# When done: point the domain's DNS record to the new IP (DOMAIN does not change).
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
. ./scripts/lib.sh

HOST="${1:?Usage: ./scripts/migrate.sh user@host [--ip IP] [--port N] [--dir path] [--offline] [--no-backup] [--final]}"; shift
PORT=22; DIR=tikootak; OFFLINE=0; NOBK=0; FINAL=0; NEWIP="${HOST#*@}"
while [ $# -gt 0 ]; do
  case "$1" in --ip) NEWIP="$2"; shift;; --port) PORT="$2"; shift;; --dir) DIR="$2"; shift;; --offline) OFFLINE=1;; --no-backup) NOBK=1;; --final) FINAL=1;; esac; shift
done
set -a; . ./.env; set +a
SSH=(ssh -p "$PORT" -o BatchMode=yes -o ConnectTimeout=20 "$HOST")
SCP=(scp -q -P "$PORT" -o BatchMode=yes)

echo "[1/6] Checking connection and Docker on the target ..."
"${SSH[@]}" 'command -v docker >/dev/null && docker compose version >/dev/null' \
  || { echo "[FAIL] SSH failed or Docker/compose is not installed on the target."
       echo "       Install Docker there first. With no internet: copy the full offline kit to the target and run its bootstrap.sh"
       echo "       (see docs/OFFLINE-FA.md), then run this migration again."; exit 1; }

if [ "$NOBK" != 1 ]; then echo "[2/6] Creating a fresh backup ..."; ./scripts/backup.sh | tail -3; else echo "[2/6] Using the latest backup"; fi
# shellcheck disable=SC2010  # controlled backup globs (file names are safe)
BK="$(ls -1t backups/tikootak-*.tar.gz* backups/hamdam-*.tar.gz* 2>/dev/null | grep -v '\.sha256$' | head -1)"
[ -n "$BK" ] || { echo "[FAIL] No backup found"; exit 1; }
echo "   Backup: $BK"
./scripts/verify-backup.sh "$BK" >/dev/null || { echo "[FAIL] Backup failed the restore test; migration stopped."; exit 1; }
echo "   [OK] Backup passed the restore test"

if [ "$FINAL" = 1 ]; then echo "   Stopping this server's services (after the backup)..."; docker compose stop gateway synapse caddy >/dev/null; fi

if [ "$OFFLINE" = 1 ]; then echo "[3/6] Building the image bundle ..."; ./scripts/pack-offline.sh >/dev/null; fi

echo "[3/6] Sending the project ..."
"${SSH[@]}" "mkdir -p '$DIR/backups'"
tar czf - --exclude=./data --exclude=./backups --exclude=./.env --exclude=node_modules --exclude=./.git --exclude='./offline-images*' --exclude=./offline --exclude='./.monitor.state' . \
  | "${SSH[@]}" "tar xzf - -C '$DIR'"
echo "[4/6] Sending the backup$([ "$OFFLINE" = 1 ] && echo ' and images') ..."
"${SCP[@]}" "$BK" "$BK.sha256" "$HOST:$DIR/backups/" 2>/dev/null || "${SCP[@]}" "$BK" "$HOST:$DIR/backups/"
[ "$OFFLINE" = 1 ] && "${SCP[@]}" offline-images.tar.gz "$HOST:$DIR/"

echo "[5/6] Restoring on the target ..."
RB="backups/$(basename "$BK")"
printf '%s\n' "${BACKUP_PASSPHRASE:-}" | "${SSH[@]}" "cd '$DIR' && chmod +x scripts/*.sh && read -r BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE && ./scripts/restore.sh --yes --ip '$NEWIP' '$RB'"

echo "[6/6] Final check ..."
if curl -fsSk -m 20 --resolve "${DOMAIN}:443:${NEWIP}" "https://${DOMAIN}/api/health" >/dev/null 2>&1; then echo "[OK] New server is responding"
else echo "[WARN] Not responding from outside yet (certificate/firewall may not be ready; run ./scripts/doctor.sh on the target)"; fi
cat <<M

Done. Final steps:
 1) Change the DNS record for "${DOMAIN}" to ${NEWIP} (a low TTL helps).
 2) Open these ports on the target: 80/tcp 443/tcp 7881/tcp 7882/udp 3478/udp 30000-30100/udp
 3) After DNS has changed, on the target run: ./scripts/doctor.sh  and  sudo ./scripts/install-monitor.sh
 4) Shut down the old server once you are sure everything works (until then, stop users writing to it: --final).
M
