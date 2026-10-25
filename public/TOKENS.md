# Survey tokens: cheat sheet

`tokens.css` holds every value. `styles.css` holds the base layer and the chrome. DESIGN.md is the source of truth; this is the short list of names.

## Load order
`index.html` loads the fonts (Archivo `wdth.css`, Newsreader `opsz.css` + `opsz-italic.css`, JetBrains Mono), then `tokens.css`, `styles.css`, `studio/studio.css`.

## Theme
- Light is the default. Dark ("night chart") applies with `data-theme="dark"` on `<html>`, or with no `data-theme` when the OS asks for dark. Stored in `localStorage['nb.theme']` as `light` / `dark`.
- `ctx.toggleTheme()` flips with transitions frozen. `effectiveTheme()` and `syncTheme()` live in `ui/chrome.js`.
- `data-contrast="high"` (or OS `prefers-contrast: more`) is High contrast. `data-motion="reduce"` forces reduced motion.

## Colour
| Use | Tokens |
|---|---|
| grounds | `--paper` page, `--paper-2` rail/panels/bars, `--paper-3` hover/selected, `--well` code |
| lines | `--rule` hairline, `--rule-strong` control border / neatline outer |
| text | `--ink`, `--ink-2` labels, `--ink-3` meta/paths, `--ink-4` placeholder/disabled |
| accent (vermilion, rare) | `--accent`, `--accent-wash` |
| status | `--verified` `--verified-wash`, `--moved` `--moved-wash` `--moved-line`, `--unverified` (= accent) `--unverified-wash`, `--pending` |
| contours | `--contour` |
| syntax | `--syn-text` `--syn-keyword` `--syn-type` `--syn-string` `--syn-number` `--syn-comment` `--syn-fn` |
| floating | `--float` (the one shadow), `--scrim` |

Never `--ink` text on `--accent`. Primary button is `--ink` ground with `--paper` text.

## Layers and groups
- Per layer (`water heath spruce sand moor lichen clay dusk`): `--<layer>-fill`, `-band`, `-band-strong`, `-mid`, `-ink`, plus `--hatch-<layer>` and `--hatch-<layer>-dense` (full `background` values).
- Put `data-layer="water"` on an element, then read `--l-fill --l-band --l-band-strong --l-mid --l-ink --l-hatch`. Add `data-dense` for the half-pitch hatch.
- Studio: `data-group="plan|visual|agent|learn|code"` gives `--g-fill --g-band --g-band-strong --g-mid --g-ink --g-hatch` (clay, heath, spruce, water, sand).
- Classes: `.hatch` (reads `--l-hatch` / `--g-hatch`), `.hatch-water` etc., `.swatch` (18 x 12 legend swatch, `.swatch.sm` 10 x 10).

## Type
- Families: `--font-ui` (Archivo), `--font-read` (Newsreader), `--font-mono` (JetBrains Mono). Archivo width: `font-stretch: var(--wdth-ui | --wdth-map | --wdth-wide)` (100 / 118 / 125%).
- Font shorthands: `--type-wordmark cover-xl cover-md kicker ui ui-strong ui-sm ui-title headline headline-sm doc-h2 doc-h3 read read-sm quote numeral-xl numeral-md code mono mono-sm kbd` (e.g. `font: var(--type-kicker)`). Weights already carry the dark compensation (`--w-ui --w-read --w-mono`).
- Classes that also set tracking, width and case: `.t-wordmark .t-cover-xl .t-cover-md .t-kicker .t-ui .t-ui-strong .t-ui-sm .t-ui-title .t-headline .t-headline-sm .t-doc-h2 .t-doc-h3 .t-read .t-read-sm .t-quote .t-numeral-xl .t-numeral-md .t-code .t-mono .t-mono-sm`.
- `--measure: 68ch` for prose.

## Space, frame, shape
- Spacing: `--s-0` 0, `--s-1` 2, `--s-2` 4, `--s-3` 6, `--s-4` 8, `--s-5` 12, `--s-6` 16, `--s-7` 20, `--s-8` 24, `--s-9` 32, `--s-10` 40, `--s-11` 48, `--s-12` 64, `--s-13` 80. Rows: `--row-dense` 28, `--row-comfy` 36.
- Frame: `--topbar-h` 48, `--keystrip-h` 28, `--rail-w` 248 (user width in `--rail-w-user`), `--gutter-w` 40, `--column-w` 660, `--column-gap` 36, `--margin-w` 300, `--content-w` 1036, `--drawer-w`.
- Radii: `--r-0` 0, `--r-1` 2 chips/kbd, `--r-2` 4 buttons/inputs, `--r-3` 6 cards/menus/toasts, `--r-4` 8 palette/dialogs/composer, `--r-full`.
- Borders: `--hairline`, `--control-border`. `.neatline` (set `--surface` if the ground is not `--paper`), `.double-rule`.

## Motion
`--d-0` 0, `--d-1` 120 hover/press, `--d-2` 160 popover in (`--d-2-out` 100), `--d-3` 200 stamp, `--d-4` 320 drawer in (`--d-4-out` 200), `--d-5` 420 print, `--d-fade` 120 (kept under reduced motion). Easings `--ease-out`, `--ease-drawer`, `--ease-linear`. Reduced motion zeroes `--d-1` to `--d-5`, so use the tokens and it comes for free. Keyboard actions never animate.

## Ready-made parts in styles.css
- Buttons: `.btn` secondary, `.btn.primary` (alias `.btn.go`), `.btn.ghost` / `.btn.quiet`, `.btn.danger` / `.btn.destructive`, `.btn.link`, `.btn.scrutiny`, `.icon-btn` (28 x 28). Trailing `<kbd>` inside a button is styled.
- Inputs: `.input`, `.textarea` (`.mono`), `.select`, `.field-label`, `.field-error`, `.switch` (role=switch, aria-checked; on colour is `--l-mid`), `.checkbox`, `.segmented`.
- `kbd`, status classes `.st-verified .st-moved .st-unverified .st-pending` (set `--st` and `--st-wash`, colour a child svg), `.glyph` / `.glyph.sm`, `.sdot` (`.ok .warn .bad`), `.segbar` (`<i class="on">`, `<i class="cur">`, `.fill` for wide slots).
- Marks: `/marks.svg#mark #verified #moved #unverified #pending` via `<svg viewBox="0 0 16 16" class="glyph"><use href="/marks.svg#moved"/></svg>`.

## Chrome hooks (index.html, ui/chrome.js)
- Top bar: `#tb-notebook` (switcher, drawn by chrome.js), `#tb-crumb` (breadcrumb; add a `.qnum` span for the question number), `#tb-receipt` (empty, for the mini receipt), `#tb-palette`, `#tb-index`, `#tb-run` (hidden; running-recipe chip, use `.sdot` inside), `#tb-theme`.
- Key strip: replace the children of `#ks-hints` for the focused pane (`<span class="t-kicker">Page</span>` then `<span class="ks"><kbd>J</kbd>next claim</span>`). The status legend on the right is static.

## Legacy aliases (temporary)
`styles.css` starts with a block that maps old Cotton/Dusk names (`--text`, `--line`, `--glass`, `--card`, `--h/--hi/--hs`, `--peach`..., `--hl-*`, `--r1`..., `--s1`..., `--shadow-*`, `--hue-fill`, `--font-display`) onto Survey tokens so unrebuilt components keep rendering. Do not use them in new code. When you rebuild a component, use Survey names and delete aliases nothing reads any more. `studio/studio.css` still reads `var(--accent)` as a pastel fill, which is now vermilion; the renderer rebuild should drop that. `studio/graph.js` and `studio/common.js` measure text with `"Inter Variable"`, which is no longer installed; switch them to Archivo.
