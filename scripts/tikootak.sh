#!/usr/bin/env bash
# TIKOOTAK management command - one tool for everything.
#   sudo ./scripts/tikootak.sh install-cli     one time; afterwards from anywhere:  sudo tikootak
#   tikootak                   interactive menu
#   tikootak status            quick status (version, services, health, backup, signups, calls IP)
#   tikootak update [file.tar.gz|kit.tar|dir] [--yes] [--no-backup]
#                              upgrade/downgrade. A full offline kit (contains offline-images.tar.gz) updates with NO internet.
#                              Without a file it finds the newest tikootak*.tar.gz / .tar
#                              in /root, $HOME, ./updates, /tmp. Backup first, automatic rollback.
#   tikootak rollback          restore the code from before the last update (data is untouched)
#   tikootak calls             voice/video self-check;  tikootak set-ip [IP]  fix the public IP used for calls
#   tikootak restart | stop | start | settings | logs [service] | doctor | test | uninstall
#   tikootak mirrors [show|test|set|clear]   Docker/npm/apt mirrors for restricted networks (test = which Iranian mirrors work now)
#   tikootak cert [status|export-auto|install F K|use-manual|use-auto|howto]   HTTPS certificate / emergency copy
#   tikootak haproxy [status|enable|disable|snippet|test]   share port 443 with an existing haproxy (VPN server)
#   tikootak ready             blackout-readiness checklist (offline images, certificate, backups, off-site copy, disk, clock)
#   tikootak backup | verify [file] | restore <file> | migrate ...
#   tikootak signup open|close|status   |   tikootak admin <command>
set -uo pipefail

# --- locate the app directory (also through the symlink in /usr/local/bin) ---
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
if [ -f /etc/tikootak.conf ]; then . /etc/tikootak.conf; fi
APP="${TIKOOTAK_DIR:-$(dirname "$(dirname "$SELF")")}"
[ -f "$APP/docker-compose.yml" ] || { echo "App directory not found ($APP). First run: sudo ./scripts/tikootak.sh install-cli"; exit 1; }
cd "$APP" || exit 1
. ./scripts/netlib.sh
. ./scripts/lib.sh

R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'
say()  { echo "${G}[..]${N} $*"; }
okm()  { echo "${G}[OK]${N} $*"; }
warn() { echo "${Y}[WARN]${N} $*"; }
die()  { echo "${R}[FAIL] $*${N}" >&2; exit 1; }
need_root() { [ "$(id -u)" = 0 ] || die "Run as root: sudo tikootak $*"; }
yn()   { [ "${YES:-0}" = 1 ] && return 0; read -r -p "$1 (y/N) " a; [ "$a" = y ]; }
version() { cat VERSION 2>/dev/null | tr -d ' \r\n' || echo unknown; }
getenv() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
setenv() { if grep -q "^$1=" .env 2>/dev/null; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
dc() { docker compose "$@"; }
LOGF=/var/log/tikootak-cli.log
logline() { echo "$(date '+%F %T') $*" >> "$LOGF" 2>/dev/null || true; }

# version compare: prints gt|eq|lt  (a relative to b)
vcmp() {
  [ "$1" = "$2" ] && { echo eq; return; }
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ] && echo gt || echo lt
}

# ---------------------------------------------------------------- status
cmd_status() {
  echo "${B}TIKOOTAK $(version)${N}   dir: $APP"
  echo "Domain: $(getenv DOMAIN)   Public IP (calls): $(getenv PUBLIC_IP)"
  local pip; pip="$(getenv PUBLIC_IP)"
  if [ -n "$pip" ] && ! local_ips | grep -qx "$pip"; then
    if dns_ips "$(getenv DOMAIN)" | grep -qx "$pip"; then echo "  note: $pip is not on a local interface but matches DNS (1:1 NAT) - fine if your provider NATs it"
    else warn "PUBLIC_IP $pip is not on this server and not in DNS -> calls will fail. Fix: sudo tikootak set-ip"; fi
  fi
  echo; dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' 2>/dev/null || warn "docker compose is not available"
  local h; h="$(curl -fsS -m 4 -k "https://$(getenv DOMAIN)/api/health" 2>/dev/null || curl -fsS -m 4 http://127.0.0.1/api/health 2>/dev/null || true)"
  [ -n "$h" ] && echo "Health: ${G}answering${N}" || echo "Health: ${R}not answering${N}"
  local sv; sv="$(dc exec -T gateway node -e 'const D=require("better-sqlite3");const d=new D(process.env.DB_PATH||"/data/gateway.db",{readonly:true});const r=d.prepare("select max(version) v from schema_migrations").get();console.log(r&&r.v)' 2>/dev/null | tail -1)"
  [ -n "$sv" ] && echo "DB schema: $sv" || echo "DB schema: ${Y}unknown${N}"
  local last; last="$(ls -t backups/*.enc backups/*.tar.gz 2>/dev/null | head -1)"
  [ -n "$last" ] && echo "Last backup: $last ($(date -r "$last" '+%F %H:%M'))" || echo "Backup: ${Y}none yet${N}  (run: sudo tikootak backup)"
  [ -x scripts/admin.sh ] && ./scripts/admin.sh signup status 2>/dev/null | head -3 || true
  df -h / | awk 'NR==2{print "Disk: "$4" free ("$5" used)"}'
}

# ---------------------------------------------------------------- calls / public IP
cmd_calls() {
  local dom ip; dom="$(getenv DOMAIN)"; ip="$(getenv PUBLIC_IP)"
  echo "${B}Voice/video self-check${N}"
  echo "PUBLIC_IP in .env     : $ip"
  echo "Addresses on this host: $(local_ips | tr '\n' ' ')"
  echo "DNS A record          : $(dns_ips "$dom" | tr '\n' ' ')"
  echo "Outbound address      : $(egress_ip)  (informational only)"
  echo "LiveKit node_ip       : $(grep -E 'node_ip:' config/livekit.yaml 2>/dev/null | awk '{print $2}')"
  local bad=0
  if local_ips | grep -qx "$ip" || dns_ips "$dom" | grep -qx "$ip"; then okm "PUBLIC_IP matches this host or DNS"
  else echo "${R}[FAIL]${N} PUBLIC_IP is not this server's address -> calls cannot connect.  Fix: sudo tikootak set-ip"; bad=1; fi
  grep -q "node_ip: $ip" config/livekit.yaml 2>/dev/null && okm "livekit.yaml uses PUBLIC_IP" || { echo "${R}[FAIL]${N} livekit.yaml differs from .env.  Fix: sudo tikootak set-ip"; bad=1; }
  local p
  for p in 7882/udp 3478/udp 7881/tcp; do
    if ss -lnH 2>/dev/null | awk '{print $1" "$5}' | grep -q ":${p%/*}$"; then okm "host is listening on $p"
    else warn "nothing listens on $p (livekit container down?)"; bad=1; fi
  done
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    for p in 7881/tcp 7882/udp 3478/udp 30000:30100/udp; do ufw status | grep -q "${p%/*}" && okm "ufw allows $p" || { warn "ufw does not allow $p"; bad=1; }; done
  fi
  local lk; lk="$(curl -fsS -m 5 -o /dev/null -w '%{http_code}' -k "https://$dom/livekit/" 2>/dev/null)"; echo "LiveKit through Caddy (https://$dom/livekit/): HTTP ${lk:-none}"
  echo
  echo "Also required (cannot be checked from inside the server): the Arvan cloud firewall / Security Group must allow"
  echo "  7881/tcp  7882/udp  3478/udp  30000-30100/udp  (in addition to 22, 80, 443)"
  echo "Test from two different networks (mobile data + Wi-Fi)."
  return $bad
}
cmd_set_ip() {
  need_root set-ip
  local ip="${1:-}" dom; dom="$(getenv DOMAIN)"
  if [ -z "$ip" ]; then
    pick_public_ip "$dom"; echo "Detected: $PICKED_IP  ($PICKED_WHY)"
    read -r -p "Public IP [$PICKED_IP]: " v; ip="${v:-$PICKED_IP}"
  fi
  valid_v4 "$ip" || die "Not a valid IPv4: $ip"
  setenv PUBLIC_IP "$ip"
  ./scripts/render.sh || die "render failed"
  dc up -d --force-recreate livekit gateway && okm "PUBLIC_IP set to $ip; livekit restarted"
  sleep 5; cmd_calls || true
}

# ---------------------------------------------------------------- update / rollback
SNAP_DIR=".releases"
KEEP_EXCLUDES=(--exclude=./.env --exclude=./data --exclude=./backups --exclude=./.releases --exclude=./updates --exclude=./certs --exclude=./config --exclude=./node_modules --exclude=./web-src/node_modules --exclude=./offline-images.tar.gz --exclude=./offline)

snapshot_code() { # $1=name
  mkdir -p "$SNAP_DIR"
  tar czf "$SNAP_DIR/$1.tar.gz" "${KEEP_EXCLUDES[@]}" . 2>/dev/null
  ls -t "$SNAP_DIR"/*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -f   # keep only 3
}

apply_tree() { # $1=source dir - replaces app files; .env/data/backups are untouched
  local src="$1"
  rm -rf web/dist            # no stale hashed bundles
  ( cd "$src" && tar cf - "${KEEP_EXCLUDES[@]}" . ) | tar xf - -C "$APP"
  chmod +x scripts/*.sh 2>/dev/null || true
}

rebuild_and_check() {
  [ -x scripts/build-web.sh ] && [ ! -f web/dist/index.html ] && ./scripts/build-web.sh || true
  chown -R 1000:1000 data/gateway 2>/dev/null || true
  ./scripts/render.sh >/dev/null 2>&1 || true
  local i
  local BUILD=(--build); [ "${OFFLINE_LOADED:-0}" = 1 ] && BUILD=(--no-build)
  for i in 1 2 3; do dc up -d "${BUILD[@]}" && dc up -d --force-recreate caddy && break; warn "build attempt $i failed; retrying in 10s"; sleep 10; done
  say "Waiting for services..."; sleep 12
  ./scripts/doctor.sh
}

# Look for update archives: ./updates, /root, $HOME, /home/*, /tmp, current dir
tar_version() {
  local p; p="$(tar tf "$1" 2>/dev/null | grep -E '(^|/)VERSION$' | head -1)"
  [ -n "$p" ] && tar xf "$1" "$p" -O 2>/dev/null | head -1 | tr -d ' \r\n'
}
find_updates() {
  local d f; local -a dirs=("$APP/updates" /root "${HOME:-/root}" /home/* /tmp "$PWD")
  for d in "${dirs[@]}"; do
    [ -d "$d" ] || continue
    for f in "$d"/tikootak*.tar.gz "$d"/tikootak*.tgz "$d"/tikootak*.tar; do [ -f "$f" ] && echo "$f"; done
  done | awk '!s[$0]++'
}
pick_update() { # prints the chosen file; returns 1 if none
  local cur f v n=0 best="" bestv="0" bestt=0 t; cur="$(version)"
  local -a files=() vers=()
  while IFS= read -r f; do
    v="$(tar_version "$f")"; [ -n "$v" ] || continue
    files+=("$f"); vers+=("$v"); n=$((n + 1))
    t="$(stat -c %Y "$f")"
    if [ "$(vcmp "$v" "$bestv")" = gt ] || { [ "$v" = "$bestv" ] && [ "$t" -gt "$bestt" ]; }; then best="$f"; bestv="$v"; bestt="$t"; fi
  done < <(find_updates)
  [ "$n" -gt 0 ] || return 1
  {
    echo "Update archives found (installed version: $cur):"
    local i; for i in "${!files[@]}"; do printf '  %d) %-9s %s  (%s)%s\n' $((i + 1)) "${vers[$i]}" "${files[$i]}" "$(date -r "${files[$i]}" '+%F %H:%M')" "$([ "${files[$i]}" = "$best" ] && echo '  <- newest')"; done
  } >&2
  if [ "${YES:-0}" = 1 ] || [ "$n" = 1 ]; then echo "$best"; return 0; fi
  local c; read -r -p "Choose number [Enter = newest]: " c >&2
  if [ -z "$c" ]; then echo "$best"; else echo "${files[$((c - 1))]:-$best}"; fi
}

cmd_update() {
  need_root update
  local SRC="" NOBK=0; YES="${YES:-0}"
  for a in "$@"; do case "$a" in --yes|-y) YES=1;; --no-backup) NOBK=1;; *) SRC="$a";; esac; done
  if [ -z "$SRC" ]; then
    SRC="$(pick_update)" || {
      echo "No update archive found."
      echo "Upload the new file (tikootak-*.tar.gz) to this server, e.g. from your PC:"
      echo "    scp tikootak-UI35.tar.gz root@SERVER_IP:/root/"
      echo "(or put it in $APP/updates/), then run again:  sudo tikootak update"
      exit 1; }
  fi
  local T; T="$(mktemp -d /var/tmp/tikootak-upd.XXXXXX 2>/dev/null || mktemp -d /tmp/tikootak-upd.XXXXXX)"; trap 'rm -rf "$T"' RETURN
  if [ -d "$SRC" ]; then cp -a "$SRC/." "$T/"; NEW="$T"
  else
    [ -f "$SRC" ] || die "File not found: $SRC"
    [ -f "$SRC.sha256" ] && { ( cd "$(dirname "$SRC")" && sha256sum -c "$(basename "$SRC").sha256" ) >/dev/null 2>&1 || die "Checksum mismatch (file damaged during upload?)"; say "checksum OK"; }
    tar xf "$SRC" -C "$T" || die "Could not open the archive"   # tar auto-detects .tar / .tar.gz (the full kit is a plain .tar)
    NEW="$(find "$T" -maxdepth 2 -name docker-compose.yml -printf '%h\n' | head -1)"
  fi
  [ -n "$NEW" ] && [ -f "$NEW/docker-compose.yml" ] && [ -d "$NEW/gateway" ] || die "This does not look like a TIKOOTAK archive (no docker-compose.yml / gateway)"
  [ -f "$NEW/VERSION" ] || warn "No VERSION file in the archive"
  local cur new rel; cur="$(version)"; new="$(tr -d ' \r\n' < "$NEW/VERSION" 2>/dev/null || echo unknown)"
  rel="$(vcmp "$new" "$cur")"
  echo "Installed version: $cur   |   New version: $new"
  case "$rel" in
    eq) yn "Same version. Reinstall (rebuild) anyway?" || exit 0;;
    lt) warn "This is OLDER than the installed version (downgrade)."
        warn "If the newer version changed database tables, a downgrade may be incompatible (the gateway refuses to start on a newer DB schema)."
        yn "Downgrade?" || exit 0;;
    gt) yn "Upgrade to $new?" || exit 0;;
  esac
  if [ -f "$NEW/.env" ]; then warn "The archive contains .env; it is ignored (your .env is kept)"; fi

  if [ "$NOBK" = 0 ]; then say "1) Full data backup..."; ./scripts/backup.sh || { yn "Backup failed. Continue without a backup?" || exit 1; }; fi
  say "2) Saving current code for rollback ($SNAP_DIR/pre-$cur-*.tar.gz)"
  snapshot_code "pre-${cur}-$(date +%Y%m%d-%H%M%S)"
  # keep the running gateway image so a rollback works even without internet
  local GWIMG; GWIMG="$(getenv GATEWAY_IMAGE)"; GWIMG="${GWIMG:-tikootak-gateway:local}"
  docker tag "$GWIMG" tikootak-gateway:rollback 2>/dev/null && say "   saved the current gateway image for rollback"
  say "3) Replacing application files (.env and data are kept)"
  apply_tree "$NEW"
  [ -n "$(getenv BACKUP_PASSPHRASE)" ] || warn ".env has no BACKUP_PASSPHRASE!"
  if [ -f "$NEW/offline-images.tar.gz" ]; then
    say "   offline kit detected: loading its images (no internet needed)"
    OFFLINE_BUNDLE_LOADED=0; load_offline_images "$NEW/offline-images.tar.gz"
  fi
  say "4) Building and starting..."
  if rebuild_and_check; then
    logline "update $cur -> $new OK"; okm "Update finished: $(version)"
    case "$SRC" in "$APP"/updates/*) mkdir -p "$APP/updates/applied"; mv -f "$SRC" "$APP/updates/applied/" 2>/dev/null;; esac
  else
    logline "update $cur -> $new FAILED, rolling back"
    echo "${R}[FAIL] Problem after the update; rolling back to $cur ...${N}"
    if do_rollback_quiet; then say "Code is back on $cur and healthy. (data backup is in backups/)"
    else warn "Rolled back to $cur but health is not confirmed; check ./scripts/doctor.sh and 'tikootak logs'. If data is damaged: tikootak restore backups/<file>"; fi
    exit 1
  fi
}

do_rollback_quiet() {
  local f; f="$(ls -t "$SNAP_DIR"/pre-*.tar.gz 2>/dev/null | head -1)"
  [ -n "$f" ] || { warn "No saved version to roll back to"; return 1; }
  OFFLINE_LOADED=0
  if docker image inspect tikootak-gateway:rollback >/dev/null 2>&1; then
    local GWIMG; GWIMG="$(getenv GATEWAY_IMAGE)"; GWIMG="${GWIMG:-tikootak-gateway:local}"
    docker tag tikootak-gateway:rollback "$GWIMG" && OFFLINE_LOADED=1 && say "   restored the previous gateway image (no rebuild needed)"
  fi
  rm -rf web/dist; tar xzf "$f" -C "$APP" && rebuild_and_check
}
cmd_rollback() {
  need_root rollback
  local f; f="$(ls -t "$SNAP_DIR"/pre-*.tar.gz 2>/dev/null | head -1)"
  [ -n "$f" ] || die "No previous version to roll back to."
  echo "Rolling the code back to: $(basename "$f")"
  warn "Only code is restored; data (database/media) stays as it is. To restore data: tikootak restore backups/<file>"
  yn "Continue?" || exit 0
  do_rollback_quiet && okm "Rollback done: $(version)" || die "Rollback ran into a problem"
}

# ---------------------------------------------------------------- mirrors
cmd_mirrors() {
  need_root mirrors
  case "${1:-show}" in
    test) shift; exec ./scripts/mirror-test.sh "$@";;
    show) echo "NPM_REGISTRY=$(getenv NPM_REGISTRY)"; echo "APT_MIRROR=$(getenv APT_MIRROR)"
          echo "Docker mirror: $(grep -h -o '"https\?://[^"]*"' /etc/docker/daemon.json 2>/dev/null | head -3 | tr '\n' ' ')";;
    clear) sed -i '/^\(NPM_REGISTRY\|APT_MIRROR\)=/d' .env; say "npm/apt mirrors cleared (Docker mirror untouched)";;
    set)
      echo "Suggestions (test them yourself):"
      echo "  npm:    https://registry.npmmirror.com/   or   https://package-mirror.liara.ir/repository/npm/"
      echo "  apt:    ubuntu.pars.host   (host name only)"
      echo "  docker: https://docker.arvancloud.ir"
      read -r -p "NPM registry (empty = unchanged): " v; [ -n "$v" ] && setenv NPM_REGISTRY "$v"
      read -r -p "APT mirror host (empty = unchanged): " v; [ -n "$v" ] && setenv APT_MIRROR "$v"
      read -r -p "Docker registry mirror URL (empty = unchanged): " v
      if [ -n "$v" ]; then
        mkdir -p /etc/docker
        printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$v" > /etc/docker/daemon.json && systemctl restart docker && say "Docker mirror set"
      fi;;
    *) die "mirrors [show|test|set|clear]";;
  esac
}

# ---------------------------------------------------------------- readiness
cmd_ready() {
  local bad=0
  say "Blackout-readiness check (can this platform be rebuilt with NO internet?)"
  if compose_images_present >/dev/null 2>&1; then okm "All Docker images exist locally"; else warn "Some Docker images are missing locally -> a rebuild would need the internet"; bad=1; fi
  if offline_bundle_file >/dev/null; then okm "Offline image bundle on disk: $(offline_bundle_file) ($(du -h "$(offline_bundle_file)" | cut -f1))"
  else warn "No offline-images.tar.gz in $APP -> keep the full kit somewhere safe (docs/OFFLINE-FA.md)"; bad=1; fi
  [ -d offline/docker ] && ls offline/docker/*.deb >/dev/null 2>&1 && okm "Docker packages for a fresh server: offline/docker" || echo "     (optional) offline/docker not present: a fresh server without Docker needs working apt mirrors"
  if [ -f certs/cert.pem ] && [ -f certs/key.pem ]; then
    ./scripts/cert.sh check 30 >/dev/null 2>&1 && okm "Emergency certificate ready ($(./scripts/cert.sh check 0 | grep -o '[0-9-]* days left'))" || { warn "Emergency certificate expires in less than 30 days or is unreadable: sudo tikootak cert export-auto"; bad=1; }
  else warn "No emergency certificate in certs/: run  sudo tikootak cert export-auto"; bad=1; fi
  local last; last="$(ls -t backups/*.enc backups/*.tar.gz 2>/dev/null | head -1)"
  if [ -n "$last" ]; then
    local age=$(( ( $(date +%s) - $(stat -c %Y "$last") ) / 86400 ))
    [ "$age" -le 2 ] && okm "Backup is recent ($age days old)" || { warn "Latest backup is $age days old: sudo tikootak backup"; bad=1; }
  else warn "No backup yet: sudo tikootak backup"; bad=1; fi
  [ -n "$(getenv BACKUP_SCP_TARGET)" ] && okm "Off-site backup copy is configured (BACKUP_SCP_TARGET)" || { warn "No off-site backup: set BACKUP_SCP_TARGET in .env (a second server) so a lost server loses nothing"; bad=1; }
  local free; free="$(df -BG --output=avail / | tail -1 | tr -dc 0-9)"
  [ "${free:-0}" -ge 10 ] && okm "Free disk: ${free}GB" || { warn "Free disk is only ${free}GB"; bad=1; }
  if command -v timedatectl >/dev/null && [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = yes ]; then okm "Clock is synchronized"; else warn "Clock sync not confirmed. With no international internet the default NTP servers are unreachable: use an Iranian/provider NTP server (ask your hosting provider; unverified example: NTP=ir.pool.ntp.org) in /etc/systemd/timesyncd.conf, then: systemctl restart systemd-timesyncd"; fi
  [ "$(getenv ADMIN_ALLOW_IPS)" ] && okm "Admin panel is restricted to your IP" || echo "     (tip) ADMIN_ALLOW_IPS is empty: the admin panel is reachable by anyone who has the key"
  [ "$bad" = 0 ] && okm "Ready." || warn "Fix the WARN lines above, then run  sudo tikootak ready  again"
  return "$bad"
}

# ---------------------------------------------------------------- logs
cmd_logs() {
  case "${1:-}" in
    install) tail -n 200 /var/log/tikootak-bootstrap.log 2>/dev/null || warn "No install log";;
    cli) tail -n 100 "$LOGF" 2>/dev/null;;
    "") dc logs --tail 80;;
    *) dc logs --tail 200 -f "$1";;
  esac
}

# ---------------------------------------------------------------- settings
cmd_settings() {
  need_root settings
  cp .env ".env.bak.$(date +%s)"; ls -t .env.bak.* 2>/dev/null | tail -n +4 | xargs -r rm -f
  warn "Do NOT change DOMAIN (Matrix user identities depend on it). Do not change secrets by hand either."
  ${EDITOR:-nano} .env 2>/dev/null || vi .env
  if yn "Apply the changes and rebuild services?"; then chown -R 1000:1000 data/gateway 2>/dev/null; ./scripts/render.sh; dc up -d --build && dc up -d --force-recreate caddy && okm "Applied"; fi
}

cmd_uninstall() {
  need_root uninstall
  echo "${R}This stops all containers.${N}"
  yn "Stop and remove the services? (data in data/ and backups/ is kept)" || exit 0
  dc down
  if yn "Remove the global 'tikootak' command?"; then rm -f /usr/local/bin/tikootak /etc/tikootak.conf; fi
  echo "To wipe all data (irreversible): rm -rf $APP/data   (copy a backup off the server first)"
}

cmd_install_cli() {
  need_root install-cli
  ln -sf "$SELF" /usr/local/bin/tikootak
  printf 'TIKOOTAK_DIR=%s\n' "$APP" > /etc/tikootak.conf
  chmod +x "$SELF"
  okm "Installed. From now on, from anywhere:  sudo tikootak"
}

# ---------------------------------------------------------------- menu
menu() {
  while true; do
    clear 2>/dev/null
    echo "${B}  TIKOOTAK $(version)${N}  -  $(getenv DOMAIN)  -  $(getenv PUBLIC_IP)"
    cat <<EOF

  --- Status ---
   1) Quick status
   2) Health check (doctor) + security test
   3) Voice/video (calls) self-check
  --- Updates ---
   4) Update from a file (finds the newest tikootak-*.tar.gz you uploaded)
   5) Roll back to the previous version
  --- Operations ---
   6) Restart services
   7) Signups: open / close / status
   8) Users and admin overview
   9) Logs
  10) Backup and restore ...
  --- Configuration ---
  11) Edit settings (.env)
  12) Fix public IP (calls)
  13) Mirrors for restricted networks (Docker/npm/apt)
  14) (Re)run the full installer
  15) Uninstall
  16) HTTPS certificate (emergency copy, manual mode)
  17) Blackout-readiness check
   0) Exit
EOF
    read -r -p "Choice: " c
    case "$c" in
      1) cmd_status;;
      2) ./scripts/doctor.sh; yn "Run the security test too?" && ./scripts/security-test.sh --app;;
      3) cmd_calls;;
      4) cmd_update;;
      5) cmd_rollback;;
      6) dc restart && say "Done";;
      7) read -r -p "open / close / status: " s; ./scripts/admin.sh signup "$s";;
      8) ./scripts/admin.sh overview;;
      9) read -r -p "Service (gateway/synapse/caddy/livekit/postgres/install, empty = all): " s; cmd_logs "$s";;
      10) echo " a) Backup now  b) Verify a backup  c) Restore  d) Move to another server"; read -r -p "> " s
         case "$s" in a) ./scripts/backup.sh;; b) ./scripts/verify-backup.sh;; c) read -r -p "Backup file: " f; ./scripts/restore.sh "$f";; d) ./scripts/migrate.sh;; esac;;
      11) cmd_settings;;
      12) cmd_set_ip;;
      13) read -r -p "show / test / set / clear: " s; cmd_mirrors "$s";;
      14) read -r -p "Domain [$(getenv DOMAIN)]: " d; d="${d:-$(getenv DOMAIN)}"; [ -n "$d" ] && ./scripts/bootstrap.sh --domain "$d";;
      15) cmd_uninstall;;
      16) ./scripts/cert.sh status; read -r -p "export-auto / use-manual / use-auto / howto (empty = back): " s; [ -n "$s" ] && ./scripts/cert.sh "$s";;
      17) cmd_ready;;
      0|q) exit 0;;
    esac
    echo; read -r -p "Press Enter to continue..." _
  done
}

case "${1:-menu}" in
  menu) menu;;
  status) cmd_status;;
  install) shift; need_root install; exec ./scripts/bootstrap.sh "$@";;
  install-cli) cmd_install_cli;;
  update|upgrade) shift; cmd_update "$@";;
  rollback) cmd_rollback;;
  calls) cmd_calls;;
  set-ip) shift; cmd_set_ip "$@";;
  restart) dc restart;;
  stop) need_root stop; dc stop;;
  start) need_root start; dc up -d;;
  settings) cmd_settings;;
  mirrors) shift; cmd_mirrors "$@";;
  cert) shift; need_root cert; exec ./scripts/cert.sh "$@";;
  haproxy) shift; need_root haproxy; exec ./scripts/haproxy.sh "$@";;
  ready) cmd_ready;;
  logs) shift; cmd_logs "$@";;
  backup) shift; exec ./scripts/backup.sh "$@";;
  verify) shift; exec ./scripts/verify-backup.sh "$@";;
  restore) shift; exec ./scripts/restore.sh "$@";;
  migrate) shift; exec ./scripts/migrate.sh "$@";;
  env-refresh) need_root env-refresh; exec ./scripts/refresh-env.sh;;
  signup) shift; exec ./scripts/admin.sh signup "$@";;
  admin) shift; exec ./scripts/admin.sh "$@";;
  doctor) exec ./scripts/doctor.sh;;
  test) exec ./scripts/security-test.sh --app;;
  uninstall) cmd_uninstall;;
  version|-v|--version) version;;
  help|-h|--help) sed -n 2,17p "$SELF";;
  *) echo "Unknown command: $1"; sed -n 2,17p "$SELF"; exit 1;;
esac
