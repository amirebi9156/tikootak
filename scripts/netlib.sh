#!/usr/bin/env bash
# Network helpers shared by bootstrap.sh and tikootak.sh (sourced, not executed).

is_private_v4() {
  case "$1" in
    10.*|127.*|169.254.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0;;
  esac
  return 1
}
local_ips() { ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1; }
dns_ips()   { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u; }
egress_ip() { curl -4 -fsS -m 6 https://api.ipify.org 2>/dev/null || curl -4 -fsS -m 6 https://ifconfig.me 2>/dev/null || true; }
valid_v4()  { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] && ! [[ "$1" =~ (^|\.)(25[6-9]|2[6-9][0-9]|[3-9][0-9][0-9])(\.|$) ]]; }

# Choose the IP that users must connect to (used by LiveKit for calls).
# NOTE: the "egress" IP seen by external services can differ from the real server IP (outbound NAT),
# so it is only the last resort.  Sets PICKED_IP and PICKED_WHY.
pick_public_ip() {
  local domain="$1" d l ip
  d="$(dns_ips "$domain")"; l="$(local_ips)"
  for ip in $d; do
    if echo "$l" | grep -qx "$ip"; then PICKED_IP="$ip"; PICKED_WHY="DNS A record of $domain, bound on this server"; return 0; fi
  done
  for ip in $l; do
    if ! is_private_v4 "$ip"; then PICKED_IP="$ip"; PICKED_WHY="public address on a network interface"; return 0; fi
  done
  for ip in $d; do
    if ! is_private_v4 "$ip"; then PICKED_IP="$ip"; PICKED_WHY="DNS A record of $domain (server is behind 1:1 NAT)"; return 0; fi
  done
  PICKED_IP="$(egress_ip)"; PICKED_WHY="outbound address (last resort - verify it!)"
  [ -n "$PICKED_IP" ]
}

# Download timing in centiseconds (99999 = failed)
time_get() {
  local s e
  s=$(date +%s%N); curl -fsS -m 25 -o /dev/null "$1" 2>/dev/null || { echo 99999; return; }
  e=$(date +%s%N); echo $(( (e - s) / 10000000 ))
}
# Pick the fastest npm registry; prints the URL (empty = keep default). Used before the gateway image build.
pick_npm_mirror() {
  local path="express/-/express-4.19.2.tgz" t0 best="" bt cand t
  t0="$(time_get "https://registry.npmjs.org/$path")"; bt="$t0"
  echo "  npm default registry: $([ "$t0" = 99999 ] && echo unreachable || echo "$((t0/100)).$((t0%100))s")" >&2
  for cand in https://registry.npmmirror.com https://package-mirror.liara.ir/repository/npm; do
    t="$(time_get "$cand/$path")"
    echo "  npm $cand: $([ "$t" = 99999 ] && echo unreachable || echo "$((t/100)).$((t%100))s")" >&2
    if [ "$t" -lt "$bt" ] && { [ "$t0" -ge 400 ] && [ $((t * 2)) -lt "$t0" ]; }; then bt="$t"; best="$cand/"; fi
  done
  echo "$best"
}
