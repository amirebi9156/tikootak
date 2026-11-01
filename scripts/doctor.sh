#!/usr/bin/env bash
# Full platform health check. Each item is [OK] (healthy), [WARN] (warning) or [FAIL] (problem); a suggested fix follows.
# Usage: ./scripts/doctor.sh   (if docker only works with sudo: sudo ./scripts/doctor.sh)
cd "$(dirname "$0")/.." || exit 1

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; RST=$'\e[0m'
problems=0
ok()   { echo "${GRN}[OK]${RST} $1"; }
warn() { echo "${YEL}[WARN]${RST} $1"; [ -n "${2:-}" ] && echo "    -> $2"; }
bad()  { echo "${RED}[FAIL]${RST} $1"; [ -n "${2:-}" ] && echo "    -> $2"; problems=$((problems + 1)); }

# ---------- 1. Configuration ----------
if [ ! -f .env ]; then
  bad ".env file is missing" "Fresh server: cp .env.example .env, then ./scripts/install.sh. Restoring from a backup: ./scripts/restore.sh <backup file>"
  exit 1
fi
set -a; . ./.env; set +a
for k in DOMAIN PUBLIC_IP POSTGRES_PASSWORD SYNAPSE_SHARED_SECRET LIVEKIT_KEY LIVEKIT_SECRET GATEWAY_ADMIN_KEY; do
  [ -n "${!k:-}" ] || bad "Variable $k is empty in .env" "./scripts/install.sh generates empty secrets by itself"
done
HOST="${SITE_ADDRESS:-$DOMAIN}"
HOST="${HOST#http://}"; HOST="${HOST#https://}"

# ---------- 2. Docker ----------
if docker info >/dev/null 2>&1; then
  ok "Docker is available"
else
  bad "Docker is not available" "Windows: open Docker Desktop and wait for it to start. Server: sudo systemctl start docker"
  exit 1
fi

# ---------- 3. Services ----------
PS="$(docker compose ps -a --format '{{.Service}}|{{.State}}|{{.Health}}' 2>/dev/null)"
for svc in postgres synapse livekit gateway caddy; do
  line="$(echo "$PS" | grep "^$svc|" | head -1)"
  state="$(echo "$line" | cut -d'|' -f2)"
  health="$(echo "$line" | cut -d'|' -f3)"
  if [ -z "$state" ]; then
    bad "Service $svc was not created" "docker compose up -d"
  elif [ "$state" = running ] && { [ -z "$health" ] || [ "$health" = healthy ]; }; then
    cid="$(docker compose ps -q "$svc" 2>/dev/null | head -1)"
    restarts="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
    if [ "${restarts:-0}" -gt 3 ]; then
      warn "Service $svc is up but has restarted itself $restarts times" "docker compose logs --tail 80 $svc"
    else
      ok "Service $svc is up"
    fi
  else
    bad "Service $svc state: $state ${health:+($health)}" "docker compose logs --tail 50 $svc"
  fi
done

# ---------- 4. Responses via Caddy (the same path users take) ----------
check() { # name | url | expected code | suggestion
  local code
  code="$(curl -ks -o /dev/null -w '%{http_code}' -m 8 --resolve "$HOST:443:127.0.0.1" "$2" 2>/dev/null)"
  if [ "$code" = "$3" ]; then ok "$1 (code $code)"; else bad "$1: code $code (expected $3)" "$4"; fi
}
check "Web UI"                  "https://$HOST/"                              200 "web/dist must contain index.html; docker compose logs --tail 30 caddy"
check "Gateway (signup/login)"  "https://$HOST/api/health"                    200 "docker compose logs --tail 50 gateway"
# Q7 channel member privacy self-test (does not need a real channel)
CP_HEALTH="$(curl -ks -m 8 --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health" 2>/dev/null)"
if echo "$CP_HEALTH" | grep -q '"channel_privacy":{"enabled":true,"ok":true'; then
  ok "Channel member privacy filter: self-test passed"
elif echo "$CP_HEALTH" | grep -q '"channel_privacy":{"enabled":false'; then
  warn "Channel member privacy filter is disabled (CHANNEL_PRIVACY=0)" "Set CHANNEL_PRIVACY=1 in .env and recreate gateway"
else
  bad "Channel member privacy filter self-test failed" "docker compose logs --tail 50 gateway"
fi
# Migration schema version (from inside the container, using the same DB_PATH)
SCHEMA="$(docker compose exec -T gateway node -e 'const D=require("better-sqlite3");const d=new D(process.env.DB_PATH||"/data/gateway.db",{readonly:true});const r=d.prepare("select max(version) v,count(*) n from schema_migrations").get();process.stdout.write(`${r.v||0} (${r.n||0} migration)`)' 2>/dev/null | tr -d '\r')"
[ -n "$SCHEMA" ] && ok "Database schema: $SCHEMA" || warn "Could not read the database schema version" "docker compose logs --tail 30 gateway; check the migrations"
check "Synapse (chat)"          "https://$HOST/_matrix/client/versions"       200 "docker compose logs --tail 50 synapse"
check "LiveKit (calls)"         "https://$HOST/livekit/"                      200 "docker compose logs --tail 50 livekit"
check "Synapse admin API is blocked" "https://$HOST/_synapse/admin/v1/server_version" 403 "Caddyfile must return 403 for /_synapse/admin; security is at risk"

# ---------- 5. Does the LiveKit config match the current IP? ----------
if [ -f config/livekit.yaml ]; then
  if grep -q "node_ip: $PUBLIC_IP" config/livekit.yaml; then
    ok "LiveKit config matches PUBLIC_IP ($PUBLIC_IP)"
  else
    bad "PUBLIC_IP in .env differs from config/livekit.yaml" "Calls will have no audio/video. Regenerate: sudo ./scripts/install.sh"
  fi
else
  bad "config/livekit.yaml is missing" "sudo ./scripts/install.sh"
fi
# PUBLIC_IP must be an address of this server (or of its DNS record); the outbound/egress IP can be different
if command -v ip >/dev/null 2>&1; then
  if ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -qx "$PUBLIC_IP" || getent ahostsv4 "$HOST" 2>/dev/null | awk '{print $1}' | grep -qx "$PUBLIC_IP"; then
    ok "PUBLIC_IP belongs to this server / DNS"
  else
    bad "PUBLIC_IP ($PUBLIC_IP) is neither on this server nor in DNS" "Calls cannot connect. Fix: sudo tikootak set-ip"
  fi
fi

# ---------- 6. HTTPS certificate ----------
if [ "$HOST" != localhost ] && command -v openssl >/dev/null 2>&1; then
  if echo | openssl s_client -connect 127.0.0.1:443 -servername "$HOST" 2>/dev/null | openssl x509 -noout -checkend $((14 * 86400)) >/dev/null 2>&1; then
    ok "HTTPS certificate is valid for more than 14 days"
  else
    warn "HTTPS certificate is invalid or expires in less than 14 days" "docker compose logs --tail 30 caddy. If you use a manual certificate, renew certs/cert.pem and key.pem"
  fi
fi

# ---------- 7. Disk and backups ----------
used="$(df -P . | awk 'NR==2{gsub("%","",$5); print $5}')"
if   [ "${used:-0}" -ge 97 ]; then bad  "Disk is ${used}% full" "docker system prune -f and delete old backups in backups/"
elif [ "${used:-0}" -ge 90 ]; then warn "Disk is ${used}% full" "Free up space: docker system prune -f"
else ok "Disk space is fine (${used}% used)"; fi

# shellcheck disable=SC2010  # backup names are controlled; both tikootak and legacy hamdam
latest="$(ls -1t backups/tikootak-*.tar.gz* backups/hamdam-*.tar.gz* 2>/dev/null | grep -v '\.sha256$' | head -1)"
if [ -z "$latest" ]; then
  warn "No backup exists" "sudo ./scripts/backup.sh"
else
  age=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 86400 ))
  if [ "$age" -gt 3 ]; then warn "Latest backup is $age days old ($latest)" "sudo ./scripts/backup.sh"
  else ok "Recent backup exists ($latest)"; fi
fi

echo
if [ "$problems" -eq 0 ]; then
  echo "${GRN}Everything is healthy.${RST}"
else
  echo "${RED}$problems item(s) have problems.${RST} Start from the first [FAIL] and run the suggestion below it. Full guide: docs/RUNBOOK.md"
fi
exit "$problems"
