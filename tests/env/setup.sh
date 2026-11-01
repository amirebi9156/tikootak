#!/usr/bin/env bash
# Build the local end-to-end test environment (cloud sandbox or any Linux box without Docker).
# Usage: bash tests/env/setup.sh   (default dir: $HOME/tikootak-testenv, override with TESTENV=...)
# Needs: python3 + venv, node 20+, a Chromium for Playwright (set CHROMIUM=/path if not /opt/pw-browsers/chromium).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"; E="${TESTENV:-$HOME/tikootak-testenv}"
mkdir -p "$E/tools" "$E/gateway" "$E/media_store"; cd "$E"
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install -q matrix-synapse
cat > hs.yaml <<YAML
server_name: "localhost"
pid_file: $E/homeserver.pid
listeners:
  - {port: 8008, bind_addresses: ['127.0.0.1'], type: http, tls: false, x_forwarded: true, resources: [{names: [client, federation], compress: false}]}
database: {name: sqlite3, args: {database: $E/homeserver.db}}
log_config: "$E/localhost.log.config"
media_store_path: $E/media_store
registration_shared_secret: "testsecret"
macaroon_secret_key: "test-macaroon-secret-not-for-production"
form_secret: "test-form-secret-not-for-production"
signing_key_path: "$E/localhost.signing.key"
report_stats: false
enable_registration: false
trusted_key_servers: []
suppress_key_server_warning: true
rc_message: {per_second: 50, burst_count: 200}
rc_login: {address: {per_second: 50, burst_count: 200}, account: {per_second: 50, burst_count: 200}, failed_attempts: {per_second: 50, burst_count: 200}}
rc_joins: {local: {per_second: 50, burst_count: 200}}
rc_invites: {per_room: {per_second: 50, burst_count: 200}, per_user: {per_second: 50, burst_count: 200}}
rc_registration: {per_second: 50, burst_count: 200}
rc_admin_redaction: {per_second: 50, burst_count: 200}
YAML
[ -f localhost.log.config ] || printf 'version: 1\nformatters:\n  f: {format: "%%(asctime)s %%(levelname)s %%(message)s"}\nhandlers:\n  c: {class: logging.StreamHandler, formatter: f}\nroot: {level: WARNING, handlers: [c]}\ndisable_existing_loggers: false\n' > localhost.log.config
[ -f localhost.signing.key ] || ./venv/bin/python -m synapse.app.homeserver -c hs.yaml --generate-keys
cp "$REPO/tests/env/proxy.mjs" "$REPO/tests/env/package.json" tools/
(cd tools && npm install --no-audit --no-fund)
cp -r "$REPO/gateway/package.json" "$REPO/gateway/package-lock.json" gateway/ 2>/dev/null || cp "$REPO/gateway/package.json" gateway/
(cd gateway && npm install --omit=dev --no-audit --no-fund)
echo "[OK] test env at $E  -> next: bash tests/env/start.sh"
