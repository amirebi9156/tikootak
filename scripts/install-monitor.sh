#!/usr/bin/env bash
# Schedules monitor.sh every 5 minutes and a nightly backup (system cron). Usage: sudo ./scripts/install-monitor.sh
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
D="$PWD"
cat > /etc/cron.d/tikootak <<C
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root $D/scripts/monitor.sh >/dev/null 2>&1
30 3 * * * root $D/scripts/backup.sh >> $D/backups/cron.log 2>&1
30 5 * * 0 root $D/scripts/verify-backup.sh >> $D/backups/cron.log 2>&1
C
chmod 644 /etc/cron.d/tikootak
echo "Installed: monitor every 5 minutes, encrypted backup nightly at 03:30, restore test every Sunday at 05:30. Check: cat /etc/cron.d/tikootak"
