# impeccable detect: baseline (v0.44.0, web-src/src, CSS only)

Command: `npx impeccable detect --json --no-config --no-design-system web-src/src` (exit 2 = findings). Raw: `impeccable-baseline.json`. Telemetry was turned off (`impeccable telemetry off`).

| Rule | Count | Verdict |
|---|---|---|
| bounce-easing | 5 (q.css 227/284/303/327, theme.css 1900) | Real: overshoot curves on UI. Replace with ease-out tokens (stage 2). |
| side-tab (3px inline-start border) | 8 (styles.css x4, theme.css x2, lg.css, tg.css) | Mostly legit: Telegram-style reply/quote bars. Review each, keep reply bars. |
| overused-font (Inter) | 14 | Low value: Inter is the Latin fallback next to Vazirmatn. Fix by one font token (stage 1), not by dropping Inter. |
| codex-grid-background | 1 (styles.css 457) | Check where used; likely decorative leftover. |

Detector scanned only CSS findings; it does not see motion quality, hover stickiness (86 `:hover` outside `@media (hover:hover)`), or layout/RTL bugs. Those need critique/audit passes with screenshots.
