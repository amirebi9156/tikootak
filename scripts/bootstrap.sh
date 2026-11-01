#!/usr/bin/env bash
# One-command install on a fresh Ubuntu/Debian server. Run as root:
#   sudo ./scripts/bootstrap.sh --domain example.com
# Options:
#   --domain D        domain (required; its A record must point to this server, Arvan cloud must be grey/"DNS only")
#   --ip IP           public IP of this server (default: detected automatically)
#   --mirror URL      Docker registry mirror (e.g. https://docker.arvancloud.ir) if Docker Hub is blocked
#   --npm URL         npm registry mirror used when building the gateway (default: auto-pick the fastest)
#   --apt HOST        Debian mirror host name for the gateway image build
#   --lock-admin      allow the admin panel only from your current SSH IP (ADMIN_ALLOW_IPS)
#   --no-harden       do not touch firewall / fail2ban / SSH
#   --no-cron         do not install nightly backup / monitor
#   --ssh-keys-only   disable SSH password login afterwards (ONLY if you have a working SSH key!)
#   --yes             no questions
# Safe to run again (finished steps are skipped). Log: /var/log/tikootak-bootstrap.log
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
exec > >(tee -a /var/log/tikootak-bootstrap.log) 2>&1
. ./scripts/netlib.sh

DOMAIN_ARG=""; IP_ARG=""; MIRROR=""; NPM=""; APT=""; LOCK=0; HARDEN=1; CRON=1; KEYS=0; YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN_ARG="$2"; shift;; --ip) IP_ARG="$2"; shift;; --mirror) MIRROR="$2"; shift;;
    --npm) NPM="$2"; shift;; --apt) APT="$2"; shift;; --lock-admin) LOCK=1;; --no-harden) HARDEN=0;;
    --no-cron) CRON=0;; --ssh-keys-only) KEYS=1;; --yes|-y) YES=1;;
    *) echo "Unknown option: $1"; exit 1;;
  esac; shift
done
R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'
step() { echo; echo "${G}== $1${N}"; }
die()  { echo "${R}[FAIL] $1${N}"; [ -n "${2:-}" ] && echo "   -> $2"; exit 1; }
warn() { echo "${Y}[WARN] $1${N}"; [ -n "${2:-}" ] && echo "   -> $2"; }
ok()   { echo "${G}[OK]${N} $1"; }
ask()  { [ "$YES" = 1 ] && return 0; read -r -p "$1 (y/N) " a; [ "$a" = y ]; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo)."
command -v apt-get >/dev/null || die "Only Ubuntu/Debian are supported."
[ -n "$DOMAIN_ARG" ] || { [ -f .env ] && DOMAIN_ARG="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"; }
[ -n "$DOMAIN_ARG" ] && [ "$DOMAIN_ARG" != chat.example.ir ] || die "Give the domain: --domain example.com"

step "1. Server check"
RAM=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo); CPU=$(nproc); DISK=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
echo "CPU: $CPU cores | RAM: ${RAM}MB | free disk: ${DISK}GB | $(. /etc/os-release; echo "$PRETTY_NAME")"
[ "$RAM" -ge 1800 ] || warn "Less than 2 GB RAM: the server will not be stable"
[ "$DISK" -ge 15 ] || warn "Low free disk (${DISK}GB)"
for P in 80 443; do
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -q ":$P$"; then
    ( docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$P->" ) || warn "Port $P is already used by another program (nginx/apache?)" "systemctl disable --now nginx apache2"
  fi
done

step "2. Public IP and DNS"
if [ -n "$IP_ARG" ]; then SRV_IP="$IP_ARG"; WHY="given with --ip"
else pick_public_ip "$DOMAIN_ARG" || die "Could not detect the public IP" "Pass it with --ip"; SRV_IP="$PICKED_IP"; WHY="$PICKED_WHY"; fi
valid_v4 "$SRV_IP" || die "Not a valid IPv4: $SRV_IP"
echo "Local addresses : $(local_ips | tr '\n' ' ')"
echo "Outbound address: $(egress_ip)   (can differ from the server IP; NOT used unless nothing else is found)"
ok "Using public IP: $SRV_IP  ($WHY)"
DNS_IPS="$(dns_ips "$DOMAIN_ARG" | tr '\n' ' ')"
echo "DNS A record of $DOMAIN_ARG: ${DNS_IPS:-not found}"
if echo " $DNS_IPS " | grep -q " $SRV_IP "; then ok "Domain points to this server"
else
  warn "Domain does not point to $SRV_IP yet" "Arvan panel -> DNS: A record for @ = $SRV_IP, cloud icon GREY (DNS only). Orange cloud breaks calls (UDP) and certificates. Wait ~5 minutes."
  ask "Continue anyway? (the HTTPS certificate is obtained automatically once DNS is correct)" || exit 1
fi

step "3. Prerequisites (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || warn "apt update did not finish (mirror/internet?)"
apt-get install -y ca-certificates curl openssl tar gzip iproute2 dnsutils python3 sqlite3 >/dev/null 2>&1 || warn "Some packages failed to install"
timedatectl set-ntp true >/dev/null 2>&1 || true

step "4. Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Installing Docker ..."
  apt-get install -y docker.io docker-compose-v2 >/dev/null 2>&1 || apt-get install -y docker.io docker-compose-plugin >/dev/null 2>&1 || true
  if ! docker compose version >/dev/null 2>&1; then curl -fsSL https://get.docker.com 2>/dev/null | sh >/dev/null 2>&1 || true; fi
  docker compose version >/dev/null 2>&1 || die "Docker/compose could not be installed" "Install manually: apt install docker.io docker-compose-v2"
fi
systemctl enable --now docker >/dev/null 2>&1 || true
echo "$(docker --version) | $(docker compose version)"

step "5. Registry access (Docker Hub, npm, Let's Encrypt)"
reach() { curl -s -o /dev/null -m 12 -w '%{http_code}' "$1" 2>/dev/null; }
HUB="$(reach https://registry-1.docker.io/v2/)"
if [ "$HUB" = 401 ] || [ "$HUB" = 200 ]; then ok "Docker Hub reachable"; HUB_OK=1
else
  HUB_OK=0; warn "Docker Hub is not reachable (code $HUB)"
  for m in ${MIRROR:+$MIRROR} https://docker.arvancloud.ir; do
    c="$(reach "$m/v2/")"
    if [ "$c" = 401 ] || [ "$c" = 200 ]; then
      ok "Mirror works: $m"; MIRROR="$m"; HUB_OK=1
      python3 - "$m" <<'PY'
import json,sys,os
p='/etc/docker/daemon.json'; d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
ms=d.get('registry-mirrors',[])
if sys.argv[1] not in ms: ms.insert(0,sys.argv[1])
d['registry-mirrors']=ms; json.dump(d,open(p,'w'),indent=2)
PY
      systemctl restart docker; sleep 3; break
    else echo "  mirror $m did not answer (code $c)"; fi
  done
fi
if [ "$HUB_OK" = 0 ] && ! ls offline-images.tar.gz images.tar.gz offline-images.tar >/dev/null 2>&1; then
  die "Docker Hub and the mirrors are unreachable and there is no offline image bundle" "On a computer with free internet run ./scripts/save-images.sh, upload images.tar.gz here, run this again"
fi
NPMC="$(reach https://registry.npmjs.org/express)"
if [ "$NPMC" = 200 ] || [ -n "$NPM" ]; then
  ok "npm reachable (code $NPMC)"
  if [ -z "$NPM" ]; then echo "Measuring npm mirrors (a slow npm can make the first build take 15+ minutes)..."; NPM="$(pick_npm_mirror)"; [ -n "$NPM" ] && ok "Using faster npm mirror: $NPM"; fi
else
  warn "npm is not reachable (code $NPMC)"; echo "Trying mirrors..."; NPM="$(pick_npm_mirror)"
  [ -n "$NPM" ] || warn "No npm mirror works" "Use --npm URL or an offline bundle (scripts/pack-offline.sh)"
fi
ACME="$(reach https://acme-v02.api.letsencrypt.org/directory)"
[ "$ACME" = 200 ] && ok "Let's Encrypt reachable" || warn "Let's Encrypt is not reachable (code $ACME)" "Use a manual certificate: see README (Caddyfile.manual-cert)"

step "6. Configuration (.env)"
[ -f .env ] || cp .env.example .env
setenv() { sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; }
setenv DOMAIN "$DOMAIN_ARG"; setenv SITE_ADDRESS "$DOMAIN_ARG"; setenv PUBLIC_IP "$SRV_IP"
[ -n "$NPM" ] && setenv NPM_REGISTRY "$NPM"; [ -n "$APT" ] && setenv APT_MIRROR "$APT"
if [ "$LOCK" = 1 ]; then
  CIP="$(echo "${SSH_CLIENT:-}" | awk '{print $1}')"
  [ -n "$CIP" ] && { setenv ADMIN_ALLOW_IPS "$CIP"; echo "Admin panel is limited to $CIP (from the server, admin.sh always works)"; }
fi
chmod 600 .env
chmod +x scripts/*.sh
# install the management command early, so it exists even if a later step fails
./scripts/tikootak.sh install-cli >/dev/null 2>&1 && ok "Management command installed:  sudo tikootak"

if [ "$HARDEN" = 1 ]; then
  step "7. Host hardening (firewall, fail2ban, SSH)"
  HARDEN_ARGS=()
  [ "$KEYS" = 1 ] && HARDEN_ARGS+=(--ssh-keys-only)
  ./scripts/harden-host.sh "${HARDEN_ARGS[@]}" || warn "harden-host did not finish"
  echo "${Y}Reminder:${N} the Arvan firewall (Security Group) must also allow: 22/tcp 80/tcp 443/tcp 7881/tcp 7882/udp 3478/udp 30000-30100/udp"
fi
[ "$RAM" -lt 3000 ] && [ -x scripts/setup-swap.sh ] && sh scripts/setup-swap.sh >/dev/null 2>&1 && echo "Swap enabled"

step "8. Installing TIKOOTAK (first build takes several minutes)"
if ! ./scripts/install.sh; then
  echo
  echo "${R}[FAIL] install.sh failed.${N}"
  echo "   -> Re-run safely:  sudo tikootak install --domain $DOMAIN_ARG        (finished steps are skipped)"
  echo "   -> Look at:        docker compose logs --tail 50   |   tail -50 /var/log/tikootak-bootstrap.log"
  echo "   -> Slow/blocked npm or apt:  sudo tikootak mirrors set"
  exit 1
fi

if [ "$CRON" = 1 ]; then step "9. Nightly backup and monitor"; ./scripts/install-monitor.sh || warn "cron install failed"; fi
step "10. First backup"
./scripts/backup.sh >/dev/null 2>&1 && ok "First backup created in backups/" || warn "First backup failed" "Run: sudo tikootak backup"

step "11. Final checks"
sleep 5; ./scripts/doctor.sh || true
echo; ./scripts/security-test.sh || warn "Some security checks failed; see above"

ADMINKEY="$(grep ^GATEWAY_ADMIN_KEY= .env | cut -d= -f2)"; BKP="$(grep ^BACKUP_PASSPHRASE= .env | cut -d= -f2)"
cat <<M

${G}=============== DONE ===============${N}
Site:          https://${DOMAIN_ARG}
Admin panel:   https://${DOMAIN_ARG}/admin.html
Admin key:     ${ADMINKEY}
Backup key:    ${BKP}
Save BOTH keys outside this server now. Without the backup key, backups cannot be opened.
Manage:        sudo tikootak          (menu: status, update, backup, calls fix, logs ...)
Update later:  upload the new tikootak-*.tar.gz to /root/ then run: sudo tikootak update
Next steps:    1) register with the invite code printed above   2) sudo tikootak calls   (checks voice/video setup)
M
