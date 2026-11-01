#!/usr/bin/env bash
# Run every e2e script and print FAIL counts. Usage: bash tests/env/run-regression.sh [name-filter]
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"; E="${TESTENV:-$HOME/tikootak-testenv}"; cd "$E/tools"
cp "$REPO"/tests/e2e/*.mjs . 2>/dev/null
for f in "$REPO"/tests/e2e/*${1:-}*.mjs; do n="$(basename "$f")"; echo -n "$n FAIL="; timeout 200 node "$n" 2>&1 | grep -c "^FAIL"; done
