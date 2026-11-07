# TIKOOTAK — project memory for Claude (read this first, do not re-read the whole repo)

Private friends platform (chat, calls, music, reels). Self-hosted on an Iran server; must be easy to move to another server.
Owner: Amirreza. Talks Persian. **Reply to the owner in Persian; code, commits, scripts and terminal output in English.** Web only (no native app planned).

## Layout
- `web-src/` React + Vite UI (build: `cd web-src && npx vite build` -> `web/dist`). CSS layers load in order: tokens.css, styles.css, theme.css, ui34.css, tg.css, q.css, lg.css, design.css (last wins; many `!important`). Glass lens: `src/lens.js` (Chromium only).
- `gateway/` Express + better-sqlite3 API in front of Matrix Synapse. `docker-compose.yml`, `Caddyfile`, `scripts/` ops scripts.
- `tests/e2e/*.mjs` Playwright scripts (need the local test env, see below). `docs/` guides. `CHANGELOG.md` newest first.

## Read these when the task touches them (do not read everything)
- `docs/ARCHITECTURE.md` — services, request routing, auth/invites, gateway modules, DB/migrations, upload policy, chat model, client file map, backups.
- `docs/UI-GUIDE.md` — CSS layer order, theming/look engine, glass material + SVG lens (and its pitfalls), gesture rules, i18n, UI testing.
- `docs/DECISIONS.md` — why things are the way they are, newest first.
- `docs/DESIGN-ROADMAP.md` + `DESIGN.md` + `PRODUCT.md` — redesign plan, design direction, motion rules. Design skills live in `.claude/skills/` (impeccable, emil-*, taste-skill); for UI work load impeccable first, Emil's skills for motion; taste-skill only for the idea of a one-line Design Read (its landing-page defaults do not fit this app).
- `docs/RUNBOOK.md`, `docs/MIGRATION.md`, `docs/INSTALL-FA.md`, `docs/UPLOAD-CONTROL.md` — operations. Other files in `docs/` are old history.

## Product & owner
- Platform for the owner's friends first; strangers may join by invite; security matters; must be movable to another server fast because Iranian servers may get filtered.
- Owner (Amirreza, not a professional developer, Windows PC, free Claude plan) gives one task at a time and judges the result by looking at it. Explain things simply, in Persian. Give copy-paste commands for server steps.
- Taste: Telegram's layout and behaviour + iOS "Liquid Glass" visuals (clear glass, thin bright rim, bent background at edges). He rejected: muddy dark blur, white smudges at pill edges, tails/halos around bubbles.
- Never ask him to paste secrets in chat; he once pasted a GitHub token — tell him to revoke leaked tokens.

## Pitfalls we already hit (save yourself the time)
- Old CSS layers use `!important`; a new rule that "does nothing" is usually losing to `tg.css`/`q.css`/`lg.css`. Check computed style in Playwright before guessing.
- Elements with an SVG lens must have no outer `box-shadow` (shifts filter origin); see `docs/UI-GUIDE.md`.
- `touchstart` events have no `clientY` in CDP tests — use `touches[0]`.
- Hover styles belong in `@media (hover:hover)` or they stick on touch screens.
- Test env: registration rate limit ("Too many requests") → start gateway with `RATE_*` raised (tests/env/start.sh does); right after start Synapse/proxy can return bad gateway for ~20 s.
- `web/dist` is not in git (CI/`build-web.sh` build it); the server needs no Node at runtime.
- Release workflow can be re-run for an existing tag: Actions → Release → Run workflow → tag.
- GitHub from the sandbox: only REST via `gh api repos/amirebi9156/tikootak/...`; no GraphQL; tags cannot be pushed from the session (owner creates Releases in the GitHub UI).

## Rules
- Every user-visible string goes through `tr('فارسی')`; add the English with `python3 web-src/add-en.py '{"فارسی":"English"}'`, then `node web-src/check-i18n.mjs` must pass.
- Bump `VERSION` + add a `CHANGELOG.md` entry for every release. Tag `vX.Y.Z` -> GitHub Action builds the release tar.
- Elements with an SVG lens (`.lens-on`) must not have an outer `box-shadow` (it shifts the filter origin).
- Do not commit `.env`, `config/`, `data/`, `backups/`, `certs/`, `.update.conf`.
- Be honest in reports: say what was tested and what was not (real phones/Docker/Caddy are not tested in the cloud sandbox).

## Workflow (token-cheap)
1. Work on a branch `feat/<name>`; commit small; open a PR; CI builds the UI.
2. To release: edit VERSION/CHANGELOG, merge to main, `git tag vX.Y.Z && git push --tags`.
3. On the server: `./scripts/update.sh` (downloads the release, backs up, upgrades, runs doctor).
4. Only read the files you need (grep first). Prefer diffs over whole files. Avoid screenshots unless the task is visual.

## Where things stand (update this section at the end of every task)
- Current release: see `VERSION`. Repo: private `amirebi9156/tikootak`; server install dir `/root/tikootak` (update with `./scripts/update.sh`, config in `.update.conf`).
- Default look: navy palette + built-in wallpapers (dusk/aurora/peaks), liquid-glass lens on pills/menus/Now Playing (Chromium only; `localStorage tikootak.glass=lite` turns it off).
- Owner wants the CHAT UI to feel like Telegram + iOS "Liquid Glass" (reference: a video of a glass music card with edge refraction). Next planned task: rework the chat area with the frontend-design skill.
- Known limits: nothing is tested on real phones/Docker/Caddy; upload category is client-declared; existing channels still allow member pinning; no ready-made sticker packs/GIFs; old CSS layers (styles/theme/ui34/tg/q/lg) still stack with many `!important`.
- 0.42: glass mini player (MiniPlayer.jsx), floating glass Now Playing window (FloatPlayer in NowPlaying.jsx), keyboard<->sticker panel swap (viewport.js + Chat.jsx), tidy sticker grid. Keyboard behaviour only tested by viewport-resize simulation, not on a real phone.
- 0.42.1: mini player now lives in `.chat-top` under the pin bar (Shell passes `topPlayer` to Chat; bottom bar only when no chat); attach menu is a portal (`.attach-pop`); dialogs glass with scrim z-index 75. Tested in Playwright at 390px/desktop, not on a real phone.
- 0.42.2: `.pin-stack` wraps pinbar + docked MiniPlayer (one glass lens block); context menu ignores item clicks for 450 ms after a touch open (`ContextMenu.jsx openedAt`); share-track card reuses `.music-card` classes; `.scroll-down` needs `position:absolute !important` because the `.lg` rule sets relative.
- 0.43.0: `ChatInfo.jsx` = Telegram-style glass info page opened from the chat header title/avatar (`infoOpen` in Chat.jsx); old `RoomSettings` dialog is reached via its menu or the header dots. Tabs scan only the loaded timeline (no server-side media search).
- 0.44.0: `UserSheet.jsx` = in-chat glass user profile (opened from `msg-av`/`msg-name` taps and the Members tab in `ChatInfo.jsx`; state `userSheet` in Chat.jsx; Shell passes `onMessage/onBlock/blocked`). Note: tag v0.43.1 points at the same commit as 0.43.0 (VERSION still 0.43.0). No presence/last-seen yet (not enabled on Synapse).
- Redesign stage 0 done (branch feat/design-roadmap): skills installed in `.claude/skills/`, `DESIGN.md`/`PRODUCT.md` written, detector baseline in `docs/design/`. Stage 1 done in 0.44.1 (tokens.css loaded first; all :hover rules inside `@media (hover:hover)`). Next: stage 2 motion (replace 6 bounce curves, keyframes->transitions, press feedback). Run `npx impeccable detect web-src/src` to track findings (baseline 28 raw / 22 with DESIGN.md).
- Open offers (not requested): merge music mini-player into pinned card; "press back again to exit"; group-level send limits for swipe-reply; sticker-pack import.

## Local test env (cloud sandbox; Docker is unavailable)
`bash tests/env/setup.sh` (once: Synapse in a venv + gateway deps + Playwright proxy), `bash tests/env/start.sh` (build UI + start everything), `bash tests/env/run-regression.sh [filter]` (all `tests/e2e/*.mjs`, prints FAIL counts). Test admin key: `adminkey`. LiveKit is not part of it (call tests are skipped).
