#!/usr/bin/env bash
# HTTPS certificate tool: keep an emergency certificate ready so the platform stays secure (mic/camera need HTTPS)
# even when Let's Encrypt is unreachable (international internet cut, ACME blocked).
#
#   cert.sh status                       mode (auto/manual), expiry of the active and the saved certificate
#   cert.sh export-auto [--quiet]        copy the certificate Caddy obtained automatically into certs/ (emergency copy)
#   cert.sh install FULLCHAIN KEY        validate and install your own certificate, switch Caddy to manual mode
#   cert.sh use-manual | use-auto        switch the mode (manual needs certs/cert.pem + certs/key.pem)
#   cert.sh check [DAYS]                 exit 1 if the saved certificate expires within DAYS (default 14)
#   cert.sh auto-fallback                if Let's Encrypt is unreachable and a valid saved certificate exists, switch to it
#                                        (restore.sh runs this, so a server moved during a blackout still gets HTTPS)
#   cert.sh howto                        how to get a certificate on your own PC (DNS challenge, no server needed)
#
# Options: --no-restart (do not recreate the caddy container; used by tests)
# certs/ is included in every backup and restored by restore.sh, so the certificate moves with the platform.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'
ok()   { echo "${G}[OK]${N} $*"; }
warn() { echo "${Y}[WARN]${N} $*"; }
die()  { echo "${R}[FAIL]${N} $*" >&2; exit 1; }
getenv() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }
setenv() { touch .env; sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; }

NORESTART=0; QUIET=0; ARGS=()
for a in "$@"; do case "$a" in --no-restart) NORESTART=1;; --quiet) QUIET=1;; *) ARGS+=("$a");; esac; done
set -- "${ARGS[@]+"${ARGS[@]}"}"
CMD="${1:-status}"; [ $# -gt 0 ] && shift

DOMAIN="$(getenv DOMAIN)"
CERT=certs/cert.pem; KEY=certs/key.pem
command -v openssl >/dev/null || die "openssl is required (apt install openssl)"

days_left() { # $1 = pem file -> prints whole days (negative if expired)
  local end now
  end="$(openssl x509 -noout -enddate -in "$1" 2>/dev/null | cut -d= -f2)" || return 1
  [ -n "$end" ] || return 1
  now="$(date +%s)"; echo $(( ( $(date -d "$end" +%s) - now ) / 86400 ))
}
pub_hash_cert() { openssl x509 -in "$1" -noout -pubkey 2>/dev/null | openssl sha256 2>/dev/null | awk '{print $NF}'; }
pub_hash_key()  { openssl pkey -in "$1" -pubout 2>/dev/null | openssl sha256 2>/dev/null | awk '{print $NF}'; }
covers_domain() { # $1 pem, $2 domain: SAN (or CN) matches, wildcard aware
  local names n d="$2"
  names="$(openssl x509 -in "$1" -noout -ext subjectAltName 2>/dev/null | tr ',' '\n' | sed -n 's/.*DNS:\s*//p' | tr -d ' ')"
  [ -n "$names" ] || names="$(openssl x509 -in "$1" -noout -subject 2>/dev/null | sed -n 's/.*CN\s*=\s*//p')"
  for n in $names; do
    [ "$n" = "$d" ] && return 0
    case "$n" in '*.'*) [ "${d#*.}" = "${n#*.}" ] && [ "$d" != "${d#*.}" ] && return 0;; esac
  done
  return 1
}

# Validates a cert+key pair for $DOMAIN. Prints problems; returns 0 only when it is safe to use.
validate_pair() { # $1 cert, $2 key
  local c="$1" k="$2" bad=0 d n
  [ -f "$c" ] || { echo "[FAIL] certificate file not found: $c"; return 1; }
  [ -f "$k" ] || { echo "[FAIL] key file not found: $k"; return 1; }
  openssl x509 -in "$c" -noout >/dev/null 2>&1 || { echo "[FAIL] $c is not a valid PEM certificate"; return 1; }
  openssl pkey -in "$k" -noout >/dev/null 2>&1 || { echo "[FAIL] $k is not a valid private key (encrypted keys are not supported: remove the passphrase)"; return 1; }
  if [ "$(pub_hash_cert "$c")" != "$(pub_hash_key "$k")" ] || [ -z "$(pub_hash_cert "$c")" ]; then
    echo "[FAIL] the private key does not belong to this certificate"; bad=1
  fi
  d="$(days_left "$c")" || d=-9999
  if [ "$d" -lt 0 ]; then echo "[FAIL] the certificate is expired"; bad=1
  elif [ "$d" -lt 14 ]; then echo "[WARN] the certificate expires in $d days"; fi
  if [ -n "$DOMAIN" ] && ! covers_domain "$c" "$DOMAIN"; then echo "[FAIL] the certificate does not cover $DOMAIN"; bad=1; fi
  n="$(grep -c 'BEGIN CERTIFICATE' "$c")"
  [ "$n" -ge 2 ] || echo "[WARN] the file holds only 1 certificate: use the FULL CHAIN (leaf + intermediate), otherwise some phones will reject it"
  [ "$bad" = 0 ] && echo "[OK] certificate is valid for $DOMAIN, $d days left, key matches"
  return "$bad"
}

restart_caddy() {
  [ "$NORESTART" = 1 ] && return 0
  command -v docker >/dev/null || { warn "docker not found; restart caddy yourself"; return 0; }
  docker compose up -d --force-recreate caddy >/dev/null 2>&1 && ok "Caddy restarted" || warn "Could not restart caddy: run  docker compose up -d --force-recreate caddy"
}

mode() { [ "$(getenv CADDYFILE)" = ./Caddyfile.manual-cert ] && echo manual || echo auto; }

# Finds the newest certificate Caddy stored for $DOMAIN (automatic mode). Sets AUTO_CRT / AUTO_KEY.
find_auto_cert() {
  AUTO_CRT=""; AUTO_KEY=""
  [ -n "$DOMAIN" ] || return 1
  local f
  f="$(find data/caddy -type f -path '*certificates*' -name "${DOMAIN}.crt" -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
  [ -n "$f" ] || return 1
  [ -f "${f%.crt}.key" ] || return 1
  AUTO_CRT="$f"; AUTO_KEY="${f%.crt}.key"
}

cmd_status() {
  echo "Domain: ${DOMAIN:-unknown}    Mode: $(mode)"
  if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    local d; d="$(days_left "$CERT")" || d="?"
    echo "Saved certificate (certs/cert.pem): $d days left"
    validate_pair "$CERT" "$KEY" | sed 's/^/  /'
  else echo "Saved certificate (certs/cert.pem): none  -> run: sudo ./scripts/cert.sh export-auto"; fi
  if find_auto_cert; then echo "Automatic certificate (Caddy): $(days_left "$AUTO_CRT") days left"; else echo "Automatic certificate (Caddy): none found yet"; fi
  if command -v docker >/dev/null && docker compose ps caddy >/dev/null 2>&1 && [ -n "$DOMAIN" ]; then
    local live; live="$(echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    [ -n "$live" ] && echo "Certificate served right now: expires $live" || echo "Certificate served right now: could not read (is caddy running?)"
  fi
}

cmd_export_auto() {
  find_auto_cert || { [ "$QUIET" = 1 ] || die "Caddy has no automatic certificate yet for ${DOMAIN:-?} (start the platform with DNS and port 80/443 working first)"; exit 0; }
  validate_pair "$AUTO_CRT" "$AUTO_KEY" >/dev/null 2>&1 || { [ "$QUIET" = 1 ] || { validate_pair "$AUTO_CRT" "$AUTO_KEY"; die "The automatic certificate failed validation; not copied"; }; exit 0; }
  mkdir -p certs
  # only replace when the new one lasts longer than the saved one
  if [ -f "$CERT" ]; then
    local old new; old="$(days_left "$CERT" 2>/dev/null || echo -9999)"; new="$(days_left "$AUTO_CRT")"
    [ "$new" -gt "$old" ] || { [ "$QUIET" = 1 ] || ok "Saved certificate is already the freshest ($old days left)"; exit 0; }
  fi
  install -m 644 "$AUTO_CRT" "$CERT.tmp" && install -m 600 "$AUTO_KEY" "$KEY.tmp" && mv -f "$CERT.tmp" "$CERT" && mv -f "$KEY.tmp" "$KEY"
  [ "$QUIET" = 1 ] || { ok "Emergency copy saved in certs/ ($(days_left "$CERT") days left). It is included in every backup."; echo "    To use it when ACME is unreachable:  sudo ./scripts/cert.sh use-manual"; }
}

cmd_install() {
  local c="${1:-}" k="${2:-}"
  [ -n "$c" ] && [ -n "$k" ] || die "Usage: cert.sh install FULLCHAIN.pem PRIVKEY.pem"
  validate_pair "$c" "$k" || die "Not installed."
  mkdir -p certs
  install -m 644 "$c" "$CERT" && install -m 600 "$k" "$KEY"
  ok "Installed into certs/"
  cmd_use_manual
}

cmd_use_manual() {
  [ -f "$CERT" ] && [ -f "$KEY" ] || die "certs/cert.pem and certs/key.pem are missing (run export-auto or install first)"
  validate_pair "$CERT" "$KEY" || die "Refusing to switch: the saved certificate is not usable"
  setenv CADDYFILE ./Caddyfile.manual-cert
  ok "Caddy is set to use your certificate (manual mode)"
  restart_caddy
}

cmd_use_auto() {
  setenv CADDYFILE ./Caddyfile
  ok "Caddy is set to get certificates automatically (Let's Encrypt)"
  restart_caddy
}

cmd_auto_fallback() {
  [ "$(mode)" = manual ] && { echo "Already in manual mode."; return 0; }
  [ -f "$CERT" ] && [ -f "$KEY" ] || { echo "No saved certificate in certs/: staying in automatic mode."; return 0; }
  local code; code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "${ACME_URL:-https://acme-v02.api.letsencrypt.org/directory}" 2>/dev/null)"
  if [ "$code" = 200 ]; then ok "Let's Encrypt is reachable: staying in automatic mode"; return 0; fi
  warn "Let's Encrypt is NOT reachable (code ${code:-none}): switching to the saved certificate"
  cmd_use_manual
}

cmd_check() {
  local th="${1:-14}" d
  [ -f "$CERT" ] || { echo "No saved certificate"; exit 1; }
  d="$(days_left "$CERT")" || { echo "Cannot read certs/cert.pem"; exit 1; }
  echo "Saved certificate: $d days left (threshold $th)"
  [ "$d" -gt "$th" ]
}

cmd_howto() {
  cat <<EOF
Get a certificate on your own PC (no server needed, works with any DNS provider)
---------------------------------------------------------------------------------
You need: a computer with free internet, and access to the DNS panel of ${DOMAIN:-your domain}.
1) Install acme.sh (Linux/macOS/WSL):   curl https://get.acme.sh | sh
2) Ask for the certificate with the DNS challenge (replace DOMAIN):
     ~/.acme.sh/acme.sh --issue --dns -d DOMAIN --yes-I-know-dns-manual-mode-enough-go-ahead-please
   It prints a TXT record (_acme-challenge). Add it in the DNS panel (Arvan: DNS -> add record -> TXT), wait 1-2 minutes, then:
     ~/.acme.sh/acme.sh --renew -d DOMAIN --yes-I-know-dns-manual-mode-enough-go-ahead-please
3) Copy the files to the server (fullchain + key):
     scp ~/.acme.sh/DOMAIN_ecc/fullchain.cer root@SERVER:/root/fullchain.pem
     scp ~/.acme.sh/DOMAIN_ecc/DOMAIN.key    root@SERVER:/root/privkey.pem
4) On the server:   sudo ./scripts/cert.sh install /root/fullchain.pem /root/privkey.pem
The certificate lasts up to 90 days (Let's Encrypt). Renew it every ~60 days while the internet is free.
EOF
}

case "$CMD" in
  status) cmd_status;;
  export-auto) cmd_export_auto;;
  install) cmd_install "$@";;
  use-manual) cmd_use_manual;;
  use-auto) cmd_use_auto;;
  check) cmd_check "$@";;
  auto-fallback) cmd_auto_fallback;;
  howto) cmd_howto;;
  *) sed -n 2,14p "$0"; exit 1;;
esac
