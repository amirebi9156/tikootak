# UI guide: styling, theming, gestures, i18n

## CSS layers (load order in `web-src/src/main.jsx`; later wins)
`styles.css` (base, 2020s structure) → `theme.css` (2000+ lines, tokens + old Telegram-ish look) → `ui34.css` → `tg.css` (palette blocks, `.timeline` wallpaper rule) → `q.css` (message menu, composer, attach menu, emoji panel/dock, FAB, round avatars) → `lg.css` (header pills, pinned card, composer pill, bubbles) → `design.css` (**newest; glass material, bubbles, music cards, Now Playing, auto lens**). Many rules use `!important`; to override, add to `design.css` with equal/greater specificity. Do not delete old layers without screenshotting every screen.

## Theming (look.js, ChatLook.jsx)
`data-theme` = dark | light | oled; `data-palette` = navy (default) | green | blue | gen (generated from one hex: purple/orange/rose/teal/custom via `buildVars`). Tokens: `--bg --surface* --ink --muted --accent* --mine --mine-2 --bubble-other --glass --tg-wall --tg-pat`. Look settings persist in `localStorage tikootak.look` (`DEFAULT` in look.js: navy, wall `dusk`, radius 20, font size 15, gradient bubbles). Wallpapers: built-in SVG data-URIs (dusk/aurora/peaks), dots/lines/grad/plain, or user image; applied as `--wall-bg/--wall-size` on `.chat`.
Palette fonts: Vazirmatn (Persian) + Inter (Latin) from `web-src/public/fonts`.

## Glass system
1. **Material** (design.css): translucent gradient fill + `backdrop-filter: blur saturate` + gradient 1px rim drawn with `::before` + mask-composite + soft specular `::after`. Classes: `.lg`, `.pinbar`, `.chat .day`, `.scroll-down`, `.chat .older`, header pills `.hp`.
2. **Lens (Chromium only)** `lens.js`: SVG `feDisplacementMap` built from a canvas map of the rounded-rect signed distance (edge refraction + slight chromatic aberration). `useLens(ref)` for single windows (Now Playing); `initAutoLens()` finds elements by selector list `AUTO`, shares one filter per unique size, sets `--lens` and class `lens-on`. Off with `localStorage tikootak.glass=lite` or `prefers-reduced-transparency`.
   Hard-won rules: (a) an element with an outer `box-shadow` shifts the filter origin → put the drop shadow on a sibling (`.np-shadow`) and keep only inset shadows on lens elements; (b) decode the map image before attaching the filter or the first paint uses a transparent map; (c) set the filter region larger than the element (`userSpaceOnUse x=-40 y=-40 w+80 h+80`); (d) `glass.js` older "full" noise-displacement mode produced white smears — disabled unless `tikootak.glass=full`.
3. Reference look: iOS Liquid Glass (clear fill, bright thin rim, bent background at the edges) over a colorful background; Telegram layout/behaviour for chat.

## Chat interaction rules
- Reply: swipe a message toward the center (`swipeReply.js`, threshold 64px with resistance), double-click on desktop, wheel deltaX ≥ 120. Swipe also works from blank space beside a message; tapping blank space opens the context menu. In channels members cannot reply (swipe outward = forward).
- Context menu (`ContextMenu.jsx`): popover at the tap point, reaction pill above, card below, clamped to viewport, no background blur. Items hidden by permissions (`canPost`, pin power level).
- Emoji/sticker panel: phones → docked panel replaces the keyboard (`.emoji-dock`, `kbH`); desktop → popover.
- Back button: `backstack.js` layers (menu → panel → chat). Use `useBackLayer(open, close)` for any new overlay.
- `msgGestures.js`: gesture helpers for messages (read it before touching long-press/selection behaviour).

## i18n
All strings are written in Persian inside `tr('…')` (`i18n.js`); English lives in `en.js`. Add with `python3 web-src/add-en.py '{"فارسی":"English"}'`, verify with `node web-src/check-i18n.mjs` (CI runs it). The layout is RTL; code and logs are English.

## Testing the UI
`tests/e2e/*.mjs` (Playwright, Chromium) + `tests/env/` (local Synapse + gateway + proxy; see CLAUDE.md). Screenshot checks: `liquid-glass-shots.mjs`, `composer-shots.mjs`. Touch tests use CDP `Input.dispatchTouchEvent` (touchstart has no clientY → read `touches[0]`). After a UI change run the regression script and look at screenshots; say honestly that real phones were not tested.
