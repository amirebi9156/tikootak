#!/usr/bin/env bash
# تست update/downgrade/rollback ابزار tikootak.sh با docker جعلی (بدون Docker واقعی).  اجرا: bash tests/scripts/tikootak-update.test.sh
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S="$(mktemp -d)"; ok=0; bad=0
chk() { if [ "$2" = "$3" ]; then ok=$((ok+1)); echo "PASS $1"; else bad=$((bad+1)); echo "FAIL $1 (انتظار «$3» ولی «$2»)"; fi; }
mkdir -p "$S/bin" "$S/app/scripts" "$S/app/gateway" "$S/app/web/dist/assets" "$S/app/data" "$S/new/tikootak/"{gateway,scripts,web/dist/assets}
printf '#!/bin/bash\nexit 0\n' > "$S/bin/docker"; chmod +x "$S/bin/docker"
cp "$ROOT/scripts/tikootak.sh" "$ROOT/scripts/netlib.sh" "$S/app/scripts/"
for d in app new/tikootak; do touch "$S/$d/docker-compose.yml"; printf '#!/bin/bash\nexit 0\n' > "$S/$d/scripts/backup.sh"; printf '#!/bin/bash\n[ -f "%s/fail" ] && exit 1\nexit 0\n' "$S" > "$S/$d/scripts/doctor.sh"; done
chmod +x "$S"/app/scripts/*.sh "$S"/new/tikootak/scripts/*.sh
echo 1.0.0 > "$S/app/VERSION"; echo "DOMAIN=x.ir" > "$S/app/.env"; echo old > "$S/app/web/dist/assets/old.js"; echo keep > "$S/app/data/db"
mk() { echo "$1" > "$S/new/tikootak/VERSION"; echo "$1" > "$S/new/tikootak/web/dist/assets/new-$1.js"; (cd "$S/new" && tar czf "../$1.tgz" tikootak); }
export PATH="$S/bin:$PATH"; cd "$S/app"
mk 1.1.0; ./scripts/tikootak.sh update "$S/1.1.0.tgz" --yes >/dev/null 2>&1
chk "ارتقا نسخه" "$(cat VERSION)" 1.1.0
chk "فایل hash-دار قدیمی پاک شد" "$(ls web/dist/assets | tr '\n' ' ')" "new-1.1.0.js "
chk ".env حفظ شد" "$(cat .env)" "DOMAIN=x.ir"
chk "data حفظ شد" "$(cat data/db)" keep
mk 1.2.0; touch "$S/fail"; ./scripts/tikootak.sh update "$S/1.2.0.tgz" --yes >/dev/null 2>&1; rm "$S/fail"
chk "شکست سلامت ← برگشت خودکار کد" "$(cat VERSION)" 1.1.0
mk 1.0.5; echo n | ./scripts/tikootak.sh update "$S/1.0.5.tgz" >/dev/null 2>&1
chk "دانگرید بدون تأیید انجام نمی‌شود" "$(cat VERSION)" 1.1.0
echo y | ./scripts/tikootak.sh update "$S/1.0.5.tgz" --no-backup >/dev/null 2>&1
chk "دانگرید با تأیید" "$(cat VERSION)" 1.0.5
echo y | ./scripts/tikootak.sh rollback >/dev/null 2>&1
chk "rollback" "$(cat VERSION)" 1.1.0
echo junk > "$S/j.txt"; tar czf "$S/junk.tgz" -C "$S" j.txt; ./scripts/tikootak.sh update "$S/junk.tgz" --yes >/dev/null 2>&1
chk "آرشیو نامعتبر رد شد" "$(cat VERSION)" 1.1.0
# drop-in update: no argument -> newest tikootak*.tar.gz in ./updates is found
mkdir -p updates; mk 1.3.0; cp "$S/1.3.0.tgz" updates/tikootak-1.3.0.tar.gz
./scripts/tikootak.sh update --yes >/dev/null 2>&1
chk "auto-detect update from updates/" "$(cat VERSION)" 1.3.0
chk "applied archive moved" "$(ls updates/applied 2>/dev/null | tr '\n' ' ')" "tikootak-1.3.0.tar.gz "
rm -rf "$S"; echo "ok=$ok bad=$bad"; [ "$bad" = 0 ]
