#!/usr/bin/env bash
# Install / (re)start TIKOOTAK on a host that already has Docker. Safe to run again.
# Usage: cp .env.example .env ; edit DOMAIN and PUBLIC_IP ; ./scripts/install.sh      (or use scripts/bootstrap.sh)
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

. ./scripts/lib.sh
load_offline_images 2>/dev/null || true
command -v docker >/dev/null || { echo "[FAIL] Docker is not installed."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "[FAIL] docker compose is not installed."; exit 1; }
[ -f .env ] || { echo "[FAIL] .env is missing. Copy .env.example to .env and set DOMAIN and PUBLIC_IP."; exit 1; }

# generate random secrets for empty values
gen() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
fill() {
  local key="$1"
  if ! grep -qE "^${key}=.+" .env; then
    sed -i "/^${key}=/d" .env
    echo "${key}=$(gen)" >> .env
  fi
}
for k in BACKUP_PASSPHRASE POSTGRES_PASSWORD SYNAPSE_SHARED_SECRET SYNAPSE_MACAROON_SECRET SYNAPSE_FORM_SECRET LIVEKIT_KEY LIVEKIT_SECRET GATEWAY_ADMIN_KEY; do
  fill "$k"
done

set -a; . ./.env; set +a
case "$DOMAIN" in chat.example.ir|"") echo "[FAIL] Set DOMAIN in .env"; exit 1;; esac
case "$PUBLIC_IP" in 1.2.3.4|"") echo "[FAIL] Set PUBLIC_IP in .env"; exit 1;; esac

mkdir -p data/postgres data/synapse data/gateway data/caddy certs config backups web/dist

# the Synapse signing key is generated once (when moving servers it comes from the backup)
if [ ! -f "data/synapse/${DOMAIN}.signing.key" ]; then
  echo "[..] Generating Synapse signing key..."
  docker run --rm -v "$PWD/data/synapse:/data" \
    -e SYNAPSE_SERVER_NAME="$DOMAIN" -e SYNAPSE_REPORT_STATS=no \
    "${SYNAPSE_IMAGE:-matrixdotorg/synapse:latest}" generate
fi
./scripts/render.sh
chown -R 991:991 data/synapse 2>/dev/null || true
# the gateway runs as a non-root user (uid 1000)
chown -R 1000:1000 data/gateway 2>/dev/null || true

retry() { # retry <attempts> <command...>
  local n="$1" i=1; shift
  until "$@"; do
    [ "$i" -ge "$n" ] && return 1
    echo "[WARN] attempt $i/$n failed; retrying in 10s ..."; i=$((i + 1)); sleep 10
  done
}

UP_BUILD=(--build)
[ "${OFFLINE_LOADED:-0}" = 1 ] && UP_BUILD=(--no-build)
if [ "${OFFLINE_LOADED:-0}" != 1 ]; then
  echo "[..] Pulling images (retries on network errors)..."
  retry 4 docker compose pull --ignore-buildable 2>/dev/null || retry 4 docker compose pull || echo "[WARN] pull incomplete; 'up' will try again"
fi
echo "[..] Building and starting services (the first build can take several minutes)..."
retry 3 docker compose up -d "${UP_BUILD[@]}" --force-recreate \
  || { echo "[FAIL] docker compose up failed 3 times."; echo "       Check: docker compose logs --tail 50   |   slow npm/apt? use: sudo tikootak mirrors set"; exit 1; }

echo "[..] Waiting for the gateway..."
READY=0
for _ in $(seq 1 60); do
  if docker compose exec -T gateway node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then READY=1; break; fi
  sleep 2
done
[ "$READY" = 1 ] && echo "[OK] Gateway is up" || echo "[WARN] Gateway did not answer in 2 minutes: docker compose logs --tail 50 gateway"

# management command: install it here so it exists even if a later step fails
chmod +x scripts/*.sh 2>/dev/null || true
if [ "$(id -u)" = 0 ]; then ./scripts/tikootak.sh install-cli >/dev/null 2>&1 && echo "[OK] Management command installed:  sudo tikootak"; fi

echo
echo "=== First invite code (5 uses, valid 7 days) ==="
docker compose exec -T gateway node -e "
fetch('http://localhost:3000/api/admin/invites',{method:'POST',headers:{'content-type':'application/json','x-admin-key':process.env.GATEWAY_ADMIN_KEY},body:JSON.stringify({max_uses:5,expires_days:7,note:'first'})})
.then(r=>r.json()).then(j=>console.log(j.code))" || true
echo
echo "Install finished: https://${DOMAIN}"
echo "Open these ports in the firewall: 80/tcp 443/tcp 7881/tcp 7882/udp 3478/udp 30000-30100/udp"
echo "SAVE the backup passphrase (BACKUP_PASSPHRASE) OUTSIDE this server: $(grep ^BACKUP_PASSPHRASE= .env | cut -d= -f2)"
echo "The admin key is stored in .env (GATEWAY_ADMIN_KEY). Keep a copy of .env in a safe place."
