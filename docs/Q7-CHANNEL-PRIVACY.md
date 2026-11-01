# Q7 — حریم خصوصی اعضای کانال در سطح سرور

نسخهٔ ۰.۳۵.۱۲.

## تصمیم معماری
دو گزینه بررسی شد:
1. **ماژول Synapse**: API عمومی برای فیلتر کردن پاسخ‌های `members/state/sync` بر اساس power کاربر ندارد؛ تغییر مستقیم Synapse/Python برای این نصب ۲GB پرریسک بود.
2. **بازنویسی کانال به «پخش» gateway**: امن‌ترین از نظر عضویت، ولی fan-out/history/کلید/سازگاری Matrix را کامل عوض می‌کند و در این مرحله قابل قبول نبود.

انتخاب: **فیلتر پاسخ در gateway** فقط برای مسیرهای GET حساس، با cache کوتاه و fail-closed. Caddy بقیهٔ Matrix را مستقیم به Synapse می‌فرستد.

## مسیرها
`Caddyfile` و `Caddyfile.manual-cert`:
- `GET /_matrix/client/*/sync`، `initialSync`
- `GET .../rooms/{id}/messages|members|joined_members|state|state/...|context/...|event/...|relations/...`
- `GET .../events/{eventId}`
- `POST .../user_directory/search` ← **۴۰۴**
- بقیهٔ `/_matrix/client/*` و `/_matrix/*` مستقیم Synapse.
- فقط GET از gateway عبور می‌کند؛ PUT/POST حالت/رسید/typing مستقیم Synapse می‌رود تا body خراب نشود.

Regex مسیر در Caddy تست شد (Docker + upstream جعلی): `members/`، `state/m.room.member/@x`، `messages`، `relations` و `events` به gateway؛ `publicRooms` و `PUT state` به Synapse؛ `user_directory` ۴۰۴.

## فیلتر gateway (`gateway/src/channel-privacy.js`)
- نوع اتاق از `ir.tikootak.room_type` / `ir.tikotak.room_type` و fallback `m.room.power_levels.events_default >= 50`.
- power بیننده از `m.room.power_levels` (creator=100)؛ فقط `channel` و `power < 50` فیلتر می‌شود.
- cache: `room_id → {kind, powerLevels, creator}` با TTL ۲۰ ثانیه؛ state از Synapse داخلی با توکن خود بیننده.
- `canView`/`filter`:
  - `m.room.member` دیگران حذف؛ member خود بیننده می‌ماند ولی `sender` (دعوت‌کننده) با HMAC به `@anon-…:DOMAIN` تبدیل می‌شود.
  - `m.reaction` دیگران: `sender` به anon پایدار per room+user؛ واکنش خود بیننده دست‌نخورده.
  - `m.receipt`: فقط receipt خود بیننده.
  - `m.typing`: فقط user خود بیننده.
  - `m.presence`: presence در Matrix سراسری است؛ اگر بیننده در یک کانال محدود باشد، فقط presence خودش در sync می‌ماند (هزینهٔ جانبی برای گروه/پیوی).
  - `summary.m.joined_member_count` و آنریدها می‌مانند؛ `summary.m.heroes` (شناسه‌ها) حذف می‌شود.
- `/sync`، `/initialSync`، `/messages`، `/context`، `/event`، `/state`، `/members`، `/joined_members`، `/relations` پوشش داده شده‌اند.
- **fail-closed**: اتاق ناشناخته در sync حذف می‌شود؛ خطای parse/filter ← ۵۰۲؛ endpoint اتاق ناشناخته ← ۴۰۴.
- flag: `CHANNEL_PRIVACY=1` پیش‌فرض روشن، `0` خاموش. `doctor.sh` از `/api/health` سلف‌تست می‌گیرد.

## چیزهایی که پنهان نمی‌شوند (صادقانه)
- شناسهٔ ادمین‌ها در `m.room.power_levels` و `sender` پست‌های کانال باقی می‌ماند (طبق پرامپت، ادمین‌ها صاحب کانال‌اند).
- `m.room.create.creator` و نام/آواتار/alias کانال.
- تعداد اعضا (`summary`) و بازدید/آنرید.
- presence سراسری ممکن است در گروه/پیوی بیننده هم محدود شود؛ Matrix presence به اتاق مقید نیست.
- Federation (اگر فعال شود) و درخواست‌های مستقیم به Synapse از داخل شبکه پوشش داده نمی‌شوند؛ Caddy تنها ورودی عمومی است.
- `publicRooms` Metadata (نام/تعداد) باقی است، ولی فهرست اعضا ندارد.
- `/events/{id}` اگر پاسخ room_id نداشته باشد fail-closed ۴۰۴ می‌شود؛ کلاینت وب از مسیر room-scoped استفاده می‌کند.
- کانال‌های invite اگر state برای بیننده قابل خواندن نباشد، fail-closed حذف می‌شوند (ممکن است دعوت کانال دیده نشود).

## تست
- `tests/gateway/channel-privacy.test.mjs`: تشخیص نوع/power، حذف member دیگران، anon شدن واکنش/دعوت‌کننده، receipt/typing، presence، عدم دست‌خوردن گروه/admin، حذف اتاق ناشناخته، middleware واقعی با Synapse جعلی، self-test.
- Caddy regex با Docker و upstream جعلی تست شد.
- `node --test` و `node --check` سبز.
- `tests/security/sec06.mjs` برای **Synapse زنده** نوشته شد (سه کاربر، کانال/گروه، members/state/sync/messages/context/receipts/relations) ولی در این محیط اجرا نشد؛ نیاز به سرور تست و `CHANNEL_PRIVACY=1` دارد. تأخیر sync واقعی هم اندازه‌گیری نشد.

## عملیات
- `.env`: `CHANNEL_PRIVACY=1`
- `docker compose up -d gateway caddy`
- `./scripts/doctor.sh` باید «Channel member privacy filter: self-test passed» بدهد.
- برای خاموش‌کردن موقت: `CHANNEL_PRIVACY=0` و recreate gateway (Caddy user_directory همچنان بسته می‌ماند).
