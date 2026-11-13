#!/usr/bin/env bash
# Tests for the management menu and "tikootak update --online|--check" against a LOCAL fake release server.
# Run: bash tests/scripts/menu-update.test.sh      (fake docker; no network; GH_API points at 127.0.0.1)
# NOT covered: the real GitHub API/redirects to the asset store, colours on a real terminal (colours are off when not a tty).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$(mktemp -d)"; ok=0; bad=0
chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (expected '$3' got '$2')"; fi; }
mkdir -p "$S/bin" "$S/app/scripts" "$S/app/gateway" "$S/app/web/dist/assets" "$S/new/tikootak/"{gateway,scripts,web/dist/assets} "$S/srv/assets" "$S/srv/repos/amirebi9156/tikootak/releases/tags"
printf '#!/bin/bash\nexit 0\n' > "$S/bin/docker"; chmod +x "$S/bin/docker"
cp "$ROOT/scripts/tikootak.sh" "$ROOT/scripts/netlib.sh" "$ROOT/scripts/lib.sh" "$S/app/scripts/"
for d in app new/tikootak; do touch "$S/$d/docker-compose.yml"; printf '#!/bin/bash\nexit 0\n' > "$S/$d/scripts/backup.sh"; printf '#!/bin/bash\nexit 0\n' > "$S/$d/scripts/doctor.sh"; done
chmod +x "$S"/app/scripts/*.sh "$S"/new/tikootak/scripts/*.sh
echo 1.0.0 > "$S/app/VERSION"; echo "DOMAIN=x.ir" > "$S/app/.env"; echo "PUBLIC_IP=1.2.3.4" >> "$S/app/.env"
rm -rf /var/tmp/tikootak-dl.* 2>/dev/null; PORT=18765; export GH_API="http://127.0.0.1:$PORT" UPD_CACHE="$S/cache"
( cd "$S/srv" && exec python3 -I -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) & SRV=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.3; done
R="$S/srv/repos/amirebi9156/tikootak/releases"
release() { # release VERSION [noassets|badsum]
  local v="$1" mode="${2:-}" a="tikootak-$1.tar.gz"
  echo "$v" > "$S/new/tikootak/VERSION"; echo "$v" > "$S/new/tikootak/web/dist/assets/new-$v.js"
  (cd "$S/new" && tar czf "$S/srv/assets/$a" tikootak)
  if [ "$mode" = badsum ]; then echo "0000000000000000000000000000000000000000000000000000000000000000  $a" > "$S/srv/assets/$a.sha256"
  else (cd "$S/srv/assets" && sha256sum "$a" > "$a.sha256"); fi
  python3 -I - "$v" "$mode" "$PORT" "$R" <<'PY'
import json,sys
v,mode,port,R=sys.argv[1:5]; a=f"tikootak-{v}.tar.gz"
assets=[] if mode=="noassets" else [{"name":n,"url":f"http://127.0.0.1:{port}/assets/{n}"} for n in (a,a+".sha256")]
d={"tag_name":"v"+v,"assets":assets}
json.dump(d,open(f"{R}/tags/v{v}","w")); json.dump(d,open(f"{R}/latest","w"))
PY
}
export PATH="$S/bin:$PATH"; cd "$S/app"
T() { ./scripts/tikootak.sh "$@" 2>&1; }

release 1.5.0
T update --check > "$S/c1.txt"; rc=$?
chk "1 --check reports a newer release" "$(grep -c 'newer version is available' "$S/c1.txt")" 1
chk "2 --check exit code 10 = update available" "$rc" 10
T update --online --yes > "$S/u1.txt"
chk "3 update --online installs the newest release" "$(cat VERSION)" 1.5.0
chk "4 ...and shows what it did" "$(grep -c 'Release: 1.5.0' "$S/u1.txt")" 1
chk "5 .env is kept" "$(grep -c '^DOMAIN=x.ir$' .env)" 1
T update --online --yes > "$S/u2.txt"
chk "6 already latest -> nothing to do" "$(grep -c 'Already up to date' "$S/u2.txt")" 1
T update --check >/dev/null; chk "7 --check exit 0 when up to date" "$?" 0

release 1.6.0 noassets
T update --online --yes > "$S/u3.txt"; rc=$?
chk "8 release without the program file -> refused, clear reason" "$(grep -c 'has no file tikootak-1.6.0.tar.gz' "$S/u3.txt")" 1
chk "9 ...installed version unchanged" "$(cat VERSION)" 1.5.0
chk "10 ...non-zero exit" "$([ "$rc" != 0 ] && echo yes)" yes

release 1.7.0 badsum
T update --online --yes > "$S/u4.txt"
chk "11 damaged download (wrong sha256) is refused" "$(grep -c 'Checksum mismatch' "$S/u4.txt")" 1
chk "12 ...installed version unchanged" "$(cat VERSION)" 1.5.0

release 1.8.0
T update 1.8.0 --yes >/dev/null; chk "13 explicit version number works" "$(cat VERSION)" 1.8.0
echo n | ./scripts/tikootak.sh update 1.5.0 >/dev/null 2>&1; chk "14 explicit older version asks first (answer n = no downgrade)" "$(cat VERSION)" 1.8.0

GH_API="http://127.0.0.1:1" T update --online --yes > "$S/u5.txt"; rc=$?
chk "15 unreachable release server -> helpful message" "$(grep -c 'Cannot reach the release server' "$S/u5.txt")" 1
chk "16 ...and nothing changed" "$(cat VERSION)" 1.8.0
chk "17 temp download folders are cleaned up" "$(ls -d /var/tmp/tikootak-dl.* 2>/dev/null | wc -l | tr -d ' ')" 0

# menu
echo 9.9.9 > "$S/cache"
printf '0\n' | ./scripts/tikootak.sh > "$S/m1.txt" 2>&1
chk "18 menu shows the current version and domain" "$(grep -c -E 'TIKOOTAK +v1.8.0 +x.ir' "$S/m1.txt")" 1
chk "19 menu announces a newer cached version" "$(grep -c 'New version 9.9.9 is available' "$S/m1.txt")" 1
chk "20 menu has grouped sections" "$(grep -c -E '^ +(STATUS|UPDATES|OPERATIONS|SETTINGS)$' "$S/m1.txt")" 4
chk "21 menu offers the one-step update" "$(grep -c 'Update to the newest release' "$S/m1.txt")" 1
chk "22 no colour codes when not a terminal" "$(grep -c $'\e\\[' "$S/m1.txt")" 0
echo 1.8.0 > "$S/cache"; printf '0\n' | ./scripts/tikootak.sh > "$S/m2.txt" 2>&1
chk "23 no banner when up to date" "$(grep -c 'is available' "$S/m2.txt")" 0

kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
rm -rf "$S"; echo "ok=$ok bad=$bad"; [ "$bad" = 0 ]
