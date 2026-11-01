# TIKOOTAK — project memory for Claude (read this first, do not re-read the whole repo)

Private friends platform (chat, calls, music, reels). Self-hosted on an Iran server; must be easy to move to another server.
Owner: Amirreza. Talks Persian. **Reply to the owner in Persian; code, commits, scripts and terminal output in English.** Web only (no native app planned).

## Layout
- `web-src/` React + Vite UI (build: `cd web-src && npx vite build` -> `web/dist`). CSS layers load in order: styles.css, theme.css, ui34.css, tg.css, q.css, lg.css, design.css (last wins; many `!important`). Glass lens: `src/lens.js` (Chromium only).
- `gateway/` Express + better-sqlite3 API in front of Matrix Synapse. `docker-compose.yml`, `Caddyfile`, `scripts/` ops scripts.
- `tests/e2e/*.mjs` Playwright scripts (need the local test env, see below). `docs/` guides. `CHANGELOG.md` newest first.

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
- Open offers (not requested): merge music mini-player into pinned card; "press back again to exit"; group-level send limits for swipe-reply; sticker-pack import.

## Local test env (cloud sandbox; Docker is unavailable)
`bash tests/env/setup.sh` (once: Synapse in a venv + gateway deps + Playwright proxy), `bash tests/env/start.sh` (build UI + start everything), `bash tests/env/run-regression.sh [filter]` (all `tests/e2e/*.mjs`, prints FAIL counts). Test admin key: `adminkey`. LiveKit is not part of it (call tests are skipped).
