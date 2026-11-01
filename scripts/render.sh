#!/usr/bin/env bash
# Render config files from templates using values in .env.   Usage: ./scripts/render.sh
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] || { echo "[FAIL] .env not found"; exit 1; }
set -a; . ./.env; set +a
mkdir -p config data/synapse
render() {
  sed \
    -e "s|\${DOMAIN}|${DOMAIN}|g" \
    -e "s|\${PUBLIC_IP}|${PUBLIC_IP}|g" \
    -e "s|\${POSTGRES_PASSWORD}|${POSTGRES_PASSWORD}|g" \
    -e "s|\${SYNAPSE_SHARED_SECRET}|${SYNAPSE_SHARED_SECRET}|g" \
    -e "s|\${SYNAPSE_MACAROON_SECRET}|${SYNAPSE_MACAROON_SECRET}|g" \
    -e "s|\${SYNAPSE_FORM_SECRET}|${SYNAPSE_FORM_SECRET}|g" \
    -e "s|\${LIVEKIT_KEY}|${LIVEKIT_KEY}|g" \
    -e "s|\${LIVEKIT_SECRET}|${LIVEKIT_SECRET}|g" \
    "$1" > "$2"
}
render templates/livekit.yaml.tpl config/livekit.yaml
[ -f "data/synapse/${DOMAIN}.signing.key" ] && render templates/homeserver.yaml.tpl data/synapse/homeserver.yaml && chown -R 991:991 data/synapse 2>/dev/null
echo "[OK] config rendered (domain=${DOMAIN} public_ip=${PUBLIC_IP})"
