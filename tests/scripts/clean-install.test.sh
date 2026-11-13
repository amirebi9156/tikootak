#!/usr/bin/env bash
# Tests for the tidy installer: ui.sh helpers, bootstrap preflight (port conflicts stop BEFORE any change), order of steps,
# and harden-host.sh safety on shared servers.  Run: bash tests/scripts/clean-install.test.sh   (needs root for /var/log; skips otherwise)
# Everything that could change the machine (apt-get, docker, systemctl, curl) is replaced by stubs.
# NOT covered: a real apt run, a real Docker pull, the terminal "staircase" bug itself (needs a real tty + needrestart).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$(mktemp -d)"; ok=0; bad=0
chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (expected '$3' got '$2')"; fi; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

# ---------- ui.sh ----------
( export LOG="$S/ui.log"; . "$ROOT/scripts/ui.sh"
  qrun "good job" bash -c 'echo hello-out' >"$S/ui1.txt" 2>&1; echo "rc=$?" >>"$S/ui1.txt"
  qrun "bad job" bash -c 'echo boom-line; exit 3' >"$S/ui2.txt" 2>&1; echo "rc=$?" >>"$S/ui2.txt" )
chk "ui1 qrun success prints one line, hides output" "$(strip < "$S/ui1.txt" | grep -c -E 'hello-out')" 0
chk "ui2 qrun success prints its label and returns 0" "$(strip < "$S/ui1.txt" | grep -c -E 'good job')$(grep -c 'rc=0' "$S/ui1.txt")" "11"
chk "ui3 qrun failure shows the command output" "$(strip < "$S/ui2.txt" | grep -c 'boom-line')" 1
chk "ui4 qrun failure returns its exit code" "$(grep -o 'rc=[0-9]*' "$S/ui2.txt")" "rc=3"
chk "ui5 everything goes to the log file" "$(grep -c -x -E 'hello-out|boom-line' "$S/ui.log")" 2
chk "ui6 stdin is closed for quiet commands" "$( ( export LOG="$S/ui.log"; . "$ROOT/scripts/ui.sh"; qrun "stdin" bash -c 'read -r x && echo got' >/dev/null 2>&1; echo $? ) )" 1

# ---------- static checks on bootstrap.sh ----------
B="$ROOT/scripts/bootstrap.sh"
chk "s1 hardening is OFF by default" "$(grep -c 'HARDEN=0; BEHIND=0; CRON=1' "$B")" 1
chk "s2 no tee of the whole script any more" "$(grep -c 'exec > >(tee' "$B")" 0
chk "s3 hardening step comes after the final checks" "$([ "$(grep -n '^step "Final checks"' "$B" | cut -d: -f1)" -lt "$(grep -n 'step "Host hardening' "$B" | cut -d: -f1)" ] && echo yes)" yes
chk "s4 apt never waits for a terminal (needrestart off, lock wait)" "$(grep -c 'NEEDRESTART_MODE=a' "$B")$(grep -c 'DPkg::Lock::Timeout=300' "$B")" "11"
chk "s5 Docker Hub is tested with a REAL pull" "$(grep -c 'docker pull -q hello-world' "$B")" 1

# ---------- bootstrap with stubs ----------
if [ "$(id -u)" != 0 ]; then echo "SKIP bootstrap runs (not root)"; else
mkdir -p "$S/bin" "$S/proj/scripts"; cp "$ROOT"/scripts/*.sh "$ROOT/scripts/mirrors.list" "$S/proj/scripts/"; cp "$ROOT/VERSION" "$ROOT/.env.example" "$S/proj/"
for c in apt-get systemctl timedatectl; do printf '#!/bin/sh\necho "%s $@" >> "%s/calls.log"\nexit 0\n' "$c" "$S" > "$S/bin/$c"; done
cat > "$S/bin/docker" <<D
#!/bin/sh
echo "docker \$@" >> "$S/calls.log"
case "\$1 \$2" in "compose version") echo "Docker Compose version stub"; exit 0;; esac
case "\$1" in --version) echo "Docker version stub";; pull) exit 1;; ps) ;; esac
exit 0
D
printf '#!/bin/sh\nprintf 000\nexit 0\n' > "$S/bin/curl"
chmod +x "$S/bin/"*
export PATH="$S/bin:$PATH"
BS() { ( cd "$S/proj" && bash scripts/bootstrap.sh "$@" 2>&1 | strip ); }

# a program holds port 443 -> stop before ANY change
python3 -I -c "
import socket,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('0.0.0.0',443)); s.listen(1); time.sleep(60)" & HOLD=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do ss -H -ltn 'sport = :443' 2>/dev/null | grep -q . && break; sleep 0.5; done
: > "$S/calls.log"
BS --domain x.test --ip 1.2.3.4 --yes > "$S/b1.txt"; rc=$?
chk "b1 port conflict stops the installer" "$(grep -c 'already used' "$S/b1.txt")" 1
chk "b2 ...names the program that holds the port" "$(grep -c '443/tcp is used by python3' "$S/b1.txt")" 1
chk "b3 ...and nothing was changed (no apt/docker/systemctl call)" "$(wc -c < "$S/calls.log" | tr -d ' ')" 0
chk "b4 ...and no .env was created" "$([ -f "$S/proj/.env" ] && echo yes || echo no)" no
: > "$S/calls.log"
BS --domain x.test --ip 1.2.3.4 --yes --force > "$S/b2.txt"
chk "b5 --force continues (apt is called)" "$(grep -c '^apt-get' "$S/calls.log" | awk '{print ($1>0)?"yes":"no"}')" yes
kill "$HOLD" 2>/dev/null; wait "$HOLD" 2>/dev/null

# no conflict, Docker Hub and every mirror refuse -> stops at the download step, firewall untouched, .env not created
: > "$S/calls.log"
BS --domain x.test --ip 1.2.3.4 --yes > "$S/b3.txt"
chk "b6 free ports are reported as free" "$(grep -c 'Ports 80, 443, 7881, 7882, 3478 are free' "$S/b3.txt")" 1
chk "b7 refused image download -> clear message" "$(grep -c 'Docker images cannot be downloaded' "$S/b3.txt")" 1
chk "b8 ...no .env, so nothing half-installed" "$([ -f "$S/proj/.env" ] && echo yes || echo no)" no
chk "b9 ...ufw/fail2ban never touched" "$(grep -c -E 'ufw|fail2ban' "$S/calls.log")" 0
chk "b10 steps are numbered" "$(grep -c -E '^\[[0-9]/8\]' "$S/b3.txt" | awk '{print ($1>=4)?"yes":"no"}')" yes
chk "b11 apt noise is not on the terminal" "$(grep -c -E 'Reading package|Get:|Unpacking' "$S/b3.txt")" 0
fi

# ---------- harden-host.sh (dry-run only) ----------
H="$ROOT/scripts/harden-host.sh"
python3 -I -c "
import socket,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('0.0.0.0',18555)); s.listen(1); time.sleep(30)" & L=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do ss -H -ltn 'sport = :18555' 2>/dev/null | grep -q . && break; sleep 0.5; done
bash "$H" --dry-run > "$S/h1.txt" 2>&1
bash "$H" --dry-run --ssh-keys-only > "$S/h2.txt" 2>&1
kill "$L" 2>/dev/null
chk "h1 never resets the firewall" "$(grep -c 'ufw --force reset' "$H")$(grep -c 'reset' "$S/h1.txt")" "00"
chk "h2 no ufw limit on SSH" "$(grep -c 'ufw limit' "$H")" 0
chk "h3 a port in use right now stays open" "$(grep -c 'tcp 18555' "$S/h1.txt")" 1
chk "h4 default deny comes AFTER the kept ports are allowed" "$([ "$(grep -n 'comment "kept' "$H" | head -1 | cut -d: -f1)" -lt "$(grep -n 'run ufw default deny' "$H" | head -1 | cut -d: -f1)" ] && echo yes)" yes
chk "h5 root password login is not touched without --ssh-keys-only" "$(grep -c 'prohibit-password' "$S/h1.txt")" 0
chk "h6 --ssh-keys-only is announced" "$(grep -c 'root key-only' "$S/h2.txt")" 1
chk "h7 ssh config never forces PermitRootLogin unconditionally" "$(grep -n 'PermitRootLogin' "$H" | grep -c -v 'KEYS_ONLY')" 0
chk "h8 fail2ban never bans the address you are logged in from" "$(grep -c 'ignoreip' "$H")" 1

rm -rf "$S"; echo "ok=$ok bad=$bad"; [ "$bad" = 0 ]
