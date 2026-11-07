# Design

Direction ("Design Read"): chat-first product UI for Persian friends, Telegram layout and behavior with iOS Liquid Glass surfaces. Taste dials: density 6 (daily app), layout variance 2 (predictable, symmetric, familiar), motion 5 (fluid CSS, no choreography). Do not apply taste-skill's landing-page defaults (variance 8, scroll scenes, hero sections) to this app.

## Constraints that override any skill
- Glass: translucent fill + thin bright rim + lens refraction on Chromium (`src/lens.js`). Elements with `.lens-on` must not have an outer `box-shadow`. See `docs/UI-GUIDE.md`.
- Themes: `data-theme` dark | light | oled; `data-palette` navy (default) | green | blue | generated. Colors come from tokens (`--bg --surface* --ink --muted --accent* --mine --bubble-other --glass`), never hard-coded per component.
- Fonts: Vazirmatn (Persian) + Inter (Latin) only, via one font token.
- All user-visible strings via `tr('فارسی')` + `en.js`; RTL layout; use logical properties (`inline-start/end`).
- Hover styles only inside `@media (hover:hover)`.
- Old CSS layers use `!important`; new rules go in the newest layer or a new `tokens.css`/`components.css`; screenshot every screen before deleting old rules.

## Motion rules (from Emil Kowalski skills, adapted)
- Never `ease-in` and never overshoot/bounce on UI. Enter/exit = ease-out; on-screen movement = ease-in-out; hover/color = ease; progress = linear.
- Durations: 100 ms press feedback, 160 ms small state change, 240 ms popovers/menus, 320 ms sheets/pages. Over 320 ms needs a reason.
- Animate `transform` and `opacity` only. No `transition: all`. No `scale(0)` entrances (start at `scale(.95)` + opacity).
- Re-triggerable motion uses CSS transitions, not keyframes (transitions retarget mid-flight). Gesture-driven motion (swipe reply, sheets) uses interruptible springs/JS.
- Popovers scale from their trigger point (`transform-origin`), not from center.
- Buttons and tappable rows get `:active` press feedback (`scale(.97)`).
- Frequent actions (typing, sending a message, scrolling the timeline, keyboard shortcuts) get no animation.
- Every animation has a `prefers-reduced-motion` fallback.

## Scales to introduce (stage 1, `tokens.css`)
Type: about 8 sizes. Radius: 6 steps + pill. z-index: named layers (base, sticky, pinbar, menu, sheet, dialog, toast, lightbox). Spacing: 4 px base. Easing and duration tokens as above.
