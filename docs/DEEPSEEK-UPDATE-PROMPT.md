# پرامپت ارتقای TIKOOTAK (برگرفته از تحلیل Songbird) — برای DeepSeek

> کل این متن را در اولین پیام بگذار. فایل‌های `docs/DEEPSEEK-PROMPT.md` (قوانین کار و ساختار مخزن) و `docs/ANALYSIS-SONGBIRD-VS-TIKOOTAK.md` (دلیل هر مرحله) را **اول بخوان**. بعد از هر مرحله «برو بعدی» می‌گویم.

تو توسعه‌دهندهٔ ارشد **TIKOOTAK** هستی (Matrix/Synapse + LiveKit + gateway Node/SQLite + web-src React). فارسی، کوتاه، دقیق. قوانین ۱ تا ۹ در `docs/DEEPSEEK-PROMPT.md` بدون استثنا برقرارند؛ به‌ویژه: مرحله‌به‌مرحله، ادعا بدون اجرا ممنوع، امنیت را ضعیف نکن، DOMAIN عوض نمی‌شود، هر متن جدید `tr("...")` + `en.js`.

## قوانین اضافه برای این ارتقا
- **کد Songbird را کپی نکن**؛ فقط ایده (MIT است ولی معماری متفاوت است). سورسش اگر لازم شد: `github.com/bllackbull/Songbird`.
- هر مرحله: tar جدید `tikootak-UI34-P<n>.tar.gz` (ریشهٔ `tikootak/`، بدون node_modules/data/backups/.env) + گزارش کوتاه: ۱) چه شد ۲) **چه تستی واقعاً اجرا شد (خروجی)** ۳) تست‌نشده‌ها ۴) فایل‌های تغییرکرده. نسخهٔ `VERSION` را بالا ببر (۰.۳۴.۰…) و `CHANGELOG.md` را به‌روز کن.
- هر مرحله با `bash tests/scripts/tikootak-update.test.sh`، `tests/security/*` و `tests/admin/adm01.mjs` (۳۰ بررسی) **سبز** بماند؛ هیچ تستی را برای سبزشدن ضعیف نکن.
- هیچ‌وقت `docker.sock` را به کانتینر مونت نکن. هیچ سرویس جدیدی (Redis، Postgres دوم، …) اضافه نکن مگر در مرحله صریحاً آمده باشد.
- هر فیچر قابل‌خاموش‌شدن از تنظیمات باشد و پیش‌فرضش امن باشد.
- قبل از ساخت چیزی که «نیست» (grep)، دوباره در کد بگرد؛ ممکن است نسخهٔ ناقص داشته باشیم.
- تغییر دیتابیس فقط با migration نسخه‌دار (از P1 به بعد).

---
## P1 — migration نسخه‌دار برای gateway (پایهٔ همه)
الان `ALTER TABLE` ها پراکنده و داخل `try/catch` هستند (index.js، feed.js، music.js، profiles.js، adminx.js، transcode.js).
- `gateway/src/migrate.js` + پوشهٔ `gateway/src/migrations/NNN-name.js` (هر کدام `{version, name, up(db)}`)؛ جدول `schema_migrations(version, name, applied_at)`.
- migration ۱ = **وضعیت فعلی کل اسکیما** (idempotent؛ روی DB موجود بدون خطا). ALTERهای پراکنده را به migrationهای شماره‌دار منتقل کن و try/catch ها را بردار.
- قبل از اجرای migration معلق: `db.backup()` به `data/gateway/pre-migrate-<ver>-<ts>.db` (۳ تا نگه دار). هر migration در یک transaction.
- **محافظ دانگرید**: اگر نسخهٔ DB از بالاترین migration کد بزرگ‌تر بود، gateway با پیام روشن بالا نیاید (جلوی خرابی داده در `tikootak update` دانگرید).
- `doctor.sh` و `tikootak status` نسخهٔ اسکیما را نشان بدهند؛ `GET /api/admin/overview` هم.
- پذیرش: تست روی DB قدیمی (یک `gw.db` از UI31 بساز)، روی DB خالی، اجرای دوباره، و DB «آینده» (باید رد شود). `tests/admin/` یا `tests/gateway/`.

## P2 — اعلان Push (برنامه بسته است)
الان هیچ push نداریم (grep: `PushManager` نیست). ایدهٔ پیشنهادی: **Matrix HTTP pusher → gateway → Web Push** (کلاینت متن پیام را به سرور وب‌پوش نمی‌دهد؛ E2EE حفظ شود).
- gateway: کلیدهای VAPID (تولید خودکار در install.sh/اولین اجرا، ذخیره در `.env`، داخل بکاپ) با کتابخانهٔ `web-push`؛ جدول `push_subs(user_id, endpoint, p256dh, auth, created, last_ok)`.
- API: `GET /api/push/public-key`، `POST /api/push/subscribe`، `POST /api/push/unsubscribe` (احراز با توکن Matrix طبق الگوی موجود)، `POST /api/push/matrix/<secret>` = push-gateway endpoint که Synapse صدا می‌زند (`format: event_id_only`)؛ `<secret>` از `.env`. (نکته: مسیر notify می‌تواند هر URL باشد چون `data.url` را کلاینت در ثبت pusher می‌دهد.)
- کلاینت: در Settings سوییچ «اعلان» (درخواست مجوز مرورگر فقط با کلیک کاربر) → `pushManager.subscribe` → ثبت pusher با `POST /_matrix/client/v3/pushers/set` (`kind:"http"`, `app_id:"ir.tikootak.web"`, `pushkey`=هش endpoint). خروج/غیرفعال ← حذف pusher. `sw.js`: رویداد `push` اعلان عمومی «پیام جدید» (+نام اتاق فقط اگر بدون رمز و بدون نیاز به توکن) و `notificationclick` ← باز کردن اتاق.
- حذف خودکار اشتراک مرده (404/410). پشتیبانی `PUSH_PROXY_URL` (https-proxy-agent) برای شبکه‌ای که به سرویس push دسترسی ندارد. mute اتاق (قوانین push خود Matrix) رعایت شود.
- **بررسی کن**: Synapse اجازهٔ ارسال به URL گیرنده را بدهد (`ip_range_blacklist`/`ip_range_whitelist` در `config/homeserver`): بهتر است URL عمومی `https://DOMAIN/...` باشد؛ اگر hairpin روی آروان کار نکرد، راه حل مستند کن.
- پذیرش: تست خودکار با یک «push service» جعلی (HTTP محلی)؛ تست subscribe/unsubscribe/prune؛ تست امنیت (secret غلط ← ۴۰۳). **صادقانه بنویس** که ارسال واقعی روی گوشی‌ها فقط در تست دستی (دو شبکه) تأیید می‌شود.

## P3 — پنل ادمین: داشبورد سیستم + تب «سرویس‌ها» + تب «اتاق‌ها»
- `GET /api/admin/system`: CPU load، RAM، دیسک `data/` و `backups/` (با `fs.statfs`)، uptime، حجم DB gateway، حجم رسانه، تعداد نشست/آنلاین، پیام ۲۴ ساعته (از Synapse admin API در صورت امکان).
- `GET /api/admin/services`: Synapse (`/_matrix/client/versions` + تأخیر)، **Postgres غیرمستقیم** با یک کوئری سبک ادمین Synapse (مثلاً `GET /_synapse/admin/v2/users?limit=1`) و زمان آن، LiveKit (پورت HTTP)، آخرین بکاپ (سن/حجم از `backups/`)، گواهی TLS (روز تا انقضا اگر قابل‌خواندن بود)، وضعیت push (کلید VAPID هست؟). UDP را نمی‌شود از داخل تست کرد؛ صادقانه «پیکربندی‌شده» بنویس.
- تب «اتاق‌ها» با Synapse admin API (`/_synapse/admin/v1/rooms`، اعضا، `DELETE /v2/rooms/{id}` با block/purge): لیست با صفحه‌بندی سمت سرور، جستجو، تعداد اعضا، حذف با **تأیید تایپی**.
- UI: کارت‌های رنگی (سالم/هشدار/خراب)، بازخوانی خودکار هر ۳۰ ثانیه، فارسی، تم تیره/روشن. `admin.html` با JS ساده بماند.
- پذیرش: تست API؛ خاموش‌کردن Synapse ← کارت قرمز؛ screenshot با Playwright.

## P4 — رجیستری تنظیمات + سقف آپلود + نگه‌داری خودکار
- در `settings.js` رجیستری `SETTING_DEFS` (key، نوع bool/int/string، min/max، گروه، label فارسی، توضیح، secret، نیاز به ری‌استارت). اولویت **env > DB > پیش‌فرض**؛ در پنل اگر env قفل کرده نام متغیر را نشان بده؛ دکمهٔ «بازگردانی پیش‌فرض»؛ ویرایش ذخیره‌نشده با رفرش پس‌زمینه نپرد؛ اعتبارسنجی سمت سرور؛ هر تغییر در audit.
- تنظیمات جدید: `max_upload_mb` برای هر نوع (پست/استوری/موزیک/آواتار)، `max_video_seconds`، `media_retention_days` (۰=خاموش)، `story_ttl_hours`، `max_username_chars`، `max_bio_chars`.
- job روزانهٔ نگه‌داری در gateway: حذف رسانه/پست‌های قدیمی‌تر از N روز (پین‌شده/ادمین مستثنا)، حذف فایل‌های بی‌صاحب روی دیسک، **dry-run** که فقط شمارش را نشان بدهد (دکمهٔ «پیش‌نمایش» در پنل)؛ نتیجه در audit.
- نمایش «حجم فعلی رسانه» و پیش‌بینی (روز تا پرشدن دیسک بر اساس رشد ۷ روز اخیر).
- پذیرش: تست با تاریخ جعلی؛ فایل واقعاً پاک شود؛ محتوای تازه و کاربران دیگر آسیب نبینند؛ env-lock درست نمایش داده شود.

## P5 — مدیریت کاربر/نقش، claim اضطراری، تأیید تایپی، کاتالوگ لاگ
- با Synapse admin API: ساخت کاربر از پنل (با رمز قوی طبق `policy.js`)، **ریست رمز**، فعال/غیرفعال. صفحه‌بندی/مرتب‌سازی/فیلتر سمت سرور برای لیست کاربران (پیش‌فرض ۵۰ در صفحه) و انتخاب اندازهٔ صفحه.
- نقش‌ها: جدول `roles(user_id, role)` با `owner|admin|moderator`؛ owner فقط یکی. moderator: گزارش‌ها و حذف محتوا؛ admin: کاربران/دعوت/محتوا؛ owner: تنظیمات، اسرار، بکاپ. **ماتریس دسترسی** (هر endpoint ادمین × هر نقش) تست شود؛ بدون نقش ← ۴۰۳. ورود با `GATEWAY_ADMIN_KEY` همچنان owner است.
- claim اضطراری: کاربر واردشده در `/admin.html` با `GATEWAY_ADMIN_KEY` حساب خودش را owner (اگر owner نبود) یا admin کند؛ فقط روی HTTPS؛ rate limit؛ audit (موفق/ناموفق).
- `TypedConfirm`: کارهای مخرب (purge، حذف اتاق، حذف دسته‌جمعی) باید متن را تایپ کنند.
- کاتالوگ رویداد audit (برچسب فارسی/رنگ/آیکن)، فیلتر نوع و بازهٔ زمانی و جستجو، صفحه‌بندی؛ خروجی CSV.
- بخش «اسرار» فقط owner: نمایش ماسک‌شدهٔ کلید ادمین/VAPID با دکمهٔ کپی (نمایش کامل فقط با تأیید رمز ادمین).
- نشان `verified` (همین‌جا): فیلد در profiles، سوییچ در پنل، نشان کنار نام در چت/فید/پروفایل، audit.

## P6 — تماس: تنظیمات + تاریخچه
- تنظیمات (از رجیستری P4): `calls_enabled`، `video_calls_enabled`، `call_max_minutes`، `max_group_call_participants`. gateway هنگام صدور توکن LiveKit رعایت کند؛ UI دکمه‌ها را غیرفعال و علت را نشان دهد.
- تاریخچه: **وب‌هوک LiveKit** (`room_started/finished`، `participant_joined/left`) به `/api/livekit/webhook` با تأیید امضا (`livekit-server-sdk` WebhookReceiver) ← جدول `call_log`. در `config/livekit*.yaml` آدرس webhook را اضافه کن (آدرس داخلی شبکهٔ docker). صفحهٔ «تماس‌ها» در UI: چه کسی/کجا، صوتی/تصویری، مدت، بی‌پاسخ؛ حذف مورد/همه.
- حداکثر مدت: TTL توکن + بستن اتاق توسط gateway (`RoomService.deleteRoom`) در موعد.
- پذیرش: تست وب‌هوک با امضای معتبر/نامعتبر؛ E2E تماس دو کاربر ← ردیف در تاریخچه.

## P7 — چت: فرمت متن امن + کد + waveform
- ارسال: زیرمجموعهٔ Markdown (`**bold**`، `_italic_`، `` `code` ``، بلوک کد، `> نقل`، لیست، لینک) → `format:"org.matrix.custom.html"` + `formatted_body` + `body` متنی. **رندر**: فقط تگ‌های مجاز طبق مشخصات Matrix با DOMPurify (بدون style/on*/script؛ `a` فقط http/https/mailto و `rel=noopener`). بلوک کد: دکمهٔ کپی؛ highlight سبک و lazy (یا بدون highlight اگر سنگین شد). لینک‌های بدون تگ خودکار لینک شوند.
- CSP موجود را **ضعیف نکن**؛ تست XSS با payloadهای رایج (`<img onerror>`، `javascript:` ...) باید رد شود (تست خودکار).
- پیام صوتی: waveform هنگام ضبط محاسبه و در محتوا ذخیره شود (MSC1767 `waveform`)، رندر میله‌ای، سازگاری با پیام‌های قدیمی بدون waveform.
- پیش‌نمایش لینک: **انجام نده** (نشت IP/حریم)؛ فقط اگر بعداً بخواهم.

## P8 — آفلاین و کش
- بررسی کن matrix-js-sdk چه می‌کند (`NOT_SENT`، `resendEvent`، `cancelPendingEvent`): وضعیت «در حال ارسال…/ناموفق»، تلاش دوباره خودکار با backoff پس از برگشت اتصال، دکمهٔ «ارسال دوباره/حذف»، نوار «آفلاین» بالای لیست، ماندن در حساب هنگام قطعی (نه خروج؛ خروج فقط با `M_UNKNOWN_TOKEN` واقعی).
- پنل «داده و حافظه» در Settings: `navigator.storage.estimate()`، پاک‌کردن کش **رسانه/thumbnail/پیش‌نمایش‌ها**. ⚠ **هرگز** IndexedDB رمزنگاری/کلیدهای E2EE (`hamdam-*`/`tikootak-*`) را پاک نکن؛ دکمه‌ها نام شفاف و تأیید داشته باشند.
- پذیرش: Playwright با `context.setOffline(true)`: پیام بفرست، آنلاین کن ← یک‌بار برسد؛ رفرش در حالت آفلاین ← همچنان در حساب.

## P9 — PWA و تازه‌ها
- نوار نصب (`beforeinstallprompt`) و راهنمای iOS (Share ← Add to Home Screen) با قابلیت «بعداً»؛ فقط بعد از اولین ورود موفق، حافظهٔ dismiss در `storage.js`.
- `GET /api/public/config` شامل `version` (از `VERSION`)؛ کلاینت نسخهٔ دیده‌شده را نگه دارد و کادر «تازه‌ها» (از `docs/WHATS-NEW.fa.md` یا فیلد در config) یک‌بار نشان دهد؛ وقتی SW جدید فعال شد «نسخهٔ جدید آماده است، بارگذاری مجدد» نشان بده.
- پذیرش: manifest/SW معتبر؛ تست Playwright برای دیدن/بستن نوار؛ نصب فیزیکی را «تأییدنشده» گزارش کن.

## P10 — رمزنگاری at-rest رسانهٔ gateway
- `MEDIA_ENCRYPTION_KEY` (تولید خودکار، در `.env` و بکاپ)؛ رمز تکه‌ای (مثلاً ۶۴KB با AES-256-GCM و nonce جدا) تا **Range/seek ویدیو و موزیک** خراب نشود؛ فایل‌های قدیمی بدون رمز همچنان خوانده شوند؛ `admin.sh encrypt-existing` (idempotent، قابل‌ازسرگیری). **fail-fast**: کلید عوض‌شده/گم‌شده ← gateway بالا نیاید با پیام واضح.
- ترنسکود/strip/sniff قبل از رمزنگاری. بکاپ/restore/migrate با رسانهٔ رمزشده تست شود.

## P11 — تست و انتشار
- `scripts/test-all.sh`: `bash -n`، `node --check`، `docker compose config -q`، `tests/scripts/*`، `tests/admin/adm01.mjs`، `tests/security/*` (یا `security-test.sh --app`) و خلاصه PASS/FAIL؛ کد خروج غیرصفر در شکست.
- تست‌های ادمین برای قابلیت‌های جدید (نقش‌ها، تنظیمات، retention، push، call_log) در `tests/admin/`.
- `docs/RUNBOOK.md`، `docs/TESTING.md`، `README.md`، `CHANGELOG.md`، `docs/ROADMAP-BACKEND.md` را به‌روز کن؛ `VERSION`.

## شروع
فقط **اول خواندن دو فایل مرجع و بعد P1** را انجام بده؛ قبل از کدنویسی در ≤۱۰ خط بگو P1 را چطور اجرا می‌کنی و چه ریسکی می‌بینی.
