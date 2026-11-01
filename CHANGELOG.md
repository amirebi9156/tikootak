# CHANGELOG
## 0.41.0
- Liquid-glass lens now applied automatically to header pills, pinned card, composer pill, date chips, context menu, reactions pill, attach menu (Chromium; lens.js initAutoLens; one shared SVG filter per unique size). Disable with localStorage tikootak.glass=lite.
## 0.40.0
- Now Playing window redesigned as real Liquid Glass (Chromium): SVG displacement lens with edge refraction + chromatic dispersion, gradient rim, cover-based ambient backdrop, thin seek bar, SVG controls. Falls back to plain blur elsewhere.
## 0.39.0
- Design layer (design.css): liquid-glass material (gradient rim, specular, light blur), glass bubbles, wider header title, visible music play button, readable pinned title, colorful wallpaper orbs.
## 0.38.2
- Fix: white smudges on glass pill edges (SVG displacement mode disabled by default; clean blur + thin rim + top highlight).
## 0.38.1
- Fix: removed the moon from the "peaks" wallpaper (looked like halos behind bubbles); glass bubbles (rim highlight, translucent fill, light blur, no tails); default bubble radius 20.
## 0.38.0
- Design reset: new default navy palette (dark/light/oled) matching the Telegram navy theme; 3 built-in SVG wallpapers (dusk, aurora, peaks) so glass is visible; existing users keep their saved look.
## 0.37.0
- Chat redesigned after Telegram + Liquid Glass: floating header made of three glass pills (back, avatar+name, actions) over the wallpaper, messages scroll under it; glass pinned-message card with accent bar; glass date chips; rounder bubbles (20px) with an inset reply quote; input is a glass pill (emoji, text, attach) with a separate round accent send/mic button; round floating buttons.
- New glass layer (lg.css/glass.js): inner edge highlights + blur everywhere; on strong Chromium devices an SVG displacement filter adds the liquid refraction. Set localStorage tikootak.glass = "lite" to force blur only, "full" to force the refraction.
## 0.36.1
- Emoji/sticker panel on phones now works like Telegram: tapping the emoji button dismisses the keyboard and the glass panel slides up in its place (remembering your keyboard height); tapping the button again slides it down and brings the keyboard back; tapping the text field also swaps the panel for the keyboard. Desktop keeps the floating popover.
## 0.36.0
- Admin panel: new "ارسال فایل" tab. For image / video / voice / music / file, choose Everyone, Nobody or only selected users (enforced on the server; see docs/UPLOAD-CONTROL.md). Small files under a configurable size (default 512KB) are always allowed for avatars, covers and stickers. The app greys out the disabled buttons and shows a clear message.
- Caddyfile(s): Matrix media upload now passes through the gateway (needed for the control above). Update Caddyfile on existing servers.
- Telegram-style glass emoji/sticker panel: full emoji set (1900+) with category tabs, search, recents; Stickers tab with personal stickers (synced via account data, works in encrypted rooms, add from files or from any picture in chat) and big-emoji stickers. Sticker and emoji-only messages show without a bubble.
## 0.35.26
- All profile/chat/channel avatars are round everywhere (chat list, chat header, messages, profile, settings, stories, notifications, member lists) instead of rounded squares.
## 0.35.25
- "New group or channel" is now a small floating round button (54px) at the corner of the chat list instead of a full-width bar; the list gets bottom padding so nothing hides behind it.
## 0.35.24
- Chat input bar redesigned: floating glass pill (blur, soft shadow, accent border on focus), borderless text field, round transparent icon buttons, send/mic swap with a pop animation, glass reply/edit preview bar.
- Attach menu and emoji picker are glass with a pop animation; attach options have colored round icons (image, music, file, poll). Touch devices no longer keep a stuck hover circle on buttons.
## 0.35.23
- Message menu is more compact: shorter rows, smaller reaction pill and narrower card, so it covers less of the chat.
## 0.35.22
- Message menu: the chat behind it is no longer blurred or dimmed; only the menu cards themselves are glass.
## 0.35.21
- Message menu is now a Telegram-style glass popover on phones too (no more bottom sheet): a separate reactions pill appears above the touch point and the action card right below it, with a soft pop animation and light dim backdrop; it stays inside the screen. Same look on desktop.
## 0.35.20
- Telegram-style blank-space gestures: tapping (phone) or clicking (desktop) the empty space beside a message opens its action menu; dragging from the blank space beside a message also swipes to reply.
- Channels: members (no posting rights) swipe a post to forward it instead of replying; the menu hides Reply; admins swipe to reply. Double-click reply is disabled for read-only members.
- New channels: only admins can pin (previously anyone could). Existing channels are unchanged.
## 0.35.19
- Swipe-to-reply like Telegram: drag any message (yours or theirs) to the left to reply; a reply icon follows the drag and the bubble snaps back. Works with touch on phones, mouse drag and horizontal trackpad scroll on desktop. Vertical scrolling, taps, selection and multi-select are unaffected.
## 0.35.18
- Phone back button / edge swipe no longer closes the web app: each open layer (chat, tab, dialog, menus, attach menu, media viewer, now-playing, settings page) closes one step at a time. Back from the chat list still leaves the app, as usual.
## 0.35.17
- Music card in chat is more compact (smaller round cover, no extra width), closer to Telegram.
- Bottom mini-player: slides in smoothly, softer hover/press transitions, thin seek line with a thumb that appears on hover.
- Tapping the mini-player opens "Now playing" as a floating window over a dimmed, blurred page (not fullscreen). Click outside or press Escape to close; the music keeps playing.
## 0.35.16
- Chat music card now looks like Telegram: round cover with a round play/pause button, "artist – title", then "duration, size" (becomes "0:02 / 3:05" while playing). Round accent circle when the song has no cover.
- "Add to playlist" moved from the card into the message menu (right-click on desktop, tap menu on mobile).
- Chat list preview shows the song title (🎵) instead of "voice message".
## 0.35.15 (Q5 desktop notifications, Q4 music)
- Q5: Settings → Notifications: message notifications (off by default; permission asked only on click), optional message text, optional short sound. Text is built only in the browser from the decrypted message. Muted chats, your own messages, old history and the chat you are looking at stay silent. Click opens that chat (service worker `notificationclick`). Tab title `(n) TIKOOTAK` and app badge.
- Q4: music in chats is a card (cover, play/pause, title, artist · duration · size). One tap downloads with a progress ring and plays; no manual download step. Plays through the global player (mini-player, lock screen controls). Downloaded songs are cached (LRU, 100 MB). Songs sent from a device now carry title/artist/cover from their tags.
- Q4: "Add to playlist" on every chat song (card button and message menu): toggle several playlists, create a new one inline. The file is decrypted on your device and uploaded as your own track; the same file is never stored twice for one user. Your songs list shows which playlists contain each song (max 2 + n).
- Gateway: `GET /api/music/tracks/mine` (playlists per track in one query), `GET /api/music/tracks/:id/playlists`; repeated upload of the same file returns the existing track.
- Fix: signed channel posts showed the admin's username to members instead of the display name (member events are hidden by Q7); names now come from profile lookup.
- Limit: playback starts after the file has downloaded (no streaming before completion), because chat media needs an authorization header.
## 0.35.14 (Q7 — channel member privacy at server level, merged from DeepSeek + Claude fixes)
- Caddy sends only sensitive Matrix GETs (sync, messages, members, state, context, event, relations) through the gateway; `user_directory` returns 404; everything else goes straight to Synapse.
- `gateway/src/channel-privacy.js`: for channels, normal members no longer see other members (members/state/sync/messages/receipts/typing/presence); reaction senders and inviters are pseudonymized. `CHANNEL_PRIVACY=0` disables it.
- Claude fixes after live testing: pending invites were dropped from sync (every DM/group invite would have disappeared); rooms still being created caused sync errors. Invites now pass through, left rooms are filtered strictly, unknown joined rooms retry instead of being dropped.
- Tests: `tests/gateway/channel-privacy.test.mjs`; `tests/security/sec06.mjs` fixed (creator in power levels, relations path) and now passes against a live Synapse (23/23).
## 0.35.13
- Chat list: unread badge next to the back button inside a chat and on the bottom-bar chat tab (muted chats excluded).
- One-tap public/private account switch on your own profile and in the menu.
- Avatar crop editor (drag, zoom, rotate) for profile and group photos.
- Q8: floating compose button removed; fixed "new group or channel" button; "private message" creation merged into search: chats first, then new people (opens their profile, then Message), then public chats with join. "Room" wording replaced by "chat".
## 0.35.12
- Fix: backup.sh exited with an error right after creating the backup (ls glob + pipefail), which made "tikootak update" ask "Backup failed" and skipped the off-site copy. Housekeeping can no longer fail a backup.

## 0.35.11
- Fix: people suggest no longer matches the server part of the id (typing "local" listed everyone); request persistent browser storage so E2EE keys are not evicted.

## 0.35.10 (Q2 — پیشنهاد کاربر/کانال)
- `GET /api/people/suggest`: پیشنهاد prefix-first روی username/displayname، حداکثر ۸، rate limit، حذف بلاک/بن/خود.
- `GET /api/rooms/suggest`: پروکسی امن `publicRooms` با prefix-first، حداکثر ۸ و حذف اتاق خصوصی.
- Migration 003: `profiles.verified` + نشان تأیید در پیشنهادها/پروفایل (سوییچ مدیریت در P5).
- UI: کامپوننت `Suggest.jsx`؛ اتصال به NewConversation (پی‌وی/دعوت)، InviteDialog، FindPeople، Explore و منشن.
- NewConversation دیگر `publicRooms` را مستقیم از مرورگر صدا نمی‌زند؛ از API سرور استفاده می‌کند.
- تست: `tests/gateway/suggest.test.mjs` و migration 003.

## 0.35.9 (Q3 — اکشن پیام موبایل/دسکتاپ)
- موبایل: یک تپ روی حباب پیام منوی Bottom Sheet را باز می‌کند (۶ واکنش سریع + دکمهٔ «+» برای ۶ ایموجی بیشتر).
- تپ روی لینک/عکس/ویدیو/ویس/دکمهٔ پخش/پیوست/ری‌اکشن/نقل‌قول/ساعت و پیام فقط‌ایموجی منو باز نمی‌کند؛ اسکرول >۸px و لمس طولانی >۴۰۰ms تپ حساب نمی‌شود.
- دسکتاپ: دابل‌کلیک روی پیام = پاسخ + فوکوس composer؛ روی لینک/عکس/دکمه/انتخاب متن پاسخ نمی‌دهد. راست‌کلیک همان منوی شناور.
- دسترسی‌پذیری: هر پیام فوکوس‌پذیر است و Enter/Space منو را باز می‌کند.
- `ContextMenu` روی اشاره‌گر coarse به bottom-sheet واقعی تبدیل شد.
- تست: `tests/ui/msg-gestures.test.mjs`.

## 0.35.8 (Q6 — پیام‌های کانال + فیلتر SQL فید)
- کانال: هر پیام با آواتار/نام کانال (نه ادمین) در چت، ریپلای، کپی، فوروارد و پیش‌نمایش لیست گفتگوها؛ «تو:» و تیک برای کانال حذف شد.
- گزینهٔ «امضای پیام‌ها» در تنظیمات کانال: state event `ir.tikootak.channel_signing` (پیش‌فرض خاموش)؛ با روشن‌بودن، نام ادمین کوچک زیر هر پست. پست‌های قدیمی هم با تنظیم فعلی نمایش داده می‌شوند.
- لیست اعضای کانال و «دعوت‌شده توسط» فقط برای admin/owner؛ عضو عادی لیست را نمی‌بیند.
- `GET /api/feed/posts`: فیلتر حریم خصوصی به SQL و قبل از `LIMIT` منتقل شد (`privacy.visibilityClause`) تا صفحه‌ها با ردیف‌های خصوصی خالی نشوند.
- تست: `tests/ui/channel-signing.test.mjs` + بررسی صفحهٔ پر در `tests/gateway/privacy.test.mjs`.

## 0.35.0 (Q1 — حریم خصوصی و درخواست دنبال‌کردن)
- Migration 002: `profiles.is_private` و `follows.status` (`pending|accepted`)؛ ردیف‌های قبلی `accepted` می‌مانند.
- قانون مرکزی `gateway/src/privacy.js` (`canView` / `canSeeStory`): مالک، بلاک، بن، حساب خصوصی و فالوور accepted؛ غیرمجاز ← ۴۰۴.
- APIهای جدید: `GET /api/follow/requests`، `POST .../accept|decline`، `DELETE /api/followers/:user`، `PATCH /api/profile` با `is_private`؛ `POST /api/follow` دیگر unfollow نمی‌کند.
- اعمال canView روی فید/پروفایل/جستجو/اکسپلور/ریلز/لایک/کامنت/لیست فالوورها/لینک امضاشده/استوری؛ استوری فقط خودم + فالوورهای accepted.
- برگشت از خصوصی به عمومی: همهٔ درخواست‌های pending خودکار accepted می‌شوند (مستند در `docs/Q1-PRIVACY.md`).
- UI: سوییچ «حساب خصوصی»، دکمهٔ سه‌حالتهٔ فالو، قفل/پیام پروفایل خصوصی، تب درخواست‌های فالو در اعلان‌ها؛ استایل جدید `q.css`.
- تست: `tests/gateway/privacy.test.mjs` (ماتریس عمومی/خصوصی/فالوور/غیرفالوور/بلاک + رسانهٔ امضاشدهٔ قدیمی) و migration 002.

## 0.34.6
- Fix: admin panel script moved to admin.js (Caddy CSP blocked the inline script, so login did nothing).

## 0.34.5
- Mobile chat view: removed leftover bottom gap in installed-app mode.

## 0.34.4
- Admin panel explains "IP not allowed"; English .env.example + `tikootak env-refresh`; install-as-app banner on mobile.

## 0.34.3
- Fix: update/rollback recreate Caddy so it does not serve a stale web folder (404 + false auto-rollback).

## 0.34.2
- Installer/ops scripts are English-only (readable in any terminal); new interactive `install.sh`, `tikootak` management menu, drop-in updates (`updates/` folder), `set-ip` and `calls` self-check, correct public-IP detection for LiveKit.
- Mobile: install-to-home-screen / full-screen entries in the menu, fullscreen manifest and iOS meta tags.

## 0.34.1 (UI34 مراحل ۱–۳)
- منوی کشویی تلگرام‌مانند (همبرگر) و تنظیمات دسته‌بندی‌شده؛ سوییچ‌های E2EE/عمومی؛ اصلاح هدر موبایل و تداخل لوگو با جستجو.
- پیش‌نمایش پیش از ارسال فایل با کپشن (عکس + کپشن در یک پیام)؛ شمارندهٔ بازدید زیر پست کانال.
- ظاهر تلگرامی (حباب‌های دورنگ، دم حباب، ساعت کنار متن، والپیپر) و صفحهٔ «شخصی‌سازی چت»: تم رنگی، رنگ دلخواه، اندازهٔ متن، گوشهٔ حباب، والپیپر، حالت شب/روز/مشکی.
- bootstrap: بررسی اشغال‌بودن پورت ۸۰/۴۴۳.
## 0.34.0 (UI34-P1)
- migration نسخه‌دار gateway: `schema_migrations`، `gateway/src/migrate.js` و `migrations/001-initial-schema.js`؛ انتقال ALTERهای پراکنده به migration ۱.
- backup خودکار قبل از migration معلق (۳ فایل آخر)، تراکنش هر migration، محافظ دانگرید (DB جدیدتر از کد ← بالا نیامدن با پیام روشن).
- نمایش نسخهٔ اسکیما در `/api/health`، `/api/admin/overview`، `doctor.sh` و `tikootak status`.
- تست‌های `tests/gateway/migrate.test.mjs` برای DB خالی، DB قدیمی، اجرای دوباره و DB آینده.
## 0.33.0 (UI33)
- فرمان مدیریت `tikootak` (منو، status، update/downgrade با بکاپ و برگشت خودکار، rollback، mirrors، logs، settings).
- تحلیل Songbird (`docs/ANALYSIS-SONGBIRD-VS-TIKOOTAK.md`) و پرامپت ارتقا (`docs/DEEPSEEK-UPDATE-PROMPT.md`)؛ تست ادمین `tests/admin/adm01.mjs` (۳۰ بررسی) وارد مخزن شد.
- فایل `VERSION`، `SECURITY.md`، تست `tests/scripts/tikootak-update.test.sh`.
- bootstrap فرمان سراسری را نصب می‌کند.
## 0.32.x (UI32)
- تغییر نام برند به TIKOOTAK؛ سازگاری با کلیدها/رویدادها/بکاپ‌های قدیمی.
