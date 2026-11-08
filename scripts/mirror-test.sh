#!/usr/bin/env bash
# Tests which mirrors answer from THIS server right now (run it on the Iran server).
#   ./scripts/mirror-test.sh            test all mirrors in scripts/mirrors.list, print a table
#   ./scripts/mirror-test.sh --apply    also use the fastest working ones (needs root):
#                                       Docker registry mirrors -> /etc/docker/daemon.json, npm/apt -> .env
# Env: MIRRORS_LIST=file (other list), PROBE_TIMEOUT=8 (seconds)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
LIST="${MIRRORS_LIST:-scripts/mirrors.list}"; TO="${PROBE_TIMEOUT:-8}"; APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1
command -v curl >/dev/null || { echo "curl is required"; exit 1; }
[ -f "$LIST" ] || { echo "List not found: $LIST"; exit 1; }
G=$'\e[32m'; R=$'\e[31m'; N=$'\e[0m'
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

probe() { # kind target index
  local kind="$1" tgt="$2" i="$3" url code="" t="" mf=""
  case "$kind" in
    docker) url="${tgt%/}/v2/"; mf="${tgt%/}/v2/library/caddy/manifests/2";;
    npm)    url="${tgt%/}/express/-/express-4.19.2.tgz";;
    apt)    case "$tgt" in http*) url="${tgt%/}/ubuntu/dists/";; *) url="https://$tgt/ubuntu/dists/";; esac;;
  esac
  local out; out="$(curl -s -o /dev/null -m "$TO" -w '%{http_code} %{time_total}' "$url" 2>/dev/null)" || true
  code="${out%% *}"; t="${out##* }"; [ -n "$code" ] || code=000
  if [ "$code" = 000 ]; then t=99; fi
  local mcode=""
  if [ -n "$mf" ] && { [ "$code" = 200 ] || [ "$code" = 401 ]; }; then
    mcode="$(curl -s -o /dev/null -m "$TO" -w '%{http_code}' -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' "$mf" 2>/dev/null)"
  fi
  # a mirror is usable when the base URL answers (docker: 200/401 is normal for a registry)
  local good=0
  case "$kind" in docker) { [ "$code" = 200 ] || [ "$code" = 401 ]; } && good=1;; *) [ "$code" = 200 ] || [ "$code" = 301 ] || [ "$code" = 302 ] && good=1;; esac
  echo "$kind|$tgt|$code|${mcode:--}|$t|$good" > "$W/$i"
}

i=0
while read -r kind tgt _; do
  case "$kind" in docker|npm|apt) i=$((i + 1)); probe "$kind" "$tgt" "$i" & ;; esac
done < <(grep -vE '^\s*(#|$)' "$LIST")
wait

printf '%-7s %-52s %-5s %-6s %s\n' TYPE MIRROR CODE IMAGE TIME
for f in $(ls "$W" | sort -n); do
  IFS='|' read -r kind tgt code mcode t good < "$W/$f"
  if [ "$good" = 1 ]; then c="$G"; else c="$R"; fi
  printf '%b%-7s %-52s %-5s %-6s %ss%b\n' "$c" "$kind" "$tgt" "$code" "$mcode" "$t" "$N"
done
echo
echo "IMAGE = answer for a real image manifest (200 = the mirror serves it; 401 = needs a token, usually still OK; 404 = not cached)."

best() { # kind -> prints targets that work, fastest first
  cat "$W"/* 2>/dev/null | awk -F'|' -v k="$1" '$1==k && $6==1 {print $5"|"$2}' | sort -n | cut -d'|' -f2
}
DK="$(best docker | head -3)"; NP="$(best npm | head -1)"; AP="$(best apt | head -1)"
echo "Fastest working:  docker: ${DK:-none}"; echo "                  npm: ${NP:-none}   apt: ${AP:-none}"
[ "$APPLY" = 1 ] || { echo "Use them with:  sudo ./scripts/mirror-test.sh --apply"; exit 0; }

[ "$(id -u)" = 0 ] || { echo "--apply needs root (sudo)"; exit 1; }
setenv() { touch .env; sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; }
[ -n "$NP" ] && { setenv NPM_REGISTRY "${NP%/}/"; echo "NPM_REGISTRY set to ${NP%/}/"; }
[ -n "$AP" ] && { setenv APT_MIRROR "$AP"; echo "APT_MIRROR set to $AP (used when the gateway image is built)"; }
if [ -n "$DK" ]; then
  mkdir -p /etc/docker
  python3 - $DK <<'PY'
import json,os,sys
p='/etc/docker/daemon.json'
d=json.load(open(p)) if os.path.exists(p) and os.path.getsize(p) else {}
d['registry-mirrors']=sys.argv[1:]
json.dump(d,open(p,'w'),indent=2)
PY
  systemctl restart docker 2>/dev/null && echo "Docker mirrors set: $(echo $DK | tr '\n' ' ')" || echo "Docker config written; restart docker yourself"
fi
