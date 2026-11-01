# پرامپت: تغییر نام برند به tikootak + تکمیل کارهای باقی‌مانده + گزارش نهایی

> کل این متن را برای DeepSeek بفرست (کنارش فایل `tikotak-UI31.tar.gz` را هم بده یا پوشهٔ پروژه را در دسترسش بگذار).

---

تو توسعه‌دهندهٔ ارشد/DevOps پروژهٔ **TIKOTAK** هستی. فارسی، کوتاه و دقیق جواب بده. دامنهٔ نهایی پروژه **`tikootak.ir`** است (دو تا «o»: tik-oo-tak). بنابراین نام برند باید همه‌جا **TIKOOTAK** (نمایشی، حروف بزرگ) / **tikootak** (شناسه‌ها، نام فایل، کلیدها، نام کانتینر) شود. نام فارسی نمایشی در صورت نیاز: «تیکوتاک».

قبل از هر کاری فایل‌های `docs/ROADMAP-BACKEND.md`، `docs/RUNBOOK.md`، `docs/MIGRATION.md`، `docs/ARVAN-GUIDE.md`، `docs/DEEPSEEK-PROMPT.md` (قوانین کار آن‌جا هم برای تو معتبر است) را بخوان.

## قوانین (سخت‌گیرانه)
1. چیزی را «انجام‌شده» نگو مگر اجرا و خروجی‌اش را دیده باشی. تأییدنشده را صریح بنویس «تأیید نشد».
2. تنظیمات امنیتی را ضعیف نکن (CSP/هدرها، کاربر غیر-root، read-only، ufw، rate-limit، IP allow-list ادمین).
3. هیچ رمز/کلیدی را در گزارش یا لاگ ننویس. `.env` را داخل tar نگذار.
4. تغییر **نباید هیچ چیزی را بشکند**: بعد از هر دستهٔ تغییر، تست‌های مربوط را اجرا کن (بخش ۴).
5. فقط تغییرات لازم؛ بازنویسی/refactor بزرگ ممنوع. متن‌های رابط: `tr("فارسی")` + ورودی `web-src/src/en.js`.
6. دامنه/`DOMAIN` در `.env` و هویت Matrix دست نمی‌خورد (فقط مقدار نمونهٔ `.env.example` و مستندات).

## ۱) تغییر نام (rebrand) — فهرست کامل
ابتدا یک جستجوی کامل بزن و فهرست نتایج را نگه دار:
`grep -rIni --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=data -e tikotak -e hamdam -e همدم .`
(وضع فعلی: حدود ۲۳ فایل با «TIKOTAK»، ۲۲ فایل با «tikotak»، ۲۸ فایل با «hamdam»، ۷ فایل با «همدم»).

**الف) متن‌های نمایشی رابط** (`web-src/index.html` عنوان و description، `web-src/public/manifest.webmanifest` name/short_name، `Shell.jsx` (≈خط ۸۳۹)، `ui.jsx` (`Logo` و alt در `LogoWordmark`)، `Settings.jsx` «درباره»، `Recovery.jsx` (متن فایل کلید بازیابی)، `Onboarding.jsx`، `Chat.jsx`، `Feed.jsx`، و `en.js`): TIKOTAK → TIKOOTAK. در `en.js` هم کلید فارسی و هم مقدار انگلیسی را با هم عوض کن (کلید باید دقیقاً همان رشتهٔ `tr()` باشد وگرنه ترجمه می‌شکند). نام فایل دانلودی کلید بازیابی: `tikotak-recovery-key.txt` → `tikootak-recovery-key.txt`.
**ب) لوگو**: `web-src/public/brand/logo-wordmark.png` از قبل با متن TIKOOTAK ساخته شده؛ **با چشم یا اسکرین‌شات بررسی کن** که درست و خوانا است و در `LogoWordmark` (صفحهٔ ورود، تنظیمات) خوب دیده می‌شود (عرض/ارتفاع). `logo-mark.svg/png` (نماد) بدون متن است و عوض نمی‌شود. `icon.svg`/`favicon.svg`/آیکن‌های PNG را اگر حاوی متن «TIKOTAK» هستند بازسازی کن (`scripts/make-icons.mjs`)؛ اگر فقط نماد دارند دست نزن. در انتها فایل `web/dist` را دوباره بساز و ثابت کن که داخلش «TIKOTAK/tikotak» نیست.
**ج) شناسه‌های فنی** (همه را `tikootak` کن):
- `docker-compose.yml`: بالای فایل `name: tikootak` اضافه کن (نام پروژهٔ compose مستقل از نام پوشه شود)؛ `image: ${GATEWAY_IMAGE:-tikotak-gateway:local}` → `tikootak-gateway:local`.
- `package.json`/`package-lock.json` (gateway، web-src و پوشهٔ قدیمی `web/`): فیلد `name` از `hamdam-*` به `tikootak-*` (lockها را با `npm install --package-lock-only` یا ویرایش دقیق نام، هماهنگ کن؛ `npm ci` باید همچنان کار کند).
- اسکریپت‌ها: لاگ `/var/log/tikotak-bootstrap.log`، کانتینر `tikotak-verify-pg`، `/etc/cron.d/tikotak`، `/etc/fail2ban/jail.d/tikotak.local`، `/etc/ssh/sshd_config.d/99-tikotak.conf`، `tikotak-turn-guard*`، پوشهٔ موقت `tikotak-icons-`، متن پیام‌ها و کامنت‌ها.
- **نام فایل بکاپ**: `backups/hamdam-*.tar.gz*` → `backups/tikootak-*.tar.gz*` در `backup.sh`, `restore.sh`, `verify-backup.sh`, `migrate.sh`, `doctor.sh`, `security-test.sh`, مستندات. **سازگاری عقب‌رو**: هر جا بکاپ‌ها را فهرست می‌کنی هر دو الگوی `hamdam-*` و `tikootak-*` را بپذیر (بکاپ‌های قدیمی باید هنوز قابل بازیابی باشند).
- `web-src/public/sw.js` و `web/public/sw.js`: `CACHE = 'hamdam-shell-v1'` → `tikootak-shell-v1` (و نسخه را بالا ببر تا کش قدیمی پاک شود؛ در `activate` کش‌های با پیشوند قدیمی را حذف کن).
- **کلیدهای localStorage** (`tikotak.theme`, `tikotak.lang`, `tikotak.onboarded`, `tikotak.draft.*`, `tikotak-v…` در `session.js`): به `tikootak.*` تغییر بده، **ولی** هنگام اولین خواندن، اگر کلید جدید نبود و کلید قدیمی بود، مقدار را کپی/مهاجرت کن (تا هیچ‌کس logout نشود و تنظیمات نپرد). یک تابع کمکی کوچک در `web-src/src/` بساز.
- **نوع رویدادهای Matrix** `ir.tikotak.poll` و `ir.tikotak.share` (در `Chat.jsx`, `Poll.jsx`, `share.js`, `forward.js`, `roomtype.js`…): نوشتن با `ir.tikootak.*`، **ولی خواندن هر دو** (قدیمی و جدید)، چون پیام‌های قدیمی در اتاق‌ها باقی می‌مانند. هر جا نوع اتاق (`roomtype.js`) با نام قدیمی ذخیره شده همین سازگاری را داشته باش.
- `gateway/src/index.js` و `policy.js` و هر جای دیگر gateway که نام برند در پیام/هدر/لاگ دارد.
**د) پوشه‌ها و مستندات**: نام پوشهٔ ریشهٔ پروژه در tar خروجی `tikootak/` باشد (نه `hamdam/`). در همهٔ مستندات و اسکریپت‌ها `cd hamdam` / `hamdam/` / `tikotak-UI…` را اصلاح کن. `README.md` تیتر: «TIKOOTAK (نام‌های قبلی: TIKOTAK، همدم)». `docs/DEEPSEEK-PROMPT.md`، `ARVAN-GUIDE.md`، `MIGRATION.md`، `RUNBOOK.md`، `ROADMAP-BACKEND.md`، `AUDIT-REPORT.md`، `TESTING.md` را هم به‌روز کن (مثلاً `scp tikootak-UI32.tar.gz`).
**هـ) پوشهٔ قدیمی `web/`** (به‌جز `web/dist`): شامل `web/src`, `web/public`, `web/package*.json`, `web/index.html`, `web/vite.config.js` با نام «همدم» است و ظاهراً کد مرده فاز ۱ است. ثابت کن (با grep روی compose/اسکریپت‌ها/Caddy) که چیزی به آن‌ها وابسته نیست، سپس **به جای حذف مستقیم** آن‌ها را به `legacy/` منتقل نکن؛ فقط به من گزارش بده و پیشنهاد حذف بده (`web/dist` باید بماند چون Caddy از آن سرو می‌کند).
**و) اثبات پایان کار**: دوباره همان grep را اجرا کن. فقط مواردی باید باقی بمانند که **عمداً** هستند (کد سازگاری با نام قدیمی، یادداشت «نام قبلی»، الگوی بکاپ قدیمی). هر مورد باقی‌مانده را در گزارش با دلیل فهرست کن. روی `web/dist` هم grep بزن (باید صفر باشد جز سازگاری عمدی).

## ۲) کارهای باقی‌مانده (در صورت امکان انجام بده و هرکدام را با تست ثابت کن)
1. `docs/sec0x.mjs` و `docs/geo.*` تکراری‌اند؛ نسخهٔ اصلی در `tests/security/` است. تکرارها را حذف و ارجاع‌ها را اصلاح کن.
2. برای قابلیت‌های جدید ادمین **تست خودکار در مخزن** بنویس (`tests/admin/…`، با `BASE` و `ADMIN` از env مثل `tests/security`): قفل ثبت‌نام (دستی/سقف روزانه)، کد دعوت شخصی کاربر (محدودیت ۲۴ ساعت و سهمیه)، درخت دعوت، `purge` با cascade، ban با بستن حساب Matrix، لیست محتوا. مرجع منطق تست‌ها: رفتار `gateway/src/adminx.js`, `settings.js`, `userinvites.js`, `synapse-admin.js`.
3. `scripts/admin.sh`: دستورهای جدید `signup open|close|status`, `purge`, `overview` را اجرا و تست کن (تا حالا فقط syntax چک شده).
4. بررسی ثابت‌ها که قبلاً تأیید نشده‌اند: `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" caddy:2 caddy validate --config /etc/caddy/Caddyfile` (با `SITE_ADDRESS` تنظیم‌شده)، و `docker compose up` واقعی با gateway در حالت `read_only` (ثابت کن آپلود/ترنسکود/تامبنیل/ذخیرهٔ `/tmp` کار می‌کند).
5. `shellcheck` روی همهٔ `scripts/*.sh` (اگر نصب نیست نصب کن) و رفع هشدارهای واقعی.
6. `bash -n` همهٔ اسکریپت‌ها، `docker compose config -q`، `node --check` همهٔ `gateway/src/*.js`.
7. هر باگ دیگری که حین کار دیدی را فهرست کن (رفع فقط اگر کوچک و بی‌خطر است؛ وگرنه فقط گزارش).

## ۳) آنچه نباید بکنی
- سرور/دامنه/آروان را دست نزن (این مرحله فقط روی ماشین محلی/WSL است).
- نام `DOMAIN` در نمونهٔ `.env.example` را از `chat.example.ir` به `tikootak.ir` نکن؛ مقدار نمونه همان بماند (فقط در مستندات `tikootak.ir` را مثال بزن).
- پکیج‌های جدید npm اضافه نکن مگر ضروری باشد (و بگو چرا).

## ۴) تست و اعتبارسنجی (همه را اجرا کن و خروجی خلاصه را در گزارش بیاور)
1. `./scripts/build-web.sh` (یا `cd web-src && npx vite build`) بدون خطا؛ `web/dist` شامل نام جدید.
2. نصب محلی کامل در WSL/Docker با `DOMAIN=localhost`: `cp .env.example .env` (DOMAIN=localhost، PUBLIC_IP=127.0.0.1)، `./scripts/install.sh`، `./scripts/doctor.sh` (همه ✔).
3. `./scripts/security-test.sh` و `./scripts/security-test.sh --app` (برای localhost گواهی self-signed است؛ هشدار گواهی عادی است؛ باقی FAIL=0).
4. تست دستی/خودکار رابط (Playwright یا دستی): ورود/ثبت‌نام، لوگو در صفحهٔ ورود و تنظیمات، عنوان تب مرورگر، نصب PWA (manifest)، ارسال نظرسنجی و اشتراک آهنگ (رویدادهای `ir.tikootak.*`)، باز شدن نظرسنجی/اشتراک **قدیمی** (`ir.tikotak.*`)، تم/زبان/پیش‌نویس پس از مهاجرت کلیدها، رفرش بدون logout.
5. بکاپ و بازیابی: `./scripts/backup.sh` ← فایل `tikootak-*.tar.gz.enc` ساخته شود؛ `./scripts/verify-backup.sh`؛ `./scripts/restore.sh --dry-run <فایل>`؛ و یک بکاپ قدیمی با نام `hamdam-*` هم باید توسط `restore.sh --dry-run` و `verify-backup.sh` پذیرفته شود.
6. پنل `/admin.html`: ورود، همهٔ تب‌ها بدون خطای console، قفل ثبت‌نام، ساخت کد، مرور پست‌ها، «بن کامل» روی یک کاربر تستی.

## ۵) خروجی نهایی (گزارش)
در پایان، **یک گزارش به فارسی** بنویس (فایل `docs/REBRAND-REPORT.md` و همان را در چت) با این بخش‌ها:
1. **خلاصه** (۵ خط).
2. **جدول تغییر نام**: دسته (متن رابط / لوگو / شناسهٔ فنی / اسکریپت / مستندات / کلیدهای ذخیره / رویدادهای Matrix)، چه عوض شد، چند فایل.
3. **مواردی که عمداً با نام قدیمی ماندند** و دلیل.
4. **نتیجهٔ هر تست** در بخش ۴ و ۲ (✔/✘/تأییدنشده + یک خط شواهد: دستور و خروجی خلاصه).
5. **باگ‌های پیداشده و رفع‌شده** + **باگ‌های پیداشده و رفع‌نشده**.
6. **فهرست فایل‌های تغییرکرده** (خلاصه) و پیشنهاد حذف `web/` قدیمی.
7. **ریسک‌ها/چیزهایی که فقط روی سرور واقعی قابل تأیید است**.
8. فایل خروجی: `tikootak-UI32.tar.gz` (پوشهٔ ریشه `tikootak/`؛ بدون `node_modules`، `data`، `backups`، `.env`، `*.db`) + `sha256sum` آن.

**شروع:** اول فقط grep فهرست کامل را بزن و همراه برنامهٔ کوتاهت (حداکثر ۱۵ خط) نشان بده، منتظر تأیید من نمان؛ سپس مرحله‌به‌مرحله اجرا کن و در پایان گزارش بده.
