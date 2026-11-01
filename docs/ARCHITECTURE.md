# TIKOOTAK architecture (for Claude and developers)

Private, invite-only social + chat platform: E2EE chat, group/1:1 calls, channels, stories, short video/photo feed (Instagram-like), music (personal + public playlists). One domain serves everything. Designed to be moved between servers in minutes (backup + `install.sh`/`update.sh`).

## Runtime components (docker-compose.yml)
| Service | What it does |
|---|---|
| **caddy** | HTTPS + routing for one domain. Serves `web/dist` (prebuilt UI, no Node needed at runtime), proxies `/_matrix/*` to Synapse, `/api/*` to gateway, `/livekit` to LiveKit. Blocks `/_synapse/admin/*` (403) and `user_directory` (404). Security headers + CSP live here. `Caddyfile.manual-cert` is the variant for servers that cannot reach Let's Encrypt. |
| **synapse + postgres** | Matrix homeserver (chat, rooms, E2EE, media store). No federation. |
| **livekit** | Calls (SFU + TURN). Gateway mints join tokens at `POST /api/rtc/token`. |
| **gateway** (`gateway/src`, Express + better-sqlite3, port 3000) | Everything that is not plain Matrix: invite-only registration/login, feed, stories, music, profiles/follows/blocks, notifications, reports, admin API, upload policy, and a **filter in front of selected Matrix endpoints** (channel member privacy). |
| **web/dist** | Built React app (source in `web-src/`). |

Request path rules (Caddyfile): `@matrix_private` (sync, members, joined_members, messages… for **channel** rooms) → gateway first (it filters member lists for viewers with power < 50) then Synapse; `@media_upload` (Matrix media upload POST/PUT) → gateway (enforces admin upload policy) then Synapse; all other `/_matrix/*` → Synapse directly.

## Identity & auth
- Registration only with an invite code (`/api/auth/register`); the gateway creates the Matrix user through Synapse's shared-secret admin API and returns a Matrix access token. Login: `/api/auth/login` (10 failed tries / 15 min → 15 min lockout, in memory; `policy.js`).
- The Matrix access token is also the gateway auth token (`Authorization: Bearer`). User id shown in the UI is the username (`@ali`), not the full mxid.
- Invites: admin invites (`/api/admin/invites`) and per-user invites after 24h (`userinvites.js`), single use, invite tree visible to admin. Registration can be locked / capped (`settings.js`, table `settings`).
- Admin API requires header `x-admin-key` (`GATEWAY_ADMIN_KEY`), optional IP allow-list (`ADMIN_ALLOW_IPS`), audit log (`audit.js`). Admin panel is static `web-src/public/admin.js` (tabs: overview, users, invites tree, moderation, reports, upload control…).

## Gateway modules (gateway/src)
`index.js` mounts everything and creates base tables. `feed.js` (posts/comments/likes, files on disk next to DB, `transcode.js` ffmpeg ≤720p H.264 single low-priority worker, `strip.js` removes EXIF/GPS, `sniff.js` checks magic bytes), `ranking.js` + `interests.js` (For-You feed: SQLite-only scoring, interest weights decay with 14-day half-life), `stories.js` (24h expiry), `music.js` (tracks, playlists private/public, share codes, covers), `profiles.js` (profile/avatar/bio, follow + requests, user search, `name_index`), `blocks.js`, `privacy.js` (**central visibility rule — every content route must use it**; priority: owner ↔ block ↔ ban ↔ private account/follow), `notifications.js` (created before other modules mount), `reports.js`, `suggest.js` (public room/people suggestions, Synapse directory is source), `channel-privacy.js` (Q7 filter), `uploads.js` (per-category policy), `synapse-admin.js`, `migrate.js` + `migrations/00N-*.js` (versioned, transactional, backup of DB before first pending migration; keep latest 3). Schema changes = add a new migration file, never edit old ones.
Env vars read by gateway: `DB_PATH, MEDIA_SECRET, USER_QUOTA_MB, FEED_MAX_MB, MUSIC_MAX_MB, STORY_MAX_MB, TRANSCODE*, FFMPEG_PATH, FFPROBE_PATH, CHANNEL_PRIVACY, ADMIN_ALLOW_IPS, GATEWAY_ADMIN_KEY, SYNAPSE_URL, SYNAPSE_SHARED_SECRET, MATRIX_SERVER_NAME, LIVEKIT_*, RATE_*`.

## Upload policy (uploads.js)
Admin sets per category (image, video, voice, music, file): everyone / nobody / only listed users. Enforced server-side because Matrix media uploads pass through the gateway. Category comes from Content-Type (encrypted blobs carry `; tk=<kind>`). Files ≤ `small_kb` (default 512 KB) always pass. Honest limit: category is client-declared → this is resource saving, not a security boundary. UI reads `GET /api/uploads/policy` and disables buttons.

## Chat model (client)
- Matrix JS SDK in the browser, E2EE on (rust crypto wasm). Recovery key banner for key backup. DMs are `dm` rooms; groups; **channels** (broadcast: only power ≥ 50 posts; members cannot pin in new channels (`pinned_events:50`); members may forward/copy but not reply).
- Client files: `matrix.js`/`useMatrix.js` (SDK + state), `api.js` (gateway calls), `session.js`, `Shell.jsx` (app frame: chat list, FAB, tabs chat/feed/explore/music, mini player), `Chat.jsx` (the biggest file: timeline, composer, gestures, emoji dock, context menu), `ContextMenu.jsx`, `EmojiPanel.jsx` + `stickers.js` (sticker packs stored per user; sent as images with a flag), `Call.jsx` + `call.js` (LiveKit), `Attachment.jsx`/`media.js` (upload, encryption, thumbnails), `Feed.jsx`, `Stories.jsx`, `Music.jsx`/`MusicCard.jsx`/`NowPlaying.jsx`/`player.js`, `Profile.jsx`, `Settings.jsx`/`ChatLook.jsx` (appearance), `Notifications.jsx`, `RoomSettings.jsx`, `Poll.jsx`, `Suggest.jsx`, `Onboarding.jsx`, `Recovery.jsx`, `pwa.js` (service worker/install).
- Persistent client storage goes through `storage.js` (try/catch wrapped localStorage).

## Backups & moving servers
`scripts/backup.sh` (encrypted `.tar.gz.enc`, nightly via install), `restore.sh`, `verify-backup.sh`, `migrate.sh`, `docs/MIGRATION.md`. New server: install with `bootstrap.sh`/`install.sh`, restore latest backup, point DNS. `doctor.sh` checks services, HTTPS, PUBLIC_IP, disk, backups. `update.sh` = download release + `upgrade.sh` (backup → rebuild gateway/web → doctor).

## Legacy docs
Files in `docs/` named `DEEPSEEK-*`, `AUDIT-REPORT`, `ROADMAP-*`, `Q*-*.md`, `P1-*`, `REBRAND-*`, `SONGBIRD-*` are history from earlier phases; trust code and this file over them. Still current: `INSTALL-FA.md`, `MIGRATION.md`, `RUNBOOK.md`, `ARVAN-GUIDE.md`, `UPLOAD-CONTROL.md`, `TESTING.md` (manual checklist).
