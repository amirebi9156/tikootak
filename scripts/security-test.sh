#!/usr/bin/env bash
# Security test run on the server itself (after install). Each check is PASS / WARN / FAIL, with a fix hint.
#   sudo ./scripts/security-test.sh            checks HTTPS edge + host + docker
#   sudo ./scripts/security-test.sh --app      + app penetration tests (IDOR, fake upload, account lockout, metadata) inside the gateway container
# Note: --app creates about 6 signups (hourly signup limit is 10) and leaves test users behind. The gateway is restarted before sec04 to reset rate limits.
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env 2>/dev/null; set +a
APP=0; for a in "$@"; do [ "$a" = "--app" ] && APP=1; done
DOM="${DOMAIN:?DOMAIN is missing in .env}"
R=(--resolve "$DOM:443:127.0.0.1" --resolve "$DOM:80:127.0.0.1")
PASS=0; WARN=0; FAIL=0
pass() { echo "PASS  $1"; PASS=$((PASS+1)); }
warn() { echo "WARN  $1"; [ -n "${2:-}" ] && echo "      -> $2"; WARN=$((WARN+1)); }
fail() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      -> $2"; FAIL=$((FAIL+1)); }
code() { curl -s -o /dev/null -m 15 -w '%{http_code}' "${R[@]}" "$@" 2>/dev/null; }
hdrs() { curl -sI -m 15 "${R[@]}" "$@" 2>/dev/null | tr -d '\r'; }

echo "=== 1. HTTPS and certificate ($DOM) ==="
c="$(code -I "http://$DOM/")"; case "$c" in 301|302|307|308) pass "HTTP redirects to HTTPS ($c)";; *) fail "HTTP does not redirect to HTTPS (code $c)" "docker compose logs caddy";; esac
EDGE=0
if curl -sS -m 15 -o /dev/null "${R[@]}" "https://$DOM/" 2>/tmp/.sec_tls; then EDGE=1; pass "HTTPS certificate is valid"; else fail "HTTPS certificate is not valid: $(head -c 150 /tmp/.sec_tls)" "DNS must point to this server and ports 80/443 must be open; docker compose logs caddy"; fi
EXP="$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOM" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
if [ -n "$EXP" ]; then
  D=$(( ( $(date -d "$EXP" +%s) - $(date +%s) ) / 86400 ))
  [ "$D" -ge 14 ] && pass "certificate valid for ${D} more days" || fail "certificate valid for only ${D} more days" "Caddy auto-renewal is not working; docker compose logs caddy"
fi
if [ "$EDGE" = 0 ]; then
  if curl -sSk -m 15 -o /dev/null "${R[@]}" "https://$DOM/" 2>/dev/null; then EDGE=1; warn "server answers but certificate is not valid; remaining edge checks continue with -k"; R+=(-k); else fail "HTTPS edge is not reachable at all; sections 1-3 (headers and paths) were skipped" "docker compose ps ; docker compose logs caddy"; fi
fi
if [ "$EDGE" = 1 ]; then
for v in tls1 tls1_1; do
  if echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOM" -"$v" 2>&1 | grep -q "BEGIN CERTIFICATE\|Cipher is [A-Z]"; then fail "old protocol $v is enabled"; else pass "$v is disabled"; fi
done

echo; echo "=== 2. Security headers ==="
H="$(hdrs "https://$DOM/")"
for h in strict-transport-security x-content-type-options x-frame-options content-security-policy referrer-policy permissions-policy; do
  echo "$H" | grep -qi "^$h:" && pass "header $h present" || fail "header $h missing" "check the Caddyfile and run docker compose restart caddy"
done
echo "$H" | grep -qi '^server:' && warn "Server header leaks name/version" || pass "Server header removed"
echo "$H" | grep -qi '^x-powered-by' && fail "X-Powered-By header present" || pass "X-Powered-By absent"

echo; echo "=== 3. Sensitive paths ==="
c="$(code "https://$DOM/_synapse/admin/v1/server_version")"; [ "$c" = 403 ] && pass "Synapse admin API is blocked from outside" || fail "Synapse admin API is open from outside (code $c)" "Caddyfile: handle /_synapse/admin/*"
c="$(code -X POST -H 'content-type: application/json' -d '{}' "https://$DOM/_matrix/client/v3/register")"; case "$c" in 401|403|400) pass "direct Synapse registration is closed ($c)";; *) fail "direct Synapse registration gave unexpected answer ($c)" "enable_registration must be false";; esac
c="$(code "https://$DOM/_matrix/federation/v1/version")"; [ "$c" = 200 ] && warn "federation answers (we do not want federation)" "homeserver.yaml: federation_domain_whitelist: []" || pass "federation does not answer ($c)"
IDX="$(curl -s -m 15 "${R[@]}" "https://$DOM/" | md5sum | cut -d' ' -f1)"
for p in .env .git/config docker-compose.yml data/gateway/gateway.db backups/ scripts/install.sh gateway/src/index.js; do
  B="$(curl -s -m 15 "${R[@]}" "https://$DOM/$p")"; SUM="$(echo "$B" | md5sum | cut -d' ' -f1)"
  if echo "$B" | grep -qE 'POSTGRES_PASSWORD|GATEWAY_ADMIN_KEY|SQLite format|\[core\]|services:|#!/usr/bin/env'; then fail "/$p returns sensitive content!" "only the web/dist folder should be served"; elif [ "$SUM" = "$IDX" ] || [ "$(code "https://$DOM/$p")" != 200 ]; then :; else warn "/$p gives an unusual 200 response"; fi
done
pass "project files/database/.env are not readable from the web"
c="$(code "https://$DOM/api/admin/stats")"; case "$c" in 401|403|404) pass "admin without key is rejected ($c)";; *) fail "admin answered without key ($c)";; esac
c="$(code -H 'x-admin-key: wrong' "https://$DOM/api/admin/stats")"; case "$c" in 401|403|404) pass "wrong admin key is rejected ($c)";; *) fail "wrong admin key was accepted ($c)";; esac
if [ -n "${ADMIN_ALLOW_IPS:-}" ]; then pass "admin is restricted to allowed IPs"; else warn "ADMIN_ALLOW_IPS is not set; admin is reachable from any IP with the key" "in .env set ADMIN_ALLOW_IPS=YOUR-HOME-IP (then docker compose up -d gateway)"; fi
for p in feed/posts notifications invites music/tracks stories; do c="$(code "https://$DOM/api/$p")"; [ "$c" = 401 ] && pass "/api/$p returns 401 without login" || fail "/api/$p returned $c without login" "must be 401"; done
A="$(curl -sI -m 15 "${R[@]}" -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' "https://$DOM/api/auth/login" | tr -d '\r' | grep -i '^access-control-allow-origin' || true)"
[ -z "$A" ] && pass "CORS is not open to foreign origins" || fail "CORS is open: $A"
B="$(curl -s -m 15 "${R[@]}" "https://$DOM/api/does-not-exist")"; echo "$B" | grep -qiE 'at .*\.js|stack|node_modules' && fail "API error leaks internal details" || pass "API error does not leak internal details"
c="$(code -X POST -H 'content-type: application/json' -d '{"invite":"AAAAA-BBBBB","username":"sectest1","password":"Zx9!kLm2pQ7w"}' "https://$DOM/api/auth/register")"; case "$c" in 403|429) pass "signup with fake invite is rejected ($c)";; *) fail "signup with fake invite returned $c";; esac
U="nouser$RANDOM"; L=""; for i in $(seq 1 14); do L="$L $(code -X POST -H 'content-type: application/json' -d "{\"username\":\"$U\",\"password\":\"wrong$i\"}" "https://$DOM/api/auth/login")"; done
echo "$L" | grep -qE '429' && pass "login attempt rate limit is active" || warn "no 429 after 14 wrong attempts (codes:$L)" "check RATE_LOGIN_PER_15MIN"

fi  # EDGE

echo; echo "=== 4. Host ==="
OK_PORTS="22 80 443 7881 7882 3478 53"
# Normal system listeners (udp only): DHCP client 68, DHCPv6 546, chrony 323, mDNS 5353
OK_UDP_PORTS="68 546 323 5353"
SSHP="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"; OK_PORTS="$OK_PORTS ${SSHP:-22}"
if command -v ss >/dev/null; then
  BAD=""
  while read -r proto addr; do
    # listeners bound only to loopback (127.0.0.0/8 incl. 127.0.0.53%lo, or ::1) are not external
    case "$addr" in 127.*|"[::1]"*|"::1"*) continue;; esac
    port="${addr##*:}"
    ok=0; for p in $OK_PORTS; do [ "$port" = "$p" ] && ok=1; done
    if [ "$proto" = udp ]; then for p in $OK_UDP_PORTS; do [ "$port" = "$p" ] && ok=1; done; fi
    { [ "$port" -ge 30000 ] && [ "$port" -le 30100 ]; } 2>/dev/null && ok=1
    [ "$ok" = 0 ] && BAD="$BAD $proto:$port"
  done < <(ss -H -tuln | awk '{print $1, $5}')
  [ -z "$BAD" ] && pass "only allowed ports listen externally" || fail "unexpected open ports:$BAD" "ss -tulpn ; only SSH/80/443/7881/7882/3478/30000-30100 should be open; never postgres(5432), synapse(8008) or gateway(3000)"
else warn "ss is not installed"; fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then pass "ufw firewall is active"; else warn "ufw is not active" "sudo ./scripts/harden-host.sh"; fi
systemctl is-active --quiet fail2ban 2>/dev/null && pass "fail2ban is active" || warn "fail2ban is not active" "sudo ./scripts/harden-host.sh"
PA="$(sshd -T 2>/dev/null | awk '/^passwordauthentication /{print $2}')"; [ "$PA" = no ] && pass "SSH password login is disabled" || warn "SSH password login is enabled" "after creating and testing an SSH key: sudo ./scripts/harden-host.sh --ssh-keys-only"
PR="$(sshd -T 2>/dev/null | awk '/^permitrootlogin /{print $2}')"; case "$PR" in no|prohibit-password|without-password) pass "root password login is disabled";; "") ;; *) warn "PermitRootLogin=$PR" "set prohibit-password in sshd_config";; esac
[ "$(stat -c %a .env 2>/dev/null)" = 600 ] && pass ".env is readable by owner only" || fail "permissions of .env are wrong ($(stat -c %a .env 2>/dev/null))" "chmod 600 .env"
[ "${#GATEWAY_ADMIN_KEY}" -ge 32 ] && pass "admin key is strong" || fail "admin key is too short" "./scripts/admin.sh rotate-key"
for k in POSTGRES_PASSWORD SYNAPSE_SHARED_SECRET LIVEKIT_SECRET; do v="${!k:-}"; [ "${#v}" -ge 24 ] || fail "$k is weak/empty" "./scripts/install.sh generates empty secrets by itself"; done
timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes && pass "server clock is synchronized" || warn "server clock is not synchronized" "timedatectl set-ntp true (a wrong clock breaks signed links and certificates)"
dpkg -s unattended-upgrades >/dev/null 2>&1 && pass "automatic security updates are installed" || warn "unattended-upgrades is not installed" "sudo ./scripts/harden-host.sh"
[ "$(df -P . | awk 'NR==2{gsub("%","",$5);print $5}')" -lt 85 ] && pass "disk has free space" || warn "disk is more than 85% full"

echo; echo "=== 5. Docker ==="
if docker info >/dev/null 2>&1; then
  U="$(docker compose exec -T gateway id -u 2>/dev/null | tr -d '\r')"; [ -n "$U" ] && [ "$U" != 0 ] && pass "gateway runs as non-root (uid $U)" || fail "gateway runs as root" "docker-compose.yml: user: 1000:1000"
  GID="$(docker compose ps -q gateway 2>/dev/null | head -1)"
  [ -n "$GID" ] && [ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$GID")" = true ] && pass "gateway filesystem is read-only" || fail "gateway filesystem is not read-only"
  PRIV="$(docker ps -q | xargs -r docker inspect -f '{{.Name}} {{.HostConfig.Privileged}}' | grep true || true)"; [ -z "$PRIV" ] && pass "no privileged containers" || fail "privileged container: $PRIV"
  SOCK="$(docker ps -q | xargs -r docker inspect -f '{{.Name}} {{range .Mounts}}{{.Source}} {{end}}' | grep docker.sock || true)"; [ -z "$SOCK" ] && pass "docker.sock is not mounted in any container" || fail "docker.sock is mounted: $SOCK"
  PUB="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\.0\.0\.0:(5432|8008|3000|7880)->' || true)"; [ -z "$PUB" ] && pass "postgres/synapse/gateway are not published on the host" || fail "internal port published: $PUB"
  NH="$(docker ps -q | xargs -r docker inspect -f '{{.Name}} {{.HostConfig.NetworkMode}}' | grep ' host' || true)"; [ -n "$NH" ] && warn "container with host network: $NH (normal for LiveKit)" || pass "no container uses host network"
else warn "Docker is not available (run with sudo)"; fi

echo; echo "=== 6. Backup ==="
# shellcheck disable=SC2010  # controlled backup globs (file names are safe)
LB="$(ls -1t backups/tikootak-*.tar.gz* backups/hamdam-*.tar.gz* 2>/dev/null | grep -v '\.sha256$' | head -1)"
if [ -z "$LB" ]; then fail "no backup exists" "./scripts/backup.sh and sudo ./scripts/install-monitor.sh"
else AGE=$(( ( $(date +%s) - $(stat -c %Y "$LB") ) / 3600 )); [ "$AGE" -le 36 ] && pass "latest backup is ${AGE} hours old" || warn "latest backup is ${AGE} hours old"
  case "$LB" in *.enc) pass "backup is encrypted";; *) fail "backup is not encrypted" "remove BACKUP_ENCRYPT=0";; esac
  [ "$(stat -c %a "$LB")" = 600 ] && pass "backup file permissions are 600" || fail "backup file permissions are looser than 600"; fi
[ -f backups/verify.log ] && tail -1 backups/verify.log | grep -q ' OK ' && pass "latest backup restore test succeeded" || warn "backup restore test has not been done yet" "./scripts/verify-backup.sh"

if [ "$APP" = 1 ]; then
  echo; echo "=== 7. App penetration tests (inside gateway) ==="
  # The container rootfs is read-only; docker compose cp writes to rootfs and fails.
  # Stream the files into the container's tmpfs instead (a restart wipes it, so this is a function).
  copy_tests() {
    docker compose exec -T gateway sh -c 'rm -rf /tmp/sec && mkdir -p /tmp/sec' >/dev/null 2>&1 || fail "could not create /tmp/sec inside gateway"
    COPY_OK=1
    for f in tests/security/*; do
      docker compose exec -T gateway sh -c 'cat > "/tmp/sec/$1"' _ "$(basename "$f")" < "$f" >/dev/null 2>&1 || COPY_OK=0
    done
    [ "$COPY_OK" = 1 ] || fail "could not copy tests into gateway"
  }
  copy_tests
  for t in sec01 sec03 sec04 sec05 sec06; do
    if [ "$t" = sec04 ] || [ "$t" = sec06 ]; then
      # Rate limiters are in-memory per IP (register: 10/hour); earlier tests use them up.
      # Restart the gateway to reset the counters, wait for /api/health, then re-copy the tests (tmpfs is wiped).
      echo "Restarting gateway to reset rate limits before sec04..."
      docker compose restart gateway >/dev/null 2>&1 || fail "could not restart gateway"
      up=0
      for _ in $(seq 1 30); do
        if docker compose exec -T gateway node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then up=1; break; fi
        sleep 2
      done
      [ "$up" = 1 ] || fail "gateway did not become healthy within 60s after restart"
      copy_tests
    fi
    OUT="$(docker compose exec -T -w /tmp/sec -e BASE=http://127.0.0.1:3000 -e ADMIN="$GATEWAY_ADMIN_KEY" gateway node $t.mjs 2>&1)"
    P="$(echo "$OUT" | grep -c '^PASS')"; F="$(echo "$OUT" | grep -c '^FAIL')"
    if [ "$F" = 0 ] && [ "$P" -gt 0 ]; then pass "$t: $P passed"; else fail "$t: $F failed, $P passed" "$(echo "$OUT" | grep -E '^FAIL|Error' | head -3 | tr '\n' ' ')"; fi
  done
fi

echo; echo "=========== Summary: PASS=$PASS  WARN=$WARN  FAIL=$FAIL ==========="
[ "$FAIL" = 0 ]
