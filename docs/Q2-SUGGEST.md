# Q2 — پیشنهاد کاربر و کانال هنگام تایپ

نسخهٔ ۰.۳۵.۱۰.

## کاربران
`GET /api/people/suggest?q=` (احراز هویت + rate limit ۶۰/دقیقه)
- حداقل ۱ نویسه؛ حداکثر **۸** نتیجه.
- مرتب‌سازی: prefix روی username یا displayname اول، بعد substring؛ سپس username.
- بلاک‌شده/بن‌شده و خودِ کاربر حذف می‌شوند.
- هر نتیجه: `user_id`، `name`، `avatar`، `is_private`، `verified`.
- منبع: `registrations` + `name_index` (بدون تماس با Synapse).

## اتاق/کانال‌های عمومی
`GET /api/rooms/suggest?q=` (احراز هویت + rate limit ۴۵/دقیقه)
- از `/_matrix/client/v3/publicRooms` با `generic_search_term` خوانده می‌شود.
- حداکثر **۸** نتیجه؛ اتاق `visibility=private` هرگز برنمی‌گردد.
- ترتیب: prefix روی alias/name، بعد تعداد اعضا.
- خروجی: `room_id`، `name`، `alias`، `topic`، `members`، `avatar_url`.
- `q` خالی برای صفحهٔ «کشف گفتگوهای عمومی» نتایج محبوب (بر اساس اعضا) می‌دهد.

## UI
- `Suggest.jsx`: هوک `usePeopleSuggest` با debounce ۲۰۰ms، لیست `PeopleSuggest` (آواتار/نام/@id/نشان تأیید/قفل حساب خصوصی) و `RoomSuggestList`.
- `NewConversation`: پیشنهاد برای پی‌وی و دعوت گروه/کانال؛ ↑↓/Enter.
- `InviteDialog`: پیشنهاد هنگام دعوت عضو؛ ↑↓/Enter.
- `FindPeople` و `Explore`: جستجوی زنده با همان API؛ Enter پروفایل را باز می‌کند.
- `Explore`: بخش «کانال‌ها و گروه‌های عمومی» با تعداد اعضا و دکمهٔ پیوستن.
- `NewConversation → کشف گفتگوهای عمومی` از API سرور استفاده می‌کند (نه publicRooms مستقیم مرورگر).
- منشن در چت: همان لیست اعضای اتاق، حالا prefix-first و حداکثر ۸.

## نشان تأییدشده
- Migration 003: `profiles.verified INTEGER DEFAULT 0`.
- در APIهای `lite`/پروفایل برگردانده می‌شود و در `PersonRow`/پروفایل/پیشنهادها نشان داده می‌شود.
- سوییچ مدیریتی برای تغییر verified در P5 اضافه می‌شود؛ فعلاً فقط خواندن.

## تست
- `tests/gateway/suggest.test.mjs`: prefix-first، حذف self/banned/blocked، سقف ۸، verified، اتاق خصوصی حذف، room prefix.
- `tests/gateway/migrate.test.mjs`: migration 003 و ستون verified.
- `node check-i18n.mjs` و `vite build` سبز.
- Playwright واقعی برای UI (تایپ/↑↓/Enter/پیوستن) اجرا نشد؛ Matrix/مرورگر زنده لازم است.

## فایل‌ها
`gateway/src/profiles.js`، `gateway/src/suggest.js` (جدید)، `gateway/src/index.js`، `migrations/003-profiles-verified.js`، `web-src/src/Suggest.jsx` (جدید)، `Shell.jsx`، `Explore.jsx`، `Profile.jsx`، `Chat.jsx`، `api.js`، `q.css`، `en.js`، تست‌ها.
