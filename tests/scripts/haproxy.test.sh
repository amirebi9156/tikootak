#!/usr/bin/env bash
# Tests for "TIKOOTAK behind haproxy": scripts/haproxy.sh, compose port binds, Caddyfile import, bootstrap --behind-haproxy.
# Run: bash tests/scripts/haproxy.test.sh      (root needed for the bootstrap part; CADDY_BIN=/path/caddy enables real Caddyfile validation)
# NOT covered: a real haproxy forwarding with send-proxy, a real Let's Encrypt run, real client IPs end to end.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$(mktemp -d)"; ok=0; bad=0
chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (expected '$3' got '$2')"; fi; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
hold() { python3 -I -c "
import socket,time,sys
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('0.0.0.0',int(sys.argv[1]))); s.listen(1); time.sleep(40)" "$1" & HELD=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do ss -H -ltn "sport = :$1" 2>/dev/null | grep -q . && break; sleep 0.5; done; }

# ---------- haproxy.sh ----------
mkdir -p "$S/p/scripts"; cp "$ROOT/scripts/haproxy.sh" "$S/p/scripts/"; cd "$S/p" || exit 1
printf 'DOMAIN=chat.test.ir\nSITE_ADDRESS=chat.test.ir\n' > .env
H() { bash scripts/haproxy.sh "$@" 2>&1 | strip; }
H enable --no-restart > "$S/e1.txt"
chk "1 enable writes HTTPS_BIND" "$(grep -c '^HTTPS_BIND=127.0.0.1:8443$' .env)" 1
chk "2 enable writes the PROXY protocol snippet" "$(grep -c 'proxy_protocol' config/caddy-extra/proxy-protocol.caddy)" 1
chk "3 PROXY protocol is limited to the :443 server" "$(grep -c 'servers :443' config/caddy-extra/proxy-protocol.caddy)" 1
chk "4 printed snippet names your domain + send-proxy + port" "$(grep -c -E 'req_ssl_sni -i chat.test.ir|send-proxy|127.0.0.1:8443' "$S/e1.txt")" 3
if ss -H -ltn 'sport = :80' 2>/dev/null | grep -q .; then echo "SKIP 5 (port 80 busy here)"; else
  chk "5 port 80 free -> HTTP_BIND not set" "$(grep -c '^HTTP_BIND=' .env)" 0
  hold 80; H enable --no-restart >/dev/null
  chk "6 port 80 held by another program -> HTTP_BIND=127.0.0.1:8080" "$(grep -c '^HTTP_BIND=127.0.0.1:8080$' .env)" 1
  kill "$HELD" 2>/dev/null; wait "$HELD" 2>/dev/null
fi
H enable --no-restart --https-port 9443 --http-port 9080 >/dev/null
chk "7 custom ports" "$(grep -c -E '^HTTPS_BIND=127.0.0.1:9443$|^HTTP_BIND=127.0.0.1:9080$' .env)" 2
H snippet | grep -q '127.0.0.1:9443'; chk "8 snippet follows the configured port" "$?" 0
H status | grep -q 'haproxy mode is ON'; chk "9 status says ON" "$?" 0
H disable >/dev/null
chk "10 disable removes the settings and the snippet file" "$(grep -c -E '^(HTTPS|HTTP)_BIND=' .env)$([ -f config/caddy-extra/proxy-protocol.caddy ] && echo F)" 0
bash scripts/haproxy.sh bogus >/dev/null 2>&1; chk "11 unknown command fails" "$?" 1

# ---------- compose + Caddyfile ----------
cd "$ROOT" || exit 1
chk "12 compose publishes through HTTP_BIND/HTTPS_BIND" "$(grep -c -E '\$\{HTTP_BIND:-80\}:80|\$\{HTTPS_BIND:-443\}:443' docker-compose.yml)" 2
chk "13 compose mounts config/caddy-extra" "$(grep -c 'config/caddy-extra:/etc/caddy/extra:ro' docker-compose.yml)" 1
chk "14 both Caddyfiles import the extra folder" "$(grep -c 'import /etc/caddy/extra/\*.caddy' Caddyfile Caddyfile.manual-cert | awk -F: '{s+=$2} END{print s}')" 2
CB="${CADDY_BIN:-$(command -v caddy || true)}"
if [ -z "$CB" ]; then echo "SKIP 15-17 (no caddy binary; set CADDY_BIN)"; else
  mkdir -p "$S/x/empty" "$S/x/full"; cp "$S/p/config/caddy-extra/proxy-protocol.caddy" "$S/x/full/" 2>/dev/null
  ( cd "$S/p" && bash scripts/haproxy.sh enable --no-restart >/dev/null 2>&1; cp config/caddy-extra/proxy-protocol.caddy "$S/x/full/" )
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$S/x/k.pem" -out "$S/x/c.pem" -subj "/CN=chat.test.ir" -days 3 2>/dev/null
  for v in empty full; do
    sed -e "s|/etc/caddy/extra|$S/x/$v|" -e "s|/certs/cert.pem|$S/x/c.pem|" -e "s|/certs/key.pem|$S/x/k.pem|" "$ROOT/Caddyfile" > "$S/x/$v.caddy"
    sed -e "s|/etc/caddy/extra|$S/x/$v|" -e "s|/certs/cert.pem|$S/x/c.pem|" -e "s|/certs/key.pem|$S/x/k.pem|" "$ROOT/Caddyfile.manual-cert" > "$S/x/$v.manual.caddy"
  done
  V() { SITE_ADDRESS=chat.test.ir "$CB" validate --config "$1" --adapter caddyfile 2>&1 | tail -n1; }
  chk "15 Caddyfile valid with an EMPTY extra folder (normal servers)" "$(V "$S/x/empty.caddy")" "Valid configuration"
  chk "16 Caddyfile valid with the PROXY protocol snippet" "$(V "$S/x/full.caddy")" "Valid configuration"
  chk "17 manual-cert Caddyfile valid with the snippet" "$(V "$S/x/full.manual.caddy")" "Valid configuration"
  SITE_ADDRESS=chat.test.ir "$CB" adapt --config "$S/x/full.caddy" --adapter caddyfile 2>/dev/null | grep -q '"wrapper": *"proxy_protocol"'; chk "18 the :443 server really gets the proxy_protocol wrapper" "$?" 0
fi

# ---------- bootstrap --behind-haproxy ----------
if [ "$(id -u)" != 0 ]; then echo "SKIP bootstrap runs (not root)"; else
mkdir -p "$S/bin" "$S/b/scripts"; cp "$ROOT"/scripts/*.sh "$ROOT/scripts/mirrors.list" "$S/b/scripts/"; cp "$ROOT/VERSION" "$ROOT/.env.example" "$S/b/"
for c in apt-get systemctl timedatectl; do printf '#!/bin/sh\necho "%s $@" >> "%s/calls.log"\nexit 0\n' "$c" "$S" > "$S/bin/$c"; done
cat > "$S/bin/docker" <<D
#!/bin/sh
echo "docker \$@" >> "$S/calls.log"
case "\$1 \$2" in "compose version") echo "Docker Compose version stub"; exit 0;; esac
case "\$1" in --version) echo "Docker version stub";; pull) exit 1;; ps) ;; esac
exit 0
D
printf '#!/bin/sh\nprintf 000\nexit 0\n' > "$S/bin/curl"
ln -s "$(command -v python3)" "$S/bin/haproxy"
chmod +x "$S/bin/"*
export PATH="$S/bin:$PATH"
BS() { ( cd "$S/b" && bash scripts/bootstrap.sh "$@" 2>&1 | strip ); }
# a program named haproxy holds 443
"$S/bin/haproxy" -I -c "
import socket,time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(('0.0.0.0',443)); s.listen(1); time.sleep(60)" & HP=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do ss -H -ltn 'sport = :443' 2>/dev/null | grep -q . && break; sleep 0.5; done
: > "$S/calls.log"
BS --domain x.test --ip 1.2.3.4 --yes > "$S/o1.txt"
chk "19 haproxy on 443 stops a normal install ..." "$(grep -c '443/tcp is used by haproxy' "$S/o1.txt")" 1
chk "20 ... and the message points to --behind-haproxy" "$(grep -c -- '--behind-haproxy' "$S/o1.txt")" 1
chk "21 ... before anything was changed" "$(wc -c < "$S/calls.log" | tr -d ' ')" 0
: > "$S/calls.log"
BS --domain x.test --ip 1.2.3.4 --yes --behind-haproxy > "$S/o2.txt"
chk "22 --behind-haproxy passes the port check" "$(grep -c 'Shared mode: haproxy keeps 443' "$S/o2.txt")" 1
chk "23 --behind-haproxy goes on to install (apt is called)" "$(grep -c '^apt-get' "$S/calls.log" | awk '{print ($1>0)?"yes":"no"}')" yes
kill "$HP" 2>/dev/null; wait "$HP" 2>/dev/null
fi

rm -rf "$S"; echo "ok=$ok bad=$bad"; [ "$bad" = 0 ]
