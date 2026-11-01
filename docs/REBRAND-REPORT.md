# گزارش تغییر نام برند به TIKOOTAK (UI32)

## ۱) خلاصه
- نام نمایشی همه‌جا **TIKOOTAK** و شناسه‌ها/نام فایل‌ها/کلیدها/کانتینر **tikootak** شد؛ دامنه و `DOMAIN` دست نخورد.
- اسناد، اسکریپت‌ها، پنل ادمین، لوگو/wordmark (از قبل TIKOOTAK بود)، عنوان تب و manifest به‌روز شدند.
- سازگاری عقب‌رو برای کلیدهای localStorage، رویدادهای Matrix، back‌آپ‌های `hamdam-*` و استور رمزنگاری قدیمی حفظ شد.
- `web/dist` بازسازی شد و `TIKOTAK` (حروف بزرگ) در آن **صفر** است؛ فقط نام‌های قدیمیِ لازم برای خواندن داده‌های موجود باقی مانده‌اند.
- پوشهٔ قدیمی `web/` (به‌جز `web/dist`) کد مرده است؛ حذف نشد و پیشنهاد حذف داده می‌شود.

## ۲) جدول تغییر نام
| دسته | چه عوض شد | تعداد فایل |
|---|---|---|
| متن رابط | عنوان/description، manifest، Logo/wordmark، Settings/About، Recovery، Onboarding، Shell، en.js | ۱۰ |
| لوگو | wordmark از قبل TIKOOTAK و بررسی شد؛ mark بدون متن؛ iconها فقط نماد بودند و بازسازی نشدند | ۰ تغییر محتوا |
| شناسه‌های فنی | compose `name: tikootak`/image، packageها، سرویس/لاگ/cron/fail2ban/sshd/turn-guard، backup filename، sw cache | ۴۸ |
| اسکریپت‌ها | backup/restore/verify/migrate/doctor/security/admin/bootstrap/harden/install-monitor/monitor/make-icons | ۱۲ |
| مستندات | README، ROADMAP، RUNBOOK، ARVAN، AUDIT، TESTING، DEEPSEEK-PROMPT | ۶ |
| کلیدهای ذخیره | `tikotak.*`/`hamdam.*` → `tikootak.*` با helper مهاجرت (`storage.js`)؛ session، theme، lang، onboarded، draft، feedmode، crypto-store flag | ۷ مصرف‌کننده |
| رویدادهای Matrix | `ir.tikotak.*`/`ir.hamdam.call` → نوشتن `ir.tikootak.*`، خواندن هر دو | ۶ ماژول |
| بکاپ | نام جدید `tikootak-*` + پذیرش `hamdam-*` در فهرست/بازیابی/verify | ۶ اسکریپت |

## ۳) موارد عمداً با نام قدیمی
- `web/` قدیمی (src/public/package/index/vite): کد مردهٔ فاز ۱؛ چیزی در compose/Caddy/اسکریپت‌ها به آن وابسته نیست. فقط `web/dist` سرو می‌شود و بازسازی شد. پیشنهاد: حذف کل `web/` به‌جز `web/dist`.
- `docs/DEEPSEEK-REBRAND-PROMPT.md`: متن تاریخی همین درخواست؛ دست‌نخورده ماند.
- `web-src/src/eventTypes.js` و `Poll.jsx`: کلیدهای قدیمی `ir.tikotak.*`/`ir.hamdam.call` برای خواندن پیام‌های موجود.
- `web-src/src/storage.js`: کلیدهای قدیمی `tikotak.*`/`hamdam.*` برای مهاجرت بدون logout.
- `useMatrix.js`: پیشوند استور IndexedDB قدیمی (`hamdam-`) برای دستگاه‌های موجود؛ دستگاه تازه `tikootak-` می‌گیرد.
- `gateway/src/policy.js`: پسوردهای ضعیف قدیمی (`tikotak123`, `hamdam1234`) هنوز رد می‌شوند.
- `scripts/*`: الگوهای `backups/hamdam-*` برای سازگاری بکاپ قدیمی.
- README: عبارت «نام‌های قبلی: TIKOTAK، همدم» عمدی است.

## ۴) نتیجه تست‌ها
| تست | نتیجه | شواهد |
|---|---|---|
| `npx vite build` | ✔ | 431 modules، بدون خطا |
| `grep TIKOTAK web/dist` | ✔ ۰ | `TIKOTAK` صفر؛ `tikotak` ۱۱ و `hamdam` ۵ فقط compatibility |
| localStorage migration | ✔ | theme/lang/onboarded/draft/feedmode/session کپی شد؛ shell بعد از reload باز ماند |
| رویداد قدیمی | ✔ | poll قدیمی رندر شد؛ share قدیمی با عنوان و «در دسترس نیست» رندر شد |
| رویداد جدید | ✔ | نظرسنجی UI با `ir.tikootak.poll` ذخیره شد |
| عنوان/wordmark/manifest | ✔ | `<title>TIKOOTAK`، alt/wordmark، manifest name/short TIKOOTAK |
| `doctor.sh` | ✔ | همه ✔ (بعد از اصلاح چک بکاپ `.enc`) |
| `security-test.sh` | ✔ 44 PASS / 3 WARN / 2 FAIL | ۲ FAIL فقط گواهی self-signed localhost؛ WARNها ADMIN_ALLOW_IPS/SSH/گواهی |
| `security-test.sh --app` | ✔ 48 PASS / 3 WARN / 2 FAIL | sec01=9، sec03=27، sec04=4، sec05=4 پاس |
| `docker compose config -q` | ✔ | EXIT=0 |
| Caddy validate | ✔ | `Valid configuration` (warn formatting) |
| `bash -n scripts/*.sh` | ✔ | همه OK |
| `node --check gateway/src/*.js` | ✔ | همه OK |
| `shellcheck -x scripts/*.sh` | ✔ 0 error/warning | 47 info (SC1091/SC2012/SC2015) |
| backup | ✔ | `tikootak-20261025-155739.tar.gz.enc` (329M، 15 کاربر) |
| verify backup | ✔ | Postgres واقعاً لود شد؛ 15 حساب |
| restore dry-run جدید | ✔ | «بکاپ سالم است» بعد از رفع باگ |
| restore/verify با نام قدیمی | ✔ | همان بکاپ با نام `hamdam-compat-test` پذیرفته شد |
| بکاپ قدیمی ۳۶KB موجود | ✘ | فایل قدیمی ناقص است (manifest/users ندارد)؛ باگ اسکریپت نیست |
| admin CLI | ✔ | `signup status/close/open` و `overview` اجرا شد |
| install.sh کامل | تأیید نشد | برای جلوگیری از بازسازی/قطع سرویس موجود اجرا نشد |
| تست ادمین خودکار | تأیید نشد | فایل تست جدید نوشته نشد |
| purge/ban واقعی | تأیید نشد | مخرب؛ روی داده واقعی اجرا نشد |
| PWA install واقعی | تأیید نشد | manifest معتبر است؛ نصب روی دستگاه تست نشد |

## ۵) باگ‌ها
**رفع‌شده:**
1. `restore.sh` کلید `BACKUP_PASSPHRASE` را از `.env` نمی‌خواند؛ dry-run غیرتعاملی شکست می‌خورد. حالا در صورت نبود env از `.env` می‌خواند.
2. `lib.sh` فقط ۲MB اول دامپ را برای جدول `users` می‌گشت و با `grep -q`+`pipefail` سیگنال SIGPIPE می‌داد؛ dry-run بکاپ سالم را رد می‌کرد. کل دامپ و بدون `-q` چک می‌شود.
3. `doctor.sh` فقط `*.tar.gz` را می‌دید و بکاپ‌های `.enc` را قدیمی نشان می‌داد؛ الگو اصلاح شد.
4. `security-test.sh --app` با `docker compose cp` روی rootfs read-only شکست می‌خورد؛ تست‌ها به `/tmp` (tmpfs) استریم می‌شوند.
5. `.env` زنده مجوز 644 داشت؛ به 600 تغییر کرد (خارج از tar).

**رفع‌نشده/خارج از محدوده:** بکاپ قدیمی ۳۶KB موجود ناقص است؛ `web/` قدیمی؛ هشدار SSH با رمز و ADMIN_ALLOW_IPS روی محیط local.

## ۶) فایل‌های تغییرکرده (خلاصه)
`README.md`، `docker-compose.yml`، `.env.example` (فقط متن/شناسه)، `gateway/src/{index,policy}.js`، `gateway/package*.json`، `web-src/src/{Shell,Chat,Feed,Onboarding,Poll,Recovery,Settings,share,forward,roomtype,session,i18n,ui,useMatrix,en}.{jsx,js}` + `eventTypes.js`/`storage.js` جدید، `web-src/index.html`، `public/{manifest.webmanifest,sw.js,admin.html}`، `scripts/*`، `docs/*`، `web/package*.json`، `web/public/sw.js`.
`web/dist` بازسازی شد. `web/` قدیمی (src/public/index/vite) دست‌نخورده و پیشنهاد حذف دارد.

## ۷) ریسک‌ها / فقط روی سرور واقعی
- گواهی self-signed در localhost طبیعی است؛ روی `tikootak.ir` باید DNS/ACME بررسی شود.
- ADMIN_ALLOW_IPS خالی و SSH با رمز در محیط local باز است؛ روی سرور واقعی طبق RUNBOOK سخت شود.
- `web/` قدیمی اگر اشتباهاً سرو شود، برند قدیمی دارد؛ Caddy فقط `web/dist` را سرو می‌کند.
- تست ادمین خودکار، purge/ban واقعی، نصب کامل و PWA فیزیکی انجام نشد.
- بکاپ‌های قدیمی ناقص باید با verify بررسی شوند؛ نام قدیمی پشتیبانی می‌شود.

## ۸) خروجی
`tikootak-UI32.tar.gz` با ریشهٔ `tikootak/`، بدون `node_modules`/`data`/`backups`/`.env`/`*.db`/`gateway/bin`؛ `web/dist` و فونت/برند داخلش است. `sha256sum` در کنار فایل گزارش می‌شود.
