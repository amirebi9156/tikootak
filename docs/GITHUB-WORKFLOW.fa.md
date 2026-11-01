# کار با GitHub (بدون فرستادن فایل tar)

۱. یک مخزن **خصوصی** بساز: GitHub → New repository → نام `tikootak` → Private. (مخزن‌های دیگرت عمومی‌اند؛ این یکی نباید عمومی باشد.)
۲. به Claude بگو: «مخزن tikootak ساخته شد، با دسترسی push وصلش کن». کد را او push می‌کند.
۳. روی هر تغییر: Claude روی یک branch کار می‌کند → Pull Request → CI رابط را می‌سازد → تو merge می‌کنی.
۴. انتشار: `git tag v0.42.0 && git push --tags` (یا از صفحهٔ Releases) → GitHub Actions فایل `tikootak-0.42.0.tar.gz` را می‌سازد.
۵. روی سرور، یک‌بار: `cp .update.conf.example .update.conf` و `REPO=نام‌کاربری/tikootak` (و `TOKEN` اگر خصوصی است) را بنویس.
۶. هر آپدیت: `./scripts/update.sh` (یا `./scripts/update.sh 0.42.0`). پشتیبان می‌گیرد، نسخه را عوض می‌کند، doctor را اجرا می‌کند.
۷. اگر GitHub روی سرور فیلتر بود: فایل Release را روی کامپیوتر دانلود کن و `./scripts/update.sh --file tikootak-X.tar.gz`، یا `MIRROR_BASE` را روی یک آدرس دلخواه بگذار.
۸. اگر نسخه خراب بود: `./scripts/restore.sh backups/<آخرین فایل>`.
