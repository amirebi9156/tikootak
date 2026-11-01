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

## Local test env (cloud sandbox only; not in repo)
Playwright scripts live in the session scratchpad `testenv/tools`; copy needed ones from `tests/e2e/`. Docker is unavailable there.
