# گزارش UI34-P1 — migration نسخه‌دار gateway

## ۱) چه شد
- `gateway/src/migrate.js` و `gateway/src/migrations/001-initial-schema.js` اضافه شد؛ جدول `schema_migrations(version,name,applied_at)`.
- migration ۱ کل اسکیمای فعلی UI33 را idempotent می‌سازد و ستون‌های جاافتاده را روی DB قدیمی اضافه می‌کند.
- ALTERهای پراکنده از `index.js`، `feed.js`، `music.js`، `profiles.js`، `adminx.js` و `transcode.js` حذف و به migration منتقل شدند.
- قبل از migration معلق: `db.backup()` در `data/gateway/pre-migrate-<ver>-<ts>.db` (۳ فایل آخر). هر migration در transaction.
- محافظ دانگرید: اگر نسخهٔ DB از بالاترین migration کد بزرگ‌تر باشد، gateway بالا نمی‌آید (`DB_SCHEMA_TOO_NEW`).
- نسخهٔ اسکیما در `/api/health`، `/api/admin/overview`، `doctor.sh` و `tikootak status` نمایش داده می‌شود.
- `VERSION=0.34.0`، `CHANGELOG.md` و docs به‌روز شدند.

## ۲) تست‌های واقعاً اجراشده
| تست | خروجی |
|---|---|
| `node --test tests/gateway/migrate.test.mjs` (داخل image gateway) | **3 pass / 0 fail**؛ empty، legacy، future |
| migration روی کپی DB واقعی UI31 (`/tmp/legacy-gw.db`) | ۲۶ registrations / ۳۸ posts / ۳۶ tracks قبل و بعد برابر؛ `applied 1-initial-schema`؛ `status {version:1,applied:1,latest:1}`؛ backup `/tmp/pre-migrate-0-...db` |
| `tests/admin/adm01.mjs` روی gateway جدید + DB کپی‌شده | **ok 30 bad 0** |
| `tests/scripts/tikootak-update.test.sh` | **ok=9 bad=0** |
| `bash -n scripts/*.sh tests/scripts/...` | OK |
| `node --check gateway/src/**/*.js` | OK |
| startup gateway جدید با DB خالی | `[migrate] applied 1-initial-schema` و `gateway listening on :3100` |
| `tests/security` روی gateway جدید | sec01/sec03/sec05 پاس؛ sec04 به‌دلیل rate-limit مشترک Synapse در اجرای پیوسته، ۱۰th را 429 داد (۳/۴) |
| future DB در سطح process | **تأییدنشده** (فقط unit تست شده) |
| doctor/tikootak status روی image جدید | **تأییدنشده** (کد و bash -n بررسی شد؛ image جدید روی live دیپلوی نشد) |

## ۳) تست‌نشده‌ها
- اجرای `doctor.sh` و `tikootak status` با gateway جدید روی نصب زنده (چون در این مرحله live gateway بازسازی/دیپلوی نشد).
- تست process-level برای DB آینده (منطق در unit تست شده).
- اجرای کامل security-suite به‌صورت تمیز؛ sec04 وابسته به rate-limit Synapse است.
- هیچ frontend تغییر نکرده؛ build مجدد انجام نشد (تست P1 backend است).

## ۴) فایل‌های تغییرکرده
- جدید: `gateway/src/migrate.js`، `gateway/src/migrations/001-initial-schema.js`، `tests/gateway/migrate.test.mjs`، `tests/gateway/legacy-check.mjs`.
- تغییر: `gateway/src/index.js`، `feed.js`، `music.js`، `profiles.js`، `adminx.js`، `transcode.js`، `scripts/doctor.sh`، `scripts/tikootak.sh`، `VERSION`، `CHANGELOG.md`، `README.md`، `docs/TESTING.md`، `docs/ROADMAP-BACKEND.md`، `docs/RUNBOOK.md`، `package.json`/locks (نسخه).
- tar: `tikootak-UI34-P1.tar.gz` با ریشهٔ `tikootak/`، بدون `node_modules`/`data`/`backups`/`.env`/`*.db`/`gateway/bin`.
