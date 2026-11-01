#!/usr/bin/env bash
# Start Synapse + gateway + Caddy-like proxy for the e2e tests. Safe to run repeatedly.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"; E="${TESTENV:-$HOME/tikootak-testenv}"; cd "$E"
rm -rf gateway/src; cp -r "$REPO/gateway/src" gateway/src
(cd "$REPO/web-src" && [ -d node_modules ] || npm ci --no-audit --no-fund; npx vite build >/dev/null)
pgrep -f 'synapse.app.homeserver' >/dev/null || (setsid nohup ./venv/bin/python -m synapse.app.homeserver -c hs.yaml > synapse.log 2>&1 < /dev/null &)
pkill -f "node src/inde[x]" 2>/dev/null || true
(cd gateway && RATE_REGISTER_PER_HOUR=1000 RATE_LOGIN_PER_15MIN=1000 SYNAPSE_URL=http://127.0.0.1:8008 SYNAPSE_SHARED_SECRET=testsecret MATRIX_SERVER_NAME=localhost LIVEKIT_KEY=devkey LIVEKIT_SECRET=devsecretdevsecretdevsecretdevsecret LIVEKIT_PUBLIC_URL=ws://localhost:8080/livekit GATEWAY_ADMIN_KEY=adminkey USER_QUOTA_MB=${USER_QUOTA_MB:-500} DB_PATH="$E/gw.db" PORT=3000 setsid nohup node src/index.js > ../gateway.log 2>&1 < /dev/null &)
pkill -f 'tools/prox[y].mjs' 2>/dev/null || true
(setsid nohup node tools/proxy.mjs "$REPO/web/dist" > proxy.log 2>&1 < /dev/null &)
for i in $(seq 1 40); do curl -sf localhost:8008/health >/dev/null && curl -s -o /dev/null localhost:8080 && break; sleep 2; done
echo "[OK] up: http://localhost:8080 (admin key: adminkey)"
