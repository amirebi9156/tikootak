#!/usr/bin/env bash
# Simple monitor: runs doctor and notifies only when the state changes (broken/recovered). Also checks disk and certificate.
# Notifications (set any of these in .env):
#   ALERT_WEBHOOK_URL=...                        (POST plain text; e.g. ntfy)
#   ALERT_BOT_TOKEN=... ALERT_CHAT_ID=...        (Telegram or Bale bot)
#   ALERT_API_BASE=https://tapi.bale.ai          (for Bale; default is Telegram https://api.telegram.org)
# Install the schedule (every 5 minutes): sudo ./scripts/install-monitor.sh
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env 2>/dev/null; set +a
STATE=".monitor.state"
OUT="$(./scripts/doctor.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
PROBLEMS="$(echo "$OUT" | grep -E '^\[FAIL\]' || true)"
DISK="$(df -P . | awk 'NR==2{gsub("%","",$5); print $5}')"
[ "${DISK:-0}" -ge 88 ] && PROBLEMS="${PROBLEMS}"$'\n'"[FAIL] Disk is ${DISK}% full"
SIG="$(echo "$PROBLEMS" | sed '/^$/d' | md5sum | cut -d' ' -f1)"
PREV="$(cat "$STATE" 2>/dev/null || echo ok)"
[ -z "$(echo "$PROBLEMS" | sed '/^$/d')" ] && SIG=ok
[ "$SIG" = "$PREV" ] && exit 0
echo "$SIG" > "$STATE"
if [ "$SIG" = ok ]; then MSG="TIKOOTAK ($(hostname)) is healthy again."
else MSG="TIKOOTAK ($(hostname)) has problems:"$'\n'"$PROBLEMS"; fi
echo "$MSG"
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then curl -fsS -m 15 -d "$MSG" "$ALERT_WEBHOOK_URL" >/dev/null || true; fi
if [ -n "${ALERT_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
  curl -fsS -m 15 "${ALERT_API_BASE:-https://api.telegram.org}/bot${ALERT_BOT_TOKEN}/sendMessage" --data-urlencode "chat_id=${ALERT_CHAT_ID}" --data-urlencode "text=${MSG}" >/dev/null || true
fi
