#!/usr/bin/env bash
# Rewrites .env using the (English) .env.example layout, keeping every value you already set.
# Old file is saved as .env.bak. Usage: sudo tikootak env-refresh   (or ./scripts/refresh-env.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env here"; exit 1; }
cp -p .env .env.bak
declare -A V=()
while IFS= read -r l; do
  case "$l" in ''|'#'*) continue;; esac
  [[ "$l" == *=* ]] || continue
  V["${l%%=*}"]="${l#*=}"
done < .env.bak
declare -A USED=()
: > .env.new
while IFS= read -r l; do
  if [[ "$l" =~ ^(#\ )?([A-Z][A-Z0-9_]*)=(.*)$ ]]; then
    k="${BASH_REMATCH[2]}"
    if [[ -n "${V[$k]+x}" && -z "${USED[$k]:-}" ]]; then echo "$k=${V[$k]}" >> .env.new; USED[$k]=1; continue; fi
  fi
  echo "$l" >> .env.new
done < .env.example
extra=""
for k in "${!V[@]}"; do [ -z "${USED[$k]:-}" ] && extra+="$k=${V[$k]}"$'\n'; done
[ -n "$extra" ] && { printf '\n# ===== Other settings =====\n%s' "$extra" >> .env.new; }
mv .env.new .env; chmod 600 .env
echo "OK: .env rewritten with English comments (backup: .env.bak)"
