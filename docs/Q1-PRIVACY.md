# Q1 — حریم خصوصی حساب و درخواست دنبال‌کردن

نسخهٔ ۰.۳۵.۰ (migration `002-follow-privacy`).

## اسکیما
- `profiles.is_private INTEGER NOT NULL DEFAULT 0` — پیش‌فرض عمومی.
- `follows.status TEXT NOT NULL DEFAULT 'accepted'` — `pending` یا `accepted`.
- ایندکس‌های `follows(followee,status)` و `follows(follower,status)`.
- ردیف‌های قدیمی `follows` به‌صورت خودکار `accepted` می‌مانند (بدون قطع فالو).

## قانون دید
تنها منبع حقیقت `gateway/src/privacy.js` است:

```js
canView(viewer, owner) // مالک → true؛ بن/بلاک → false؛ عمومی → true؛ خصوصی → فقط accepted
canSeeStory(viewer, owner, audience)
```

ترتیب: مالک > بلاک > بن > عمومی/خصوصی. پاسخ غیرمجاز در همهٔ APIهای محتوا **۴۰۴** است (نه ۴۰۳).
لینک‌های امضاشدهٔ قدیمی هم دوباره با `canView` بررسی می‌شوند؛ بنابراین با خصوصی‌شدن حساب یا آنفالو، لینک قبلی از کار می‌افتد.

## APIها
| متد | مسیر | توضیح |
|---|---|---|
| POST | `/api/follow/:user` | عمومی → `accepted`؛ خصوصی → `pending` (idempotent) |
| DELETE | `/api/follow/:user` | آنفالو یا لغو درخواست |
| GET | `/api/follow/requests` | درخواست‌های دریافتی `pending` |
| POST | `/api/follow/requests/:user/accept` | پذیرش + اعلان `follow_accept` |
| POST | `/api/follow/requests/:user/decline` | رد |
| DELETE | `/api/followers/:user` | حذف فالوور |
| PATCH | `/api/profile` | `{is_private: true|false}` (و `bio` هم اختیاری) |

`POST /api/follow` دیگر toggle نیست؛ unfollow فقط با `DELETE` انجام می‌شود تا رفتار UI قابل پیش‌بینی باشد.

## تصمیم: برگشت از خصوصی به عمومی
وقتی `is_private` از ۱ به ۰ می‌رود، همهٔ ردیف‌های `pending` همان لحظه `accepted` می‌شوند و برای هر درخواست‌دهنده اعلان `follow_accept` ثبت می‌شود.
دلیل: جلوگیری از گیرکردن ده‌ها درخواست و هم‌رفتاری با انتظار کاربر از اینستاگرام؛ امنیت کاهش نمی‌یابد چون فقط درخواست‌های واقعیِ همان حساب پذیرفته می‌شوند.

## فیلتر SQL فید
برای `GET /api/feed/posts` شرط دید (`privacy.visibilityClause`) داخل **خود SQL و قبل از LIMIT** اعمال می‌شود: نویسندهٔ عمومی + خودم + فالوورهای `accepted`. بنابراین ردیف‌های خصوصی جای صفحه را نمی‌خورند و هر صفحه تا سقف `limit` پر می‌شود.

## استوری
`GET /api/stories` فقط استوری خود کاربر + فالوورهای `accepted` را برمی‌گرداند. `GET /api/stories/media/:id` علاوه بر امضا، `canSeeStory` را دوباره چک می‌کند و برای غیرمجاز ۴۰۴ می‌دهد.

## تست
- `tests/gateway/migrate.test.mjs` — migration 002 روی DB خالی/قدیمی/تکرار.
- `tests/gateway/privacy.test.mjs` — ماتریس عمومی/خصوصی × مالک/فالوور/غیرفالوور/بلاک + رسانه و استوری امضاشده + accept/decline/cancel/remove + auto-accept.

## محدودیت شناخته‌شده
لینک امضاشده ذاتاً «Bearer» است؛ اگر مالک خودش لینک `u=owner` را منتشر کند، هر کسی که آن لینک را داشته باشد تا انقضا می‌تواند بخواند. برای بستن کامل این حالت باید رسانه پشت احراز هویت هدر بیاید (مثلاً blob/stream با توکن) که در Q1 انجام نشد چون UI فعلی تگ `<img>/<video>` مستقیم دارد.
