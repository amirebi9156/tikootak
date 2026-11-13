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
#   --harden          ALSO set up firewall (ufw) + fail2ban + SSH hardening, as the LAST step. Off by default: it touches
#                     the whole server, so it must never run on a machine that has other services (VPN, tunnels) unless you ask.
#                     (it keeps every port that is listening right now open; run "scripts/harden-host.sh --dry-run" first)
#   --no-harden       accepted for old scripts; hardening is already off by default
#   --behind-haproxy  this server already runs haproxy on 443 (VPN/tunnel): keep it, put TIKOOTAK behind it by SNI
#                     (Caddy moves to 127.0.0.1:8443 with PROXY protocol; you add 2 small blocks to haproxy.cfg afterwards;
#                     see: scripts/haproxy.sh snippet)
#   --force           continue even if ports 80/443/7881/3478 are used by another program (NOT recommended)
#   --no-cron         do not install nightly backup / monitor
#   --ssh-keys-only   with --harden: disable SSH password login afterwards (ONLY if you have a working SSH key!)
#   --offline         force offline mode (needs offline-images.tar.gz in the project folder; see docs/OFFLINE-FA.md)
#   --online          ignore a bundle that is present and download everything normally
#   --cert FILE --key FILE   use your own HTTPS certificate (full chain + private key) instead of Let's Encrypt
#   --yes             no questions
# Offline mode starts automatically when offline-images.tar.gz is present: nothing is downloaded from Docker Hub/npm/GitHub,
# Docker is installed from offline/docker/ if apt cannot do it, and certs/cert.pem + certs/key.pem are used if present.
# Safe to run again (finished steps are skipped). Terminal output is short; everything detailed is in /var/log/tikootak-bootstrap.log
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
LOG=/var/log/tikootak-bootstrap.log; export LOG
. ./scripts/ui.sh
. ./scripts/netlib.sh
. ./scripts/lib.sh

DOMAIN_ARG=""; IP_ARG=""; MIRROR=""; NPM=""; APT=""; LOCK=0; HARDEN=0; BEHIND=0; CRON=1; KEYS=0; YES=0; FORCE=0; FORCE_OFFLINE=0; FORCE_ONLINE=0; CERT_ARG=""; KEY_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN_ARG="$2"; shift;; --ip) IP_ARG="$2"; shift;; --mirror) MIRROR="$2"; shift;;
    --npm) NPM="$2"; shift;; --apt) APT="$2"; shift;; --lock-admin) LOCK=1;; --harden) HARDEN=1;; --no-harden) HARDEN=0;;
    --force) FORCE=1;; --behind-haproxy) BEHIND=1;;
    --no-cron) CRON=0;; --ssh-keys-only) KEYS=1;; --yes|-y) YES=1;;
    --offline) FORCE_OFFLINE=1;; --online) FORCE_ONLINE=1;;
    --cert) CERT_ARG="$2"; shift;; --key) KEY_ARG="$2"; shift;;
    -h|--help) sed -n 2,31p "$0"; exit 0;;
    *) echo "Unknown option: $1 (see --help)"; exit 1;;
  esac; shift
done
STEP_TOTAL=8; [ "$HARDEN" = 1 ] && STEP_TOTAL=9
ask() { [ "$YES" = 1 ] && return 0; read -r -p "$1 (y/N) " a; [ "$a" = y ]; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo)."
command -v apt-get >/dev/null || die "Only Ubuntu/Debian are supported."
[ -n "$DOMAIN_ARG" ] || { [ -f .env ] && DOMAIN_ARG="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"; }
[ -n "$DOMAIN_ARG" ] && [ "$DOMAIN_ARG" != chat.example.ir ] || die "Give the domain: --domain example.com"
_log "bootstrap start: domain=$DOMAIN_ARG harden=$HARDEN force=$FORCE"

# offline mode: a bundle next to the project means "do not touch the internet"
BUNDLE="$(offline_bundle_file || true)"; OFFLINE=0
if [ "$FORCE_ONLINE" != 1 ] && { [ -n "$BUNDLE" ] || [ "$FORCE_OFFLINE" = 1 ]; }; then
  [ -n "$BUNDLE" ] || die "--offline was given but offline-images.tar.gz was not found" "Use the full kit: see docs/OFFLINE-FA.md"
  OFFLINE=1
fi
# DPkg::Lock::Timeout: wait for unattended-upgrades instead of failing; needrestart must never ask anything
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1
APT_OPTS=(-o Acquire::Retries=1 -o Acquire::http::Timeout=15 -o Acquire::https::Timeout=15 -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confold)
apt_run() { timeout --foreground "$1" apt-get "${APT_OPTS[@]}" "${@:2}"; }

printf '%sTIKOOTAK installer%s  %s\n' "$B" "$N" "$(cat VERSION 2>/dev/null)"
[ "$OFFLINE" = 1 ] && info "Offline mode: using $BUNDLE (no downloads needed)"

# ---------------------------------------------------------------- 1. read-only checks (nothing is changed here)
step "Checking this server (nothing is changed yet)"
RAM=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo); CPU=$(nproc); DISK=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
ok "$(. /etc/os-release; echo "$PRETTY_NAME") | $CPU CPU | ${RAM} MB RAM | ${DISK} GB free"
[ "$RAM" -ge 1800 ] || warn "Less than 2 GB RAM: the server will not be stable"
[ "$DISK" -ge 15 ] || warn "Low free disk (${DISK} GB); 15 GB or more is recommended"

port_owner() { # port_owner tcp|udp PORT -> program name that listens there (empty = free)
  local f=-ltnp o; [ "$1" = udp ] && f=-lunp
  o="$(ss -H $f "sport = :$2" 2>/dev/null)"; [ -n "$o" ] || return 0
  echo "$o" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n1 | grep . || echo "an unknown program"
}
own_stack_running() { [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1 && docker compose ps -q 2>/dev/null | grep -q .; }
CONFLICTS=(); HAP_HINT=0
for spec in tcp:80 tcp:443 tcp:7881 udp:7882 udp:3478; do
  proto="${spec%%:*}"; port="${spec##*:}"; owner="$(port_owner "$proto" "$port")"
  [ -n "$owner" ] || continue
  case "$owner" in docker-proxy) own_stack_running && continue;; esac   # a re-run: our own containers hold the port
  if [ "$BEHIND" = 1 ]; then case "$spec" in tcp:80|tcp:443) continue;; esac; fi   # shared with haproxy: scripts/haproxy.sh moves Caddy
  [ "$spec" = tcp:443 ] && [ "$owner" = haproxy ] && HAP_HINT=1
  CONFLICTS+=("$port/$proto is used by $owner")
done
if [ "${#CONFLICTS[@]}" -gt 0 ]; then
  for c in "${CONFLICTS[@]}"; do warn "$c"; done
  if [ "$FORCE" = 1 ]; then warn "Continuing because of --force; TIKOOTAK or that program may fail to start"
  else
    die "These ports are needed by TIKOOTAK but already used (VPN / web server / tunnel?)" \
        "$([ "$HAP_HINT" = 1 ] && echo "haproxy holds 443: TIKOOTAK can share it. Re-run with --behind-haproxy (docs/HAPROXY-FA.md). ")Or install on a separate server, or stop that service, or add --force (can break it). Nothing was changed on this server."
  fi
else
  if [ "$BEHIND" = 1 ]; then ok "Shared mode: haproxy keeps 443; TIKOOTAK goes behind it (ports 7881, 7882, 3478 are free)"
  else ok "Ports 80, 443, 7881, 7882, 3478 are free"; fi
fi

if [ -n "$IP_ARG" ]; then SRV_IP="$IP_ARG"; WHY="given with --ip"
else pick_public_ip "$DOMAIN_ARG" || die "Could not detect the public IP" "Pass it with --ip"; SRV_IP="$PICKED_IP"; WHY="$PICKED_WHY"; fi
valid_v4 "$SRV_IP" || die "Not a valid IPv4: $SRV_IP"
ok "Public IP: $SRV_IP  ($WHY)"
info "local addresses: $(local_ips | tr '\n' ' ') | outbound address: $(egress_ip) (can differ; only a last resort)"
DNS_IPS="$(dns_ips "$DOMAIN_ARG" | tr '\n' ' ')"
if echo " $DNS_IPS " | grep -q " $SRV_IP "; then ok "$DOMAIN_ARG points to this server"
else
  warn "$DOMAIN_ARG does not point to $SRV_IP yet (DNS says: ${DNS_IPS:-nothing})" "Arvan panel -> DNS: A record for @ = $SRV_IP, cloud icon GREY (DNS only). Orange cloud breaks calls (UDP) and certificates. Wait ~5 minutes."
  ask "Continue anyway? (the HTTPS certificate is obtained automatically once DNS is correct)" || exit 1
fi

# ---------------------------------------------------------------- 2. packages
step "System packages"
qrun "Updating package lists" apt_run 180 update -y || warn "apt update did not finish (mirror/internet?)" "Run: sudo tikootak mirrors test   (finds Iranian mirrors that work from this server)"
qrun "Installing basic tools" apt_run 600 install -y ca-certificates curl openssl tar gzip iproute2 dnsutils python3 sqlite3 \
  || warn "Some packages failed to install (continuing if the essentials exist)" "Details: $LOG"
timedatectl set-ntp true >/dev/null 2>&1 || true
for c in curl openssl tar gzip python3; do command -v "$c" >/dev/null || die "Required tool missing: $c" "apt install $c  (or install it from a mirror / USB, then run this again)"; done

# ---------------------------------------------------------------- 3. docker
step "Docker"
install_docker_offline() { # uses offline/docker/*.deb (and/or a compose plugin binary) from the kit
  local d=offline/docker osid
  osid="$(. /etc/os-release 2>/dev/null; echo "${ID:-x}-${VERSION_ID:-x}")"
  [ -d "$d/$osid" ] && { d="$d/$osid"; echo "Using the packages made for $osid"; }   # per-distro folder, else the flat folder
  [ -d "$d" ] || return 1
  if ls "$d"/*.deb >/dev/null 2>&1; then
    echo "Installing Docker from $d (offline packages) ..."
    apt-get install -y --no-download "$d"/*.deb || dpkg -i "$d"/*.deb || true
  fi
  if command -v docker >/dev/null && ! docker compose version >/dev/null 2>&1 && [ -f offline/docker/docker-compose ]; then
    echo "Installing the bundled docker compose plugin ..."
    mkdir -p /usr/local/lib/docker/cli-plugins && install -m 755 offline/docker/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
  fi
  command -v docker >/dev/null && docker compose version >/dev/null 2>&1
}
install_docker_online() {
  apt_run 900 install -y docker.io docker-compose-v2 || apt_run 900 install -y docker.io docker-compose-plugin || true
  docker compose version >/dev/null 2>&1 && return 0
  install_docker_offline || true
  docker compose version >/dev/null 2>&1 && return 0
  [ "$OFFLINE" = 1 ] || { curl -fsSL -m 60 https://get.docker.com 2>/dev/null | sh || true; }
  docker compose version >/dev/null 2>&1
}
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then ok "Docker already installed"
else
  qrun "Installing Docker" install_docker_online \
    || die "Docker/compose could not be installed" "Try: sudo tikootak mirrors test  |  or put the Docker .deb files in offline/docker/ (see docs/OFFLINE-FA.md)  |  or install manually: apt install docker.io docker-compose-v2"
fi
systemctl enable --now docker >/dev/null 2>&1 || true
info "$(docker --version) | $(docker compose version)"

# ---------------------------------------------------------------- 4. images / registries
step "Download access (Docker images, npm, HTTPS certificate)"
reach() { curl -s -o /dev/null -m 12 -w '%{http_code}' "$1" 2>/dev/null; }
MANUAL_CERT=0
{ [ -n "$CERT_ARG" ] || [ -f certs/cert.pem ]; } && MANUAL_CERT=1

set_docker_mirror() { # add a registry mirror to daemon.json and make Docker use it
  python3 - "$1" <<'MIRRORPY'
import json,sys,os
p='/etc/docker/daemon.json'; d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
ms=d.get('registry-mirrors',[])
if sys.argv[1] not in ms: ms.insert(0,sys.argv[1])
d['registry-mirrors']=ms; json.dump(d,open(p,'w'),indent=2)
MIRRORPY
  # restarting Docker stops other containers on this machine; with any running, only ask Docker to reload its config
  if [ -n "$(docker ps -q 2>/dev/null)" ]; then systemctl reload docker 2>/dev/null || true; else systemctl restart docker; fi
  sleep 3
}
# A REAL pull decides. (The registry "ping" answers 401 even where every image download gets 403 for Iranian addresses.)
pull_test() { docker pull -q hello-world:latest; }

if [ "$OFFLINE" = 1 ]; then
  ok "Offline mode: images come from the kit, nothing to download"
else
  if qrun "Testing a Docker Hub download" pull_test; then HUB_OK=1
  else
    HUB_OK=0
    warn "Docker Hub refused the download from this server (often 403 for Iranian IPs). Trying mirrors..."
    CANDS="${MIRROR:+$MIRROR }https://docker.arvancloud.ir $(awk '$1=="docker"{print $2}' scripts/mirrors.list 2>/dev/null | head -n 8 | tr '\n' ' ')"
    for m in $CANDS; do
      c="$(reach "$m/v2/")"
      if [ "$c" = 401 ] || [ "$c" = 200 ]; then
        set_docker_mirror "$m"
        if qrun "Download through mirror $m" pull_test; then MIRROR="$m"; HUB_OK=1; break; fi
      else info "mirror $m did not answer (code $c)"; fi
    done
  fi
  [ "$HUB_OK" = 1 ] || die "Docker images cannot be downloaded (Docker Hub and the mirrors fail)" \
      "Best: use the full offline kit (docs/OFFLINE-FA.md). Or: sudo tikootak mirrors test, then run this again. Nothing else was changed."
  NPMC="$(reach https://registry.npmjs.org/express)"
  if [ "$NPMC" = 200 ] || [ -n "$NPM" ]; then
    if [ -z "$NPM" ]; then NPM="$(pick_npm_mirror 2>>"$LOG")"; fi
    ok "npm reachable${NPM:+; using faster mirror $NPM}"
  else
    NPM="$(pick_npm_mirror 2>>"$LOG")"
    if [ -n "$NPM" ]; then ok "npm default is blocked; using mirror $NPM"
    else warn "npm is not reachable (code $NPMC) and no mirror works" "Use --npm URL, or the full offline kit (it contains the prebuilt gateway image)"; fi
  fi
fi
if [ "$MANUAL_CERT" = 1 ]; then
  ok "Your own HTTPS certificate is used; Let's Encrypt is not needed"
else
  ACME="$(reach https://acme-v02.api.letsencrypt.org/directory)"
  if [ "$ACME" = 200 ]; then ok "Let's Encrypt reachable"
  else warn "Let's Encrypt is not reachable (code $ACME)" "Use your own certificate: --cert fullchain.pem --key privkey.pem   (how to get one: ./scripts/cert.sh howto)"; fi
fi

# ---------------------------------------------------------------- 5. configuration
step "Configuration"
[ -f .env ] || cp .env.example .env
setenv() { sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; }
setenv DOMAIN "$DOMAIN_ARG"; setenv SITE_ADDRESS "$DOMAIN_ARG"; setenv PUBLIC_IP "$SRV_IP"
[ -n "$NPM" ] && setenv NPM_REGISTRY "$NPM"; [ -n "$APT" ] && setenv APT_MIRROR "$APT"
if [ "$LOCK" = 1 ]; then
  CIP="$(echo "${SSH_CLIENT:-}" | awk '{print $1}')"
  [ -n "$CIP" ] && { setenv ADMIN_ALLOW_IPS "$CIP"; ok "Admin panel is limited to $CIP (from the server, admin.sh always works)"; }
fi
chmod 600 .env
chmod +x scripts/*.sh
if [ -n "$CERT_ARG" ] || [ -f certs/cert.pem ]; then
  if [ -n "$CERT_ARG" ]; then
    [ -n "$KEY_ARG" ] || die "--cert needs --key too"
    ./scripts/cert.sh install "$CERT_ARG" "$KEY_ARG" --no-restart >>"$LOG" 2>&1 || { tail -n 8 "$LOG" | sed 's/^/      | /'; die "The certificate was rejected" "It must be the full chain + the matching key, valid for $DOMAIN_ARG"; }
    ok "Your HTTPS certificate was checked and installed"
  else
    if ./scripts/cert.sh use-manual --no-restart >>"$LOG" 2>&1; then ok "Using the saved certificate in certs/"
    else warn "certs/ is not usable; falling back to automatic HTTPS"; ./scripts/cert.sh use-auto --no-restart >/dev/null 2>&1; fi
  fi
fi
ok "Settings saved in .env for $DOMAIN_ARG"
if [ "$BEHIND" = 1 ]; then
  ./scripts/haproxy.sh enable --no-restart >>"$LOG" 2>&1 && ok "Shared mode: Caddy will listen on 127.0.0.1 only (haproxy forwards your domain to it)" \
    || die "Could not prepare shared mode" "Look at: $LOG"
fi
# install the management command early, so it exists even if a later step fails
./scripts/tikootak.sh install-cli >/dev/null 2>&1 && ok "Management command installed:  sudo tikootak"

# ---------------------------------------------------------------- 6. the app
step "Installing TIKOOTAK (the first build takes several minutes)"
if ! qrun "Building and starting the services" ./scripts/install.sh; then
  if grep -q "403 Forbidden" "$LAST_OUT" 2>/dev/null; then
    HINT="Docker Hub blocks this server. Run: sudo tikootak mirrors test   then run the install again."
  else HINT="Details: tail -n 60 $LOG   |   docker compose logs --tail 50   |   slow npm/apt? sudo tikootak mirrors set"; fi
  die "The installation did not finish" "$HINT  (re-running is safe: finished steps are skipped)"
fi
INVITE="$(sed -n '/First invite code/{n;p;}' "$LOG" | tail -n1)"

# ---------------------------------------------------------------- 7. backups
step "Nightly backup and first backup"
if [ "$CRON" = 1 ]; then
  if ./scripts/install-monitor.sh >>"$LOG" 2>&1; then ok "Nightly backup and health monitor installed"; else warn "cron install failed" "Run: sudo ./scripts/install-monitor.sh"; fi
fi
if ./scripts/backup.sh >>"$LOG" 2>&1; then ok "First backup created in backups/"; else warn "First backup failed" "Run: sudo tikootak backup"; fi

# ---------------------------------------------------------------- 8. checks
step "Final checks"
sleep 5
show_checks() { # show_checks "Name" file : one summary line, then only the lines that are not fine
  local n bad
  n="$(grep -c -E '\[OK\]|^PASS' "$2" 2>/dev/null)"; bad="$(grep -E '\[WARN\]|\[FAIL\]|^WARN|^FAIL|✘' "$2" 2>/dev/null)"
  if [ -z "$bad" ]; then ok "$1: all $n checks passed"
  else warn "$1: $n passed, some need attention"; echo "$bad" | sed 's/^/      | /'; fi
}
DOC="$(mktemp /tmp/tikootak-doc.XXXXXX)"; SEC="$(mktemp /tmp/tikootak-sec.XXXXXX)"
./scripts/doctor.sh >"$DOC" 2>&1 </dev/null || true; cat "$DOC" >>"$LOG"; show_checks "Health check" "$DOC"
./scripts/security-test.sh >"$SEC" 2>&1 </dev/null || true; cat "$SEC" >>"$LOG"; show_checks "Security test" "$SEC"
rm -f "$DOC" "$SEC"
# save the automatically obtained certificate as an emergency copy (used when Let's Encrypt becomes unreachable)
./scripts/cert.sh export-auto --quiet >/dev/null 2>&1 && ok "Emergency HTTPS certificate copy saved in certs/ (see: sudo tikootak cert)"

# ---------------------------------------------------------------- 9. optional hardening (LAST, only when asked)
if [ "$HARDEN" = 1 ]; then
  step "Host hardening (firewall, fail2ban, SSH)"
  HARDEN_ARGS=(); [ "$KEYS" = 1 ] && HARDEN_ARGS+=(--ssh-keys-only)
  if qrun "Applying hardening (open ports keep working)" ./scripts/harden-host.sh "${HARDEN_ARGS[@]}"; then
    info "The cloud firewall (Arvan Security Group) must also allow: 22/tcp 80/tcp 443/tcp 7881/tcp 7882/udp 3478/udp 30000-30100/udp"
  else warn "Hardening did not finish" "Look at: $LOG   |   undo the firewall with: ufw disable"; fi
fi
[ "$RAM" -lt 3000 ] && [ -x scripts/setup-swap.sh ] && sh scripts/setup-swap.sh >/dev/null 2>&1 && info "Swap enabled"

ADMINKEY="$(grep ^GATEWAY_ADMIN_KEY= .env | cut -d= -f2)"; BKP="$(grep ^BACKUP_PASSPHRASE= .env | cut -d= -f2)"
cat <<M

${G}${B}=============== DONE ===============${N}
Site:          https://${DOMAIN_ARG}
Admin panel:   https://${DOMAIN_ARG}/admin.html
Invite code:   ${INVITE:-(not printed: see the log above, or create one in the admin panel)}
Admin key:     ${ADMINKEY}
Backup key:    ${BKP}
Save BOTH keys outside this server now. Without the backup key, backups cannot be opened.
Manage:        sudo tikootak          (menu: status, update, backup, calls fix, logs ...)
Update later:  upload the new tikootak-*.tar.gz to /root/ then run: sudo tikootak update
Next steps:    1) register with the invite code   2) sudo tikootak calls   (checks voice/video setup)
Optional:      firewall + fail2ban:  sudo ./scripts/harden-host.sh --dry-run   (shows what it would do; it keeps open ports working)
Log:           $LOG
M
if [ "$BEHIND" = 1 ]; then
  echo
  echo "${Y}${B}ONE MORE STEP: the site works only after haproxy forwards ${DOMAIN_ARG} to Caddy.${N}"
  ./scripts/haproxy.sh snippet
  echo "After editing haproxy:   sudo ./scripts/haproxy.sh test"
fi
