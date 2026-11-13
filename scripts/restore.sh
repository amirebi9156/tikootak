#!/usr/bin/env bash
# Restore onto a fresh server (or this server). Clone the repo, copy the backup file over, then:
#   ./scripts/restore.sh backups/tikootak-XXXX.tar.gz.enc            (asks for confirmation)
#   ./scripts/restore.sh --dry-run backups/tikootak-XXXX.tar.gz.enc  (only checks backup health; changes nothing)
# Options: --yes (no prompt)  --ip <new IP>  --allow-domain-change
# Passphrase: the BACKUP_PASSPHRASE variable, or it is prompted.
# Important: do NOT change DOMAIN! The domain is part of every user's identity (@ali:domain). Just point DNS to the new IP.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
. ./scripts/lib.sh

DRY=0; YES=0; NEWIP=""; ALLOW_DOMAIN=0; BACKUP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1;; --yes|-y) YES=1;; --ip) NEWIP="$2"; shift;; --allow-domain-change) ALLOW_DOMAIN=1;;
    *) BACKUP="$1";;
  esac; shift
done
[ -n "$BACKUP" ] || { echo "Usage: ./scripts/restore.sh [--dry-run] [--yes] [--ip IP] <backup file>"; exit 1; }
# If BACKUP_PASSPHRASE is not in the environment, read it from this server's .env (for dry-run/local restore)
if [ -z "${BACKUP_PASSPHRASE:-}" ] && [ -f .env ]; then set -a; . ./.env; set +a; fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "== Checking backup =="
open_backup "$BACKUP" "$WORK" || exit 1
STAGE="$WORK/x"
if ! verify_archive "$OPEN_TAR" "$STAGE"; then echo; echo "[FAIL] Backup has problems; restore will not run."; exit 1; fi

OLD_DOMAIN="$(grep -E '^DOMAIN=' "$STAGE/env" | cut -d= -f2-)"
echo "Domain recorded in the backup: $OLD_DOMAIN"
if [ "$DRY" = 1 ]; then echo; echo "[OK] dry-run: backup is healthy and looks restorable (nothing was changed)."; exit 0; fi

command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose is not installed."; exit 1; }

if [ -f .env ]; then
  CUR_DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2- || true)"
  if [ -n "$CUR_DOMAIN" ] && [ "$CUR_DOMAIN" != "$OLD_DOMAIN" ] && [ "$ALLOW_DOMAIN" != 1 ]; then
    echo "[FAIL] DOMAIN on this server ($CUR_DOMAIN) differs from the backup ($OLD_DOMAIN). Changing the domain breaks all Matrix accounts and rooms."
    echo "  If you really want this: --allow-domain-change"; exit 1
  fi
fi

if [ "$YES" != 1 ]; then
  echo "This will replace the current data on this server (if any) with the backup (the current copy is kept in backups/pre-restore-*)."
  read -r -p "Continue? (y/N) " a; [ "$a" = y ] || exit 0
fi

load_offline_images

# Safety copy of the current state
if [ -d data/gateway ] || [ -d data/synapse ]; then
  SAFE="backups/pre-restore-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$SAFE"
  docker compose down >/dev/null 2>&1 || true
  [ -d data/gateway ] && mv data/gateway "$SAFE/gateway"
  [ -d data/synapse ] && mv data/synapse "$SAFE/synapse"
  [ -f .env ] && cp .env "$SAFE/env"
  echo "Previous copy kept at: $SAFE"
fi

cp "$STAGE/env" .env
if [ -n "$NEWIP" ]; then
  sed -i '/^PUBLIC_IP=/d' .env; echo "PUBLIC_IP=$NEWIP" >> .env
  echo "PUBLIC_IP set to $NEWIP."
else
  echo "If the new server has a different IP, change PUBLIC_IP in .env (or pass --ip); it is required for calls."
fi
set -a; . ./.env; set +a
# the backup's .env may pin image digests that an offline bundle cannot satisfy: re-check now
offline_settle

mkdir -p data/postgres data/caddy certs config config/caddy-extra backups web/dist
cp -r "$STAGE/synapse" data/synapse
cp -r "$STAGE/gateway" data/gateway
[ -d "$STAGE/certs" ] && cp -r "$STAGE/certs/." certs/ || true
chown -R 991:991 data/synapse 2>/dev/null || true
chown -R 1000:1000 data/gateway 2>/dev/null || true
# no route to Let's Encrypt (blackout)? use the certificate that came with the backup
[ -f certs/cert.pem ] && ./scripts/cert.sh auto-fallback --no-restart || true

render() {
  sed \
    -e "s|\${DOMAIN}|${DOMAIN}|g" -e "s|\${PUBLIC_IP}|${PUBLIC_IP}|g" \
    -e "s|\${POSTGRES_PASSWORD}|${POSTGRES_PASSWORD}|g" \
    -e "s|\${SYNAPSE_SHARED_SECRET}|${SYNAPSE_SHARED_SECRET}|g" \
    -e "s|\${SYNAPSE_MACAROON_SECRET}|${SYNAPSE_MACAROON_SECRET}|g" \
    -e "s|\${SYNAPSE_FORM_SECRET}|${SYNAPSE_FORM_SECRET}|g" \
    -e "s|\${LIVEKIT_KEY}|${LIVEKIT_KEY}|g" -e "s|\${LIVEKIT_SECRET}|${LIVEKIT_SECRET}|g" \
    "$1" > "$2"
}
render templates/livekit.yaml.tpl config/livekit.yaml
render templates/homeserver.yaml.tpl data/synapse/homeserver.yaml

docker compose up -d postgres
echo "Waiting for postgres..."
for _ in $(seq 1 30); do docker compose exec -T postgres pg_isready -U synapse >/dev/null 2>&1 && break; sleep 2; done

gunzip -c "$STAGE/db.sql.gz" | docker compose exec -T postgres psql -U synapse -d synapse -v ON_ERROR_STOP=0 >/dev/null

UP_BUILD=(--build)
[ "${OFFLINE_LOADED:-0}" = 1 ] && UP_BUILD=(--no-build)
docker compose up -d "${UP_BUILD[@]}"
echo "Waiting for gateway to become ready..."
for _ in $(seq 1 60); do
  docker compose exec -T gateway node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && { echo "[OK] gateway is up"; break; }
  sleep 2
done
echo "Restore finished. Point the domain (${DOMAIN}) to this server IP, then run ./scripts/doctor.sh."
