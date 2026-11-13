#!/usr/bin/env bash
# Run TIKOOTAK on a server where haproxy (VPN / tunnel front end) already owns port 443.
# haproxy keeps 443 and hands the connections for YOUR domain to Caddy by SNI (TLS is NOT opened by haproxy, so HTTPS
# certificates and calls keep working); every other name goes to your VPN exactly as before.
#
#   sudo ./scripts/haproxy.sh status                 who owns 80/443 and whether this mode is on
#   sudo ./scripts/haproxy.sh enable [options]       move Caddy to 127.0.0.1:8443 and turn on PROXY protocol (real client IPs)
#        --https-port N   local port for Caddy HTTPS (default 8443)
#        --http-port N    local port for Caddy HTTP (default: keep 80 when it is free, else 8080)
#        --no-restart     only write the settings (the installer starts Caddy later)
#   sudo ./scripts/haproxy.sh disable                back to Caddy on public 80/443
#   ./scripts/haproxy.sh snippet                     prints the lines to add to /etc/haproxy/haproxy.cfg
#   sudo ./scripts/haproxy.sh test                   checks Caddy directly and through haproxy
# This script NEVER edits your haproxy config (it does not know your setup): you add 2 small blocks yourself (see snippet).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; N=$'\e[0m'; [ -t 1 ] || { R=""; G=""; Y=""; N=""; }
ok()   { echo "${G}[OK]${N} $*"; }
warn() { echo "${Y}[WARN]${N} $*"; }
die()  { echo "${R}[FAIL]${N} $*" >&2; exit 1; }
getenv() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2-; }
setenv() { sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; }
delenv() { sed -i "/^$1=/d" .env; }
EXTRA=config/caddy-extra/proxy-protocol.caddy

port_owner() { # port_owner tcp|udp PORT -> program that listens there (empty = free)
  local f=-ltnp o; [ "$1" = udp ] && f=-lunp
  o="$(ss -H $f "sport = :$2" 2>/dev/null)"; [ -n "$o" ] || return 0
  echo "$o" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n1 | grep . || echo "an unknown program"
}
bind_port() { echo "${1##*:}"; }

write_extra() {
  mkdir -p "$(dirname "$EXTRA")"
  # Only the :443 server expects the PROXY header. Port 80 stays plain so HTTP challenges keep working.
  # Caddy listens only on 127.0.0.1 in this mode, so only programs on this machine (haproxy) can send that header.
  cat > "$EXTRA" <<'X'
	servers :443 {
		listener_wrappers {
			proxy_protocol {
				timeout 5s
				allow 0.0.0.0/0
			}
			tls
		}
	}
X
}

cmd_snippet() {
  local dom hp; dom="$(getenv DOMAIN)"; dom="${dom:-YOUR.DOMAIN}"; hp="$(bind_port "$(getenv HTTPS_BIND)")"; hp="${hp:-8443}"
  cat <<S
# ---- add to /etc/haproxy/haproxy.cfg  (back it up first:  cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.bak) ----
# 1) In the frontend that has  "bind :443"  and  "mode tcp"  add this line ABOVE its  default_backend  line:
#        use_backend bk_tikootak if { req_ssl_sni -i ${dom} }
#    If that frontend has no SNI rules yet, it also needs these two lines (once):
#        tcp-request inspect-delay 5s
#        tcp-request content accept if { req_ssl_hello_type 1 }
# 2) Add this block at the end of the file:
backend bk_tikootak
    mode tcp
    server caddy 127.0.0.1:${hp} send-proxy
# ----
# 3) Check, then RELOAD (not restart, so VPN connections are not dropped):
#        haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl reload haproxy
# If your 443 frontend is "mode http" (haproxy opens TLS itself), this does not apply: send the frontend/backend part of
# your config (no passwords) and ask for the variant that fits.
S
}

cmd_status() {
  local o80 o443; o80="$(port_owner tcp 80)"; o443="$(port_owner tcp 443)"
  echo "port 80  : ${o80:-free}"; echo "port 443 : ${o443:-free}"
  if [ -n "$(getenv HTTPS_BIND)" ]; then ok "haproxy mode is ON (Caddy HTTPS on $(getenv HTTPS_BIND), HTTP on $(getenv HTTP_BIND || true))"
  else echo "haproxy mode is OFF (Caddy uses public 80/443)"; fi
  [ -f "$EXTRA" ] && echo "PROXY protocol file: $EXTRA" || true
  command -v haproxy >/dev/null 2>&1 && echo "haproxy: $(haproxy -v 2>/dev/null | head -n1)" || true
}

cmd_enable() {
  local hp=8443 http="" restart=1
  while [ $# -gt 0 ]; do case "$1" in
    --https-port) hp="$2"; shift;; --http-port) http="$2"; shift;; --no-restart) restart=0;;
    *) die "Unknown option: $1";; esac; shift; done
  [ -f .env ] || die ".env not found (run the installer first)"
  case "$hp" in ''|*[!0-9]*) die "--https-port must be a number";; esac
  if [ -z "$http" ]; then [ -n "$(port_owner tcp 80)" ] && ! own_stack_holds 80 && http=8080; fi
  setenv HTTPS_BIND "127.0.0.1:$hp"
  if [ -n "$http" ]; then setenv HTTP_BIND "127.0.0.1:$http"; else delenv HTTP_BIND; fi
  write_extra
  ok "haproxy mode on: Caddy HTTPS -> 127.0.0.1:$hp${http:+, HTTP -> 127.0.0.1:$http}, PROXY protocol enabled"
  if [ "$restart" = 1 ]; then
    command -v docker >/dev/null 2>&1 || die "Docker is not installed"
    docker compose up -d --force-recreate caddy >/dev/null 2>&1 && ok "Caddy restarted" || die "Caddy did not start: docker compose logs --tail 30 caddy"
  fi
  echo; cmd_snippet
}
own_stack_holds() { docker compose ps -q caddy 2>/dev/null | grep -q . && docker ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$1->"; }

cmd_disable() {
  [ -f .env ] || die ".env not found"
  delenv HTTPS_BIND; delenv HTTP_BIND; rm -f "$EXTRA"
  ok "haproxy mode off (Caddy will use public 80/443 again)"
  if command -v docker >/dev/null 2>&1; then
    local o; o="$(port_owner tcp 443)"
    if [ -n "$o" ] && [ "$o" != docker-proxy ]; then warn "port 443 is held by $o: Caddy cannot start on it. Remove the bk_tikootak lines from haproxy only after you move Caddy."; return 0; fi
    docker compose up -d --force-recreate caddy >/dev/null 2>&1 && ok "Caddy restarted"
  fi
}

cmd_test() {
  local dom hp; dom="$(getenv DOMAIN)"; hp="$(bind_port "$(getenv HTTPS_BIND)")"
  [ -n "$hp" ] || die "haproxy mode is not enabled (run: sudo ./scripts/haproxy.sh enable)"
  command -v curl >/dev/null || die "curl is required"
  local c1 c2
  c1="$(curl -sk -m 10 --haproxy-protocol --resolve "$dom:$hp:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$dom:$hp/api/health" 2>/dev/null)"
  [ "$c1" = 200 ] && ok "Caddy answers directly on 127.0.0.1:$hp (PROXY protocol works)" || warn "Caddy direct test: HTTP $c1 (docker compose logs --tail 30 caddy)"
  c2="$(curl -sk -m 10 --resolve "$dom:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$dom/api/health" 2>/dev/null)"
  if [ "$c2" = 200 ]; then ok "https://$dom works THROUGH haproxy"
  else warn "through haproxy: HTTP $c2 -> the bk_tikootak rules are not active yet (see: ./scripts/haproxy.sh snippet)"; fi
  [ "$c1" = 200 ] && [ "$c2" = 200 ]
}

case "${1:-status}" in
  status) cmd_status;;
  enable) shift; cmd_enable "$@";;
  disable) cmd_disable;;
  snippet) cmd_snippet;;
  test) cmd_test;;
  -h|--help|help) sed -n 2,16p "$0";;
  *) die "Unknown command: $1 (status | enable | disable | snippet | test)";;
esac
