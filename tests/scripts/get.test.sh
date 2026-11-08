#!/usr/bin/env bash
# Tests get.sh (one-line installer) with a fake release; no Docker/GitHub needed. Run as root.
set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$PWD"; T="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
FAIL=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; FAIL=$((FAIL+1)); }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
show() { echo "--- $1"; tail -5 "$1"; }

# fake release: tikootak/{VERSION,scripts/bootstrap.sh,scripts/restore.sh,scripts/doctor.sh}
mkdir -p "$T/pkg/tikootak/scripts"; echo 9.9.9 > "$T/pkg/tikootak/VERSION"
cat > "$T/pkg/tikootak/scripts/bootstrap.sh" <<'S'
#!/usr/bin/env bash
echo "BOOT $*" > "$(dirname "$0")/../boot.args"; echo "PUBLIC_IP=1.2.3.4" > "$(dirname "$0")/../.env"
S
cat > "$T/pkg/tikootak/scripts/restore.sh" <<'S'
#!/usr/bin/env bash
echo "RESTORE $*" > "$(dirname "$0")/../restore.args"
S
echo '#!/usr/bin/env bash' > "$T/pkg/tikootak/scripts/doctor.sh"
chmod +x "$T/pkg/tikootak/scripts/"*.sh
(cd "$T/pkg" && tar czf "$T/tikootak-9.9.9.tar.gz" tikootak)
(cd "$T" && sha256sum tikootak-9.9.9.tar.gz > tikootak-9.9.9.tar.gz.sha256)

# 1. offline from a file, with restore
D="$T/inst1"; echo enc > "$T/b.enc"
bash get.sh --offline --file "$T/tikootak-9.9.9.tar.gz" --domain example.com --yes --restore "$T/b.enc" --dir "$D" </dev/null >"$T/o1.log" 2>&1
chk "offline: bootstrap got the domain" "grep -q -- '--domain example.com' $D/boot.args"
chk "offline: restore ran with detected IP" "grep -q -- '--ip 1.2.3.4 $T/b.enc' $D/restore.args"
chk "offline: no .update.conf written" "[ ! -f $D/.update.conf ]"

# 2. refuses to overwrite an existing install
bash get.sh --offline --file "$T/tikootak-9.9.9.tar.gz" --domain example.com --yes --dir "$D" </dev/null >"$T/o2.log" 2>&1
chk "existing install refused" "grep -q 'already holds an installation' $T/o2.log"

# 3. damaged file is caught by the checksum
cp "$T/tikootak-9.9.9.tar.gz" "$T/bad.tar.gz"; cp "$T/tikootak-9.9.9.tar.gz.sha256" "$T/bad.tar.gz.sha256"; sed -i 's/tikootak-9.9.9/bad/' "$T/bad.tar.gz.sha256"; echo x >> "$T/bad.tar.gz"
bash get.sh --offline --file "$T/bad.tar.gz" --domain example.com --yes --dir "$T/inst3" </dev/null >"$T/o3.log" 2>&1
chk "bad checksum refused" "grep -q 'Checksum mismatch' $T/o3.log && [ ! -d $T/inst3 ]"

# 4. not a TIKOOTAK archive
mkdir -p "$T/junk/a"; echo hi > "$T/junk/a/f"; (cd "$T/junk" && tar czf "$T/junk.tar.gz" a)
bash get.sh --offline --file "$T/junk.tar.gz" --domain example.com --yes --dir "$T/inst4" </dev/null >"$T/o4.log" 2>&1
chk "junk archive refused" "grep -q 'does not look like TIKOOTAK' $T/o4.log"

# 5. online via --mirror-base (local http server)
PORT=$((20000 + RANDOM % 20000))
mkdir -p "$T/www"; cp "$T"/tikootak-9.9.9.tar.gz* "$T/www/"; echo 9.9.9 > "$T/www/LATEST"
(cd "$T/www" && python3 -m http.server $PORT >/dev/null 2>&1) & SRV=$!; sleep 1
bash get.sh --online --mirror-base http://127.0.0.1:$PORT --domain example.com --yes --dir "$T/inst5" --mirror https://m.example </dev/null >"$T/o5.log" 2>&1
chk "online mirror: downloaded + extra args passed" "grep -q -- '--online' $T/inst5/boot.args && grep -q -- '--mirror https://m.example' $T/inst5/boot.args"
[ -f "$T/inst5/boot.args" ] || show "$T/o5.log"

# 6. no terminal and no domain -> clear error
bash get.sh --offline --file "$T/tikootak-9.9.9.tar.gz" --yes --dir "$T/inst6" </dev/null >"$T/o6.log" 2>&1
chk "missing domain without tty -> error" "grep -qE 'Give --domain|Domain is required' $T/o6.log"

echo "FAIL=$FAIL"; exit $FAIL
