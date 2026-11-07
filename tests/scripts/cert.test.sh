#!/usr/bin/env bash
# Tests for scripts/cert.sh with REAL openssl certificates (no Docker needed).  Run: bash tests/scripts/cert.test.sh
# Covers: validation (key mismatch, wrong domain, missing file), chain warning, key permissions, mode switching,
# export-auto from a Caddy-style data dir (and idempotence), check threshold, auto-fallback when ACME is unreachable.
# NOT covered: an already-expired certificate (openssl cannot easily back-date), real Caddy loading the files.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$(mktemp -d)"; ok=0; bad=0
chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (expected '$3' got '$2')"; fi; }
mkdir -p "$S/scripts"; cp "$ROOT/scripts/cert.sh" "$S/scripts/"; cd "$S" || exit 1
D=chat.test.ir
printf 'DOMAIN=%s\nCADDYFILE=./Caddyfile\n' "$D" > .env
CS() { bash scripts/cert.sh "$@" --no-restart 2>&1 | sed 's/\x1b\[[0-9;]*m//g'; return "${PIPESTATUS[0]}"; }

openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -subj "/CN=Test CA" -days 365 2>/dev/null
mk() { # name cn san days
  openssl req -newkey rsa:2048 -nodes -keyout "$1.key" -out "$1.csr" -subj "/CN=$2" 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$3" > "$1.ext"
  openssl x509 -req -in "$1.csr" -CA ca.pem -CAkey ca.key -CAcreateserial -out "$1.pem" -days "$4" -extfile "$1.ext" 2>/dev/null
}
mk good "$D" "$D" 80; mk wrong evil.ir evil.ir 80; mk wild "*.test.ir" "*.test.ir" 80; mk shortlife "$D" "$D" 5
cat good.pem ca.pem > good-full.pem; cat wild.pem ca.pem > wild-full.pem; cat shortlife.pem ca.pem > short-full.pem
openssl genrsa -out other.key 2048 2>/dev/null
cat > acme.py <<'PYSRV'
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self): self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 18093), H).serve_forever()
PYSRV

CS install good-full.pem good.key >/dev/null; chk "1 install valid full chain" "$?" 0
chk "2 manual mode is set" "$(grep -c '^CADDYFILE=./Caddyfile.manual-cert$' .env)" 1
chk "3 key is chmod 600" "$(stat -c %a certs/key.pem)" 600
CS install good-full.pem other.key >/dev/null; chk "4 reject: key does not match" "$?" 1
CS install wrong.pem wrong.key >/dev/null; chk "5 reject: certificate does not cover the domain" "$?" 1
CS install nope.pem good.key >/dev/null; chk "6 reject: missing file" "$?" 1
CS install wild-full.pem wild.key >/dev/null; chk "7 accept: wildcard *.test.ir covers chat.test.ir" "$?" 0
CS install good-full.pem good.key >/dev/null
CS check 14 >/dev/null; chk "8 check: 80 days left > 14" "$?" 0
CS check 100 >/dev/null; chk "9 check: 80 days left < 100 fails" "$?" 1
CS install good.pem good.key 2>&1 | grep -q 'only 1 certificate'; chk "10 warns when the chain is missing" "$?" 0
CS install short-full.pem shortlife.key 2>&1 | grep -q 'expires in'; chk "11 warns when it expires soon" "$?" 0

# export-auto from a Caddy-style data dir
rm -rf certs; A="data/caddy/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$D"; mkdir -p "$A"
cp good-full.pem "$A/$D.crt"; cp good.key "$A/$D.key"
CS export-auto >/dev/null; chk "12 export-auto copies the live certificate" "$([ -f certs/cert.pem ] && [ -f certs/key.pem ] && echo yes || echo no)" yes
CS export-auto | grep -q 'already the freshest'; chk "13 second export is a no-op" "$?" 0
chk "14 exported key is chmod 600" "$(stat -c %a certs/key.pem)" 600
CS export-auto --quiet >/dev/null; chk "15 --quiet never fails" "$?" 0

# mode switching + auto-fallback
CS use-auto >/dev/null; chk "16 use-auto" "$(grep -c '^CADDYFILE=./Caddyfile$' .env)" 1
python3 -I acme.py & SRV=$!; sleep 1
ACME_URL=http://127.0.0.1:18093/ CS auto-fallback >/dev/null; chk "17 ACME reachable -> stays automatic" "$(grep -c '^CADDYFILE=./Caddyfile$' .env)" 1
kill "$SRV" 2>/dev/null; sleep 0.5
ACME_URL=http://127.0.0.1:18093/ CS auto-fallback >/dev/null; chk "18 ACME unreachable -> switches to the saved certificate" "$(grep -c '^CADDYFILE=./Caddyfile.manual-cert$' .env)" 1
rm -rf certs; CS use-auto >/dev/null
ACME_URL=http://127.0.0.1:18093/ CS auto-fallback >/dev/null; chk "19 ACME unreachable but no saved cert -> stays automatic, no error" "$?" 0
chk "20 ...and still automatic" "$(grep -c '^CADDYFILE=./Caddyfile$' .env)" 1
CS use-manual >/dev/null; chk "21 use-manual refuses without certificate files" "$?" 1

cd /; rm -rf "$S"; echo "ok=$ok bad=$bad"; [ "$bad" = 0 ]
