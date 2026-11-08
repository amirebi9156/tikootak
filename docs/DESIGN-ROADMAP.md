# Design redesign roadmap (taste + Emil Kowalski + Impeccable)

Owner goal: find every design bug in every screen, remove the "raw" feel, make all motion and transitions smooth. Owner does not use these skills himself; Claude drives them and reports in Persian.

## Skills and what each is for
| Skill | Use it for | Do NOT use it for |
|---|---|---|
| impeccable (pbakaus/impeccable) | Router for passes: `critique` (UX/hierarchy score), `audit` (a11y/perf/responsive), `polish`, `distill`, `harden` (empty/error/long text/RTL), `adapt`, `typeset`, `colorize`, `animate`, `clarify`; `npx impeccable detect` = 61 deterministic rules, no LLM | Creating from scratch when a direction already exists |
| Emil Kowalski (emilkowalski/skills) | `improve-animations` (audit whole codebase -> prioritized motion plans), `review-animations` (findings table before/after/why), `animation-vocabulary` | Layout, color, copy |
| taste-skill (Leonxlnx) | Brief inference ("Design Read"), dials: density / variance / motion; anti-slop bans | Dashboards and dense product UI by its own rules; its default dials (variance 8) are too wild for a chat app, so use low variance, medium density, motion 4-6 |

Project constraints that override all skills: Telegram layout + iOS Liquid Glass look, RTL/Persian first, no outer box-shadow on `.lens-on`, hover only in `@media (hover:hover)`, all strings via `tr()`.

## Baseline facts (measured on 0.44.0, web-src/src/*.css)
- 729 `!important`; 7 stacked CSS layers (styles, theme, ui34, tg, q, lg, design).
- 86 `:hover` rules, 0 inside `@media (hover:hover)` -> hover sticks on touch screens (real bug).
- Easing is fragmented: 3 `--ease` definitions, ~8 different cubic-beziers, some overshoot curves.
- 35 `@keyframes` (cannot retarget mid-flight; repeated actions restart from zero).
- 38 distinct font-size px values, 35 border-radius values, 29 z-index values: no scale.
- Good already: almost no `transition: all` (1), no `ease-in`, 16 reduced-motion blocks.

## Stages (one stage = one branch + PR + version bump; owner reviews by looking)
0. Setup: copy the three skills into `.claude/skills/` of the repo (so every session loads them); run `npx impeccable detect` on `web-src` for a first machine report; write `PRODUCT.md`/`DESIGN.md` (taste "Design Read": chat app, friends, Telegram + Liquid Glass, density 6, variance 3, motion 5).
1. Foundations (impeccable `audit` + `typeset`): design tokens in one new `tokens.css`: type scale (about 8 sizes), radius scale, z-index scale, spacing scale, one easing set (`--ease-out`, `--ease-in-out`, `--ease-spring`) and duration set (100/160/240/320 ms). Move hover rules into `@media (hover:hover)`. No visual redesign yet.
2. Motion pass (Emil `improve-animations` -> `review-animations`): keyframes to transitions where re-triggerable, press feedback (`scale(.97)`), enter/exit with ease-out, origin-aware popovers/menus, interruptible sheets, frequent actions (typing, send, scroll) get no animation, reduced-motion respected. Output = findings table, then implement top items.
3. Screen-by-screen critique + polish (impeccable `critique` -> `polish`), in this order: chat list/Shell, chat view and composer, ChatInfo/UserSheet, Feed/Explore/reels, Stories, Music/NowPlaying/MiniPlayer, Profile/Settings, Auth/Onboarding, Notifications/dialogs. Each screen: screenshots at 390 px and desktop, RTL check, list of bugs, fixes.
4. Harden (impeccable `harden` + `adapt`): empty states, loading skeletons, errors, offline, very long names/Persian+English mixed text, small phones, keyboard open, safe areas.
5. New features from the critique (examples to confirm with owner): skeleton loaders, pull-to-refresh feel, shared-element transition for avatar->profile, swipe-back, haptic-like micro feedback, empty-state illustrations.
6. Debt cleanup: remove dead CSS and `!important` by merging layers into `tokens.css` + `components.css`; keep Playwright regression green.

## Rules for every stage
- Test with `tests/env` Playwright; say honestly what was not tested (real phones, Chromium-only glass).
- Update CHANGELOG, VERSION, and the "Where things stand" section of CLAUDE.md.
