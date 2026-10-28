# Lectern design system: "Survey"

This is the whole design system for Lectern. It is meant to be enough to build every screen without asking a question. Where it gives a number, use the number. Where it says never, it means never. The screen list with exact content is in `SCREENS.md` next to this file.

App facts it assumes: vanilla JS front end in `public/` (`ui/*.js`, `studio/*.js`, `styles.css`), self-hosted fonts through `@fontsource-variable`, renderers for six artifact kinds (`doc`, `graph`, `sequence`, `plan`, `quiz`, `file`), and 24 Studio recipes in `lib/studio/recipes.mjs`.

---

## 0. My design decisions

**Direction: Survey.** I wanted Lectern to look like nothing else a developer has open in a day, so it looks and behaves like an ordnance survey of your sources. Every claim is a benchmark checked against the ground, sources are map layers with pastel tints and hatches, and Studio outputs are numbered sheets in a series. "Ground truth" is the product's promise in the field's own words, and one mark (the benchmark) is the logo, the verification glyph and the receipt.

Two other directions I sketched gave it most of the daily screen:

- **The reading surface.** The left gutter of proof marks, the big-numeral receipt, the 66ch Newsreader column, light code on paper with a provenance caption, the italic second sentence in the question headline, and the scrutiny link. I want a page I can read for hours.
- **The working grammar.** The J/K claim cursor, the key strip along the bottom edge, live version and branch state on code sources with real scope toggles, the UNCITED count, and a lit, non-blocking running recipe with segment progress.

A third had a loud display voice with riso overprint. It lives only on Studio sheet covers, exports and the one print moment.

The rules I settled on, and why:

1. **No vermilion Ask button.** The primary button is solid ink with paper text. Vermilion means "look here" and is reserved for the mark, kickers, sheet numbers and unverified. A bright CTA would be the loudest thing on a reading screen.
2. **Plain words first.** Buttons and headers say Ask, Sources, History, Citations, Trail. Survey words (benchmark, layer, sheet) show up in the visual language and in onboarding, never as a label you have to translate. "survey" is a palette alias for Ask.
3. **Three panes.** Rail, page (answer plus its margin) and drawers. Studio is a full view (`P`) and never a permanent fourth column, so the answer keeps 660px at 1440 wide.
4. **The Studio sheet index is a map, and its labels sit on solid fills.** Contour lines run only in the gutters between cells and on sheet covers, never under text.
5. **24 recipes.** `lib/studio/recipes.mjs` has 24 ids (5 plan, 5 visual, 4 agent, 6 learn, 4 code). Every count in the UI is computed from the recipe table and never typed.
6. **No Bodoni.** Its hairlines fail at 1x on Windows. Newsreader at display optical size does the headline and receipt numerals and holds up at every size.
7. **JetBrains Mono for code.** It is already installed, it is dense, and it has tabular figures and a distinct zero.
8. **No Fraunces, no Inter.** Fraunces SOFT/WONK is the cute-AI-app look, and Inter on its own reads as generic.
9. **No pastel glass.** No backdrop blur, mesh blobs or soft layered shadows anywhere. Surfaces are paper with hairlines, tints and hatches, and the group hues are in OKLCH.

---

## 1. Concept and voice

### The idea in one paragraph
A surveyor checks every benchmark against the land, writes it in a field book and publishes the result as numbered sheets. Lectern does the same to answers. Each citation is a benchmark: it is either **verified** (the quote was found again at that file and line), **moved** (the same text was found at another line, shown), or **unverified** (not found). A sentence with no citation is **uncited** and carries no mark, which is itself information. Sources are **layers** in a legend, each with one pastel tint and one hatch. The tint means the same source everywhere: legend swatch, claim underline, citation chip, margin card edge, scope chip, graph node. The agent's tool steps are the **trail**. Studio prints the notebook as **sheets**.

### Why it is unmistakable
Nobody else draws a benchmark glyph beside every claim, colours claims by the layer they came from, or prints answers as numbered sheets over contour lines. At thumbnail size you see: warm paper, a vermilion broad-arrow mark, a column of small glyphs in a left gutter, pastel swatches with hatching in a legend, wide-tracked map caps. That combination belongs to Lectern.

### Two speeds (the core rule)
Character goes where usage is rare. Calm goes where usage is constant.

| Zone | How often | Voice |
|---|---|---|
| Reading column, composer, palette, source list, code | hundreds of times a day | quiet. No texture, no animation on keyboard actions, chrome dimmed below content |
| Citation resolve, receipt count-up | every answer | one small honest beat (the stamp), under 200ms |
| Studio index, print finish, sheet covers, exports | a few times a day | full voice: contour relief, two-ink overprint, wide display caps |
| Onboarding, empty states, about | rare | jokes allowed, the mark drawn once |

### Voice
- Short, plain, sentence case. Say what happened in past tense with numbers: "Read 4 files, 2 searches, checked 3 citations, 4.1 s."
- Never "I". Never "thinking", "pondering", "let me". The app reports actions, not a mind.
- Never claim more than the receipt shows. No "100% cited", no "trusted", no "accurate".
- Name things by path: `networking/payload.md:92`, never "Source 3".
- Moved and unverified are said plainly and early: "Cited L92, found at L96. Same text." / "Quote not found in RegisterPayloadHandlersEvent.java."
- Jokes only in onboarding, empty states and the about sheet, and only one per screen.
- No exclamation marks anywhere. No em-dashes in product copy.

### Vocabulary
| UI label (primary) | Survey term (secondary, tooltips, onboarding, palette aliases) |
|---|---|
| Ask | survey |
| Sources | legend, layers |
| Citation, citations | benchmark, marks |
| verified / moved / unverified / uncited | recovered / relocated / not recovered / unmarked |
| Trail | traverse |
| History | field book |
| Question No. 047 | (answers are numbered; CLI `lectern show 047`) |
| Studio | sheet index |
| Sheet (a Studio output) | printed sheet |

---

## 2. Rules applied without exception

1. **One owned accent.** Survey vermilion. It appears on: the logo mark, kicker labels, sheet numbers, the scrutiny link, unverified status, destructive confirm. Nothing else is vermilion.
2. **Every colour has one job.** Layer tints name sources. Status inks name verification state. Group tints name Studio recipe groups, and only on Studio surfaces (index cells, sheet covers, artifact header tab). Nothing is coloured for decoration.
3. **Status is always glyph plus colour plus word.** Never colour alone.
4. **Every claim with a citation gets a gutter mark. Uncited sentences get none.**
5. **The reading column never has texture, shadow or tint behind it**, except the claim bands defined in 11.6.
6. **Keyboard actions never animate.**
7. **Everything local lands under 100ms.** Palette, navigation, hover cards (prefetched), pane switches.
8. **Prose measure is capped at 68ch.** Extra width goes to the margin and drawers.

---

## 3. Colour

All colours are defined in OKLCH and shipped as CSS custom properties. Hex is the sRGB rendering of the same value, for tools and fallbacks. Contrast was computed from these exact hex values (WCAG 2.x ratio and APCA Lc, script at `gen/tokens.mjs`, output in `gen/out.txt`).

### 3.1 Core tokens

| Token | Role | Light OKLCH | Light hex | Dark OKLCH | Dark hex |
|---|---|---|---|---|---|
| `--paper` | app ground, reading page | oklch(0.985 0.006 85) | #FCFAF6 | oklch(0.195 0.018 252) | #0F161D |
| `--paper-2` | rail, margin, panels, top bar | oklch(0.966 0.010 84) | #F7F3EC | oklch(0.225 0.020 252) | #151C25 |
| `--paper-3` | hover row, selected row, pressed | oklch(0.940 0.014 82) | #F0EAE1 | oklch(0.265 0.022 252) | #1D2630 |
| `--well` | code ground (sea-tinted well) | oklch(0.958 0.012 220) | #E9F3F7 | oklch(0.165 0.016 240) | #080F15 |
| `--rule` | hairlines, dividers | oklch(0.890 0.014 80) | #E0DAD1 | oklch(0.360 0.020 252) | #363E48 |
| `--rule-strong` | input borders, neatline outer | oklch(0.800 0.016 75) | #C4BCB3 | oklch(0.470 0.020 252) | #535C66 |
| `--ink` | body text, headlines, primary button ground | oklch(0.240 0.018 60) | #261D17 | oklch(0.930 0.012 85) | #EBE7DF |
| `--ink-2` | secondary text, UI labels | oklch(0.400 0.018 60) | #4F463E | oklch(0.850 0.012 85) | #D1CDC5 |
| `--ink-3` | metadata, paths, counts, kbd | oklch(0.500 0.016 62) | #6A615A | oklch(0.760 0.012 85) | #B4B1A9 |
| `--ink-4` | placeholder, disabled, pending | oklch(0.640 0.012 65) | #918B85 | oklch(0.610 0.012 85) | #86837B |
| `--accent` | survey vermilion | oklch(0.540 0.180 31) | #C13522 | oklch(0.780 0.140 38) | #FF9674 |
| `--accent-wash` | accent tint ground | oklch(0.950 0.030 31) | #FFE8E2 | oklch(0.280 0.050 31) | #3E1F19 |
| `--contour` | contour lines (Studio, covers, top bar corner) | oklch(0.860 0.030 75) | #DDCFBC | oklch(0.400 0.025 250) | #3E4955 |

Dark mode is the **night chart**: ink-blue paper, warm paper-white ink, same hues at higher lightness. It is designed, not inverted. Higher surfaces are lighter (`paper` < `paper-2` < `paper-3`). The code well goes darker than paper in dark mode and slightly tinted in light mode, so code always sits in its own inset.

### 3.2 Status tokens

| Token | Light OKLCH | Light hex | Dark OKLCH | Dark hex |
|---|---|---|---|---|
| `--verified` (ink, glyph) | oklch(0.470 0.110 150) | #206B38 | oklch(0.780 0.120 150) | #7CCD8E |
| `--verified-wash` | oklch(0.950 0.035 150) | #DFF6E2 | oklch(0.270 0.045 150) | #152D1A |
| `--moved` (ink, glyph) | oklch(0.500 0.110 65) | #8D5406 | oklch(0.820 0.120 80) | #EDBB64 |
| `--moved-wash` | oklch(0.935 0.065 85) | #FEE7B8 | oklch(0.300 0.055 80) | #3C2A07 |
| `--moved-line` (dashed underline, non-text) | oklch(0.740 0.130 75) | #DA9E3F | oklch(0.700 0.120 75) | #CA933E |
| `--unverified` (ink, glyph) | = `--accent` | #C13522 | = `--accent` | #FF9674 |
| `--unverified-wash` | oklch(0.945 0.035 28) | #FFE5E0 | oklch(0.290 0.055 28) | #43201C |
| `--pending` | = `--ink-4` | #918B85 | = `--ink-4` | #86837B |

Unverified shares the accent on purpose: vermilion means "the surveyor's attention goes here." No other element competes with it because the accent is used so sparingly.

### 3.3 Layer tints (sources)

Eight layers. Each has five steps. All fills sit at the same OKLCH lightness so no source looks more important than another. Each layer also has a hatch (section 6.2) so identity survives grayscale and colour blindness.

Steps: `fill` (swatch, chip ground) L 0.925 C 0.045. `band` (claim highlight, default) L 0.950 C 0.032. `band-strong` (claim under cursor or hover) L 0.905 C 0.060. `mid` (underline, hatch strokes, card edge, graph node border) L 0.780 C 0.080. `ink` (chip text, layer label) L 0.440 C 0.090.
Dark: `fill` L 0.330 C 0.055, `band` L 0.285 C 0.045, `band-strong` L 0.350 C 0.070, `mid` L 0.620 C 0.090, `ink` L 0.860 C 0.060.

| Layer | Hue | Hatch | Light fill / band / band-strong / mid / ink | Dark fill / band / band-strong / mid / ink |
|---|---|---|---|---|
| water | 235 | horizontal lines | #CAECFF / #DBF3FF / #BAE7FF / #84C0E4 / #09597D | #143A4E / #102E3D / #07405A / #4A8FB5 / #ABD8F3 |
| heath | 305 | 45 deg lines | #EDDFFF / #F3EAFF / #E9D6FF / #C3ABE1 / #5E457A | #3C2E4C / #2F243C / #433058 / #9378B2 / #DAC8F1 |
| spruce | 190 | rings (woodland) | #C5F0ED / #D7F6F3 / #B2EDE8 / #77C8C3 / #00625D | #043E3C / #06312F / #004643 / #359792 / #A4DEDA |
| sand | 80 | stipple dots | #F6E4C5 / #FAEDD7 / #F5DCB3 / #D2B27C / #6C4C02 | #443210 / #36270E / #4D3603 / #A38043 / #E6CDA5 |
| moor | 350 | crosshatch | #FFDBEA / #FFE6F1 / #FFD0E5 / #DFA3BF / #773C59 | #4A2939 / #3B212D / #552A40 / #AF6F8E / #F1C2D6 |
| lichen | 115 | vertical lines | #E5EAC9 / #EDF1D9 / #DEE5B8 / #B5BE82 / #515812 | #343915 / #292D11 / #3A3E0C / #848D4B / #CFD6AA |
| clay | 50 | -45 deg lines | #FFDECC / #FFE9DC / #FFD5BD / #E2A989 / #794220 | #4C2C1A / #3C2315 / #572E16 / #B27654 / #F2C6AE |
| dusk | 270 | dashes (street hatch) | #DAE6FF / #E6EEFF / #D0DFFF / #A3B5EB / #3F4F84 | #2A3452 / #212941 / #2C385F / #7183BD / #C1D0F9 |

OKLCH for any step: `oklch(L C H)` with the L/C above and the layer hue, e.g. water band-strong light is `oklch(0.905 0.060 235)`.

**Assignment.** Layers are assigned per notebook when a source is added and stored on the source record (`layer: 'water'`). Default order by source kind:
- Pinned docs: water, then heath, then dusk.
- Primers and notes: heath (if free), else lichen.
- Code roots (libraries): spruce, sand, lichen, clay.
- Your repo (a root marked `own: true`): moor, always.
- More than eight sources: reuse a hue with a second hatch variant (dense version of the hatch: half the pitch). Never invent a ninth hue.
The user can change a source's layer from the source row menu.

**First notebook assignment:** NeoForge docs = water, Porting primers = heath, neoforge src = spruce, geckolib src = sand, Well Thats Grading = moor.

### 3.4 Studio group tints

Studio groups reuse layer hues because they never appear on the same surface as source colours (Studio index, sheet covers, artifact header tab only). Inside an artifact, citations still use source layers.

| Group | Recipes | Tint |
|---|---|---|
| plan | prd, tech-spec, impl-plan, adr, test-plan | clay |
| visual | code-map, concept-map, flow-diagram, sequence-diagram, dependency-graph | heath |
| agent | claude-md, agents-md, skill, agent-quiz | spruce |
| learn | onboarding, cheat-sheet, porting-guide, gotchas, glossary, flashcards | water |
| code | gap-report, diff-review, build-x, release-notes | sand |

### 3.5 Code syntax (on `--well`)

| Token | Use | Light | Dark |
|---|---|---|---|
| `--syn-text` | default | = `--ink` #261D17 | = `--ink` #EBE7DF |
| `--syn-keyword` | keywords, modifiers | oklch(0.450 0.130 305) #663E8E | oklch(0.800 0.100 305) #CDAEF2 |
| `--syn-type` | types, classes, annotations | oklch(0.450 0.100 235) #005D84 | oklch(0.800 0.080 235) #8AC7EA |
| `--syn-string` | strings, chars | oklch(0.470 0.080 190) #056965 | oklch(0.810 0.080 190) #81D2CC |
| `--syn-number` | numbers, constants, enum values | oklch(0.500 0.120 50) #984B16 | oklch(0.820 0.100 55) #F7B385 |
| `--syn-comment` | comments, italic | = `--ink-3` | = `--ink-3` |
| `--syn-fn` | method calls | = `--ink` weight 500 | = `--ink` weight 500 |

Map highlight.js classes to these (`hljs-keyword`, `hljs-built_in` -> keyword; `hljs-type`, `hljs-title.class_`, `hljs-meta` -> type; `hljs-string` -> string; `hljs-number`, `hljs-literal` -> number; `hljs-comment` -> comment; `hljs-title.function_` -> fn).

### 3.6 Measured contrast (every text pairing in use)

WCAG ratio / APCA Lc (absolute). Target: body text Lc 75+ and 7:1; metadata Lc 60+ and 4.5:1; placeholder Lc 30+.

| Text on ground | Light | Dark | Used for |
|---|---|---|---|
| ink on paper | 15.85 / 100.6 | 14.77 / 91.6 | prose, headline |
| ink on paper-2 | 14.94 / 96.5 | 13.90 / 91.0 | rail, margin text |
| ink on paper-3 | 13.82 / 91.4 | 12.41 / 89.5 | selected rows |
| ink-2 on paper | 8.84 / 88.4 | 11.49 / 75.6 | UI labels |
| ink-2 on paper-2 | 8.33 / 84.3 | 10.82 / 74.9 | rail labels |
| ink-2 on paper-3 | 7.71 / 79.2 | 9.66 / 73.5 | selected labels |
| ink-3 on paper | 5.80 / 77.3 | 8.50 / 59.3 | paths, counts, meta |
| ink-3 on paper-2 | 5.47 / 73.3 | 8.00 / 58.6 | rail meta |
| ink-3 on paper-3 | 5.06 / 68.2 | 7.14 / 57.2 | meta in selected rows |
| ink-4 on paper | 3.23 / 58.2 | 4.81 / 35.4 | placeholder, disabled only |
| ink-4 on paper-2 | 3.04 / 54.2 | 4.53 / 34.7 | placeholder in rail |
| accent on paper | 5.30 / 73.4 | 8.56 / 60.0 | kickers, sheet numbers, scrutiny link |
| accent on paper-2 | 5.00 / 69.4 | 8.06 / 59.3 | kickers on panels |
| accent on paper-3 | 4.62 / 64.2 | 7.19 / 57.9 | accent in selected row (avoid if possible) |
| verified on paper | 6.25 / 79.1 | 9.52 / 65.2 | status word, glyph |
| verified on paper-2 | 5.89 / 75.0 | 8.97 / 64.6 | margin status |
| moved on paper | 5.92 / 77.5 | 10.32 / 69.5 | status word, glyph, line label |
| moved on paper-2 | 5.58 / 73.5 | 9.71 / 68.9 | margin status |
| ink on moved-wash | 13.65 / 90.6 | 11.16 / 87.9 | prose under moved band |
| moved on moved-wash | 5.09 / 67.6 | 7.79 / 65.8 | moved chip label |
| ink on unverified-wash | 13.80 / 91.3 | 11.65 / 88.5 | prose under unverified band |
| accent on unverified-wash | 4.61 / 64.2 | 6.75 / 56.8 | unverified chip label |
| ink on verified-wash | 14.50 / 94.5 | 11.97 / 89.0 | verified toast, banner |
| verified on verified-wash | 5.72 / 73.0 | 7.72 / 62.6 | verified pill |
| ink on accent-wash | 14.08 / 92.6 | 12.04 / 89.0 | error banner body |
| accent on accent-wash | 4.71 / 65.5 | 6.97 / 57.3 | error banner title |
| paper on ink | 15.85 / 102.7 | 14.77 / 90.9 | primary button (Ask) |
| paper on accent | 5.30 / 78.4 | 8.56 / 61.4 | destructive confirm button |
| ink on well | 14.66 / 95.3 | 15.63 / 92.1 | code |
| ink-3 on well | 5.37 / 72.0 | 9.00 / 59.8 | line numbers, comments |
| syn-keyword on well | 7.04 / 79.0 | 10.03 / 65.4 | |
| syn-type on well | 6.43 / 76.4 | 10.50 / 67.9 | |
| syn-string on well | 5.79 / 73.7 | 11.04 / 70.7 | |
| syn-number on well | 5.56 / 72.5 | 10.78 / 69.4 | |
| ink on any layer band | 14.04 to 14.46 / 92+ | 11.44 to 11.84 / 88+ | prose under claim band |
| ink on any layer band-strong | 12.13 to 12.73 / 83+ | 8.70 to 9.51 / 83+ | prose under cursor band |
| ink on any layer fill | 13.04 to 13.43 / 87+ | 9.68 to 10.21 / 85+ | swatch labels, sheet cells |
| layer ink on its fill | 5.87 to 6.44 / 70.7+ | 7.94 to 8.05 / 71+ | citation chip numeral, scope chips |
| layer ink on paper | 6.93 to 7.82 / 81.7+ | 11.65 to 12.18 / 76+ | layer names in legend |

Forbidden pairing: **ink on accent** (2.99:1 light, 1.73:1 dark). Never put dark text on vermilion.

Non-text contrast (graphics, UI boundaries; 3:1 needed only where the boundary is the only cue):

| Element | Light | Dark | Note |
|---|---|---|---|
| rule on paper | 1.33 | 1.68 | decorative divider only, never the sole affordance |
| rule-strong on paper | 1.80 | 2.68 | input border; inputs also carry a label and a placeholder |
| layer mid on paper | 1.86 to 1.99 | 4.76 to 5.20 | underline in light is paired with the band fill and the chip, so it is never the sole cue |
| moved-line on paper | 2.25 | 6.73 | always paired with the moved glyph and wash |
| status glyphs at 16px | = status ink ratios above (5.3 to 10.3) | | pass 3:1 graphics contrast in both themes |
| focus ring (ink, 2px) | 15.85 | 14.77 | |

### 3.7 Contrast dial
Settings has one control, **Contrast: Standard / High**. High mode rewrites: `--ink-2` = `--ink`, `--ink-3` = light oklch(0.400 0.018 60) / dark oklch(0.850 0.012 85), `--ink-4` = old `--ink-3`, `--rule` = `--rule-strong`, `--rule-strong` = `--ink-3`, layer `mid` L -0.12 (light) / +0.10 (dark), band fills off (claims use mid underline 2px only). Also enabled automatically under `@media (prefers-contrast: more)`.

### 3.8 P3
Inside `@media (color-gamut: p3)`, raise chroma on the small marks only: `--accent` C 0.22, `--verified` C 0.15, `--moved` C 0.14, layer `ink` C 0.12. Fills and bands stay as they are.

---

## 4. Type

### 4.1 Families and roles

| Family | Package | Role | Never |
|---|---|---|---|
| **Archivo** variable (wght 100 to 900, wdth 62 to 125) | `@fontsource-variable/archivo` (import the `wdth` stylesheet so the width axis is present) | UI chrome at wdth 100; map lettering (wide-tracked caps) at wdth 118 to 125; sheet cover titles at wdth 125 weight 800 | body prose, code |
| **Newsreader** variable (wght 200 to 800, opsz 6 to 72, italic) | `@fontsource-variable/newsreader` (import the `opsz` and `opsz-italic` stylesheets) | question headline, answer prose, doc artifacts, margin quotes (italic), receipt numerals (display opsz) | UI labels under 13px, buttons |
| **JetBrains Mono** variable (wght 100 to 800) | `@fontsource-variable/jetbrains-mono` (installed) | code, paths, path:line, counts, trail, kbd, timestamps | prose |

Remove `@fontsource-variable/fraunces` and `@fontsource-variable/inter` from `index.html` and `package.json`.

Font stacks:
```css
--font-ui:   "Archivo Variable", "Archivo", system-ui, sans-serif;
--font-read: "Newsreader Variable", "Newsreader", Georgia, serif;
--font-mono: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Consolas, monospace;
```

Global: `font-optical-sizing: auto` for Newsreader (opsz follows px size). `font-kerning: normal`. Mono always `font-variant-numeric: tabular-nums slashed-zero` (JetBrains zero is already distinct; keep `"zero" 1` off). Any number that updates or aligns in UI or prose (counts, line numbers, timestamps, receipt) gets `tabular-nums`.

### 4.2 Scale

Line heights are absolute px so baselines stay on a 4px grid.

| Token | Family | Size / line | Weight | Width / opsz | Tracking | Case | Use |
|---|---|---|---|---|---|---|---|
| `wordmark` | Archivo | 15 / 20 | 700 | wdth 125 | 0.22em | upper | LECTERN in top bar |
| `cover-xl` | Archivo | 56 / 56 | 800 | wdth 125 | 0.01em | upper | sheet cover title (Studio artifact header, export cover) |
| `cover-md` | Archivo | 28 / 32 | 800 | wdth 125 | 0.02em | upper | onboarding title, sheet cell big number |
| `kicker` | Archivo | 11 / 16 | 620 | wdth 118 | 0.14em | upper | section kickers (QUESTION 047, SOURCES, CITATIONS, STUDIO), status words in margin |
| `ui` | Archivo | 13 / 20 | 450 | wdth 100 | 0 | sentence | default UI text, rows, menus, buttons |
| `ui-strong` | Archivo | 13 / 20 | 580 | wdth 100 | 0 | sentence | selected row, button labels, dialog titles at small size |
| `ui-sm` | Archivo | 12 / 16 | 450 | wdth 100 | 0.005em | sentence | secondary UI, legends |
| `ui-title` | Archivo | 16 / 24 | 600 | wdth 100 | -0.005em | sentence | dialog title, drawer title, palette group header is kicker not this |
| `headline` | Newsreader | 34 / 40 | 500 | opsz auto (34) | -0.012em | sentence | question as headline. Text after the first sentence is italic 400 |
| `headline-sm` | Newsreader | 26 / 32 | 500 | auto | -0.008em | sentence | headline at widths under 1280, artifact titles |
| `doc-h2` | Newsreader | 23 / 32 | 600 | auto | -0.005em | sentence | doc artifact H2 |
| `doc-h3` | Newsreader | 19 / 28 | 600 | auto | 0 | sentence | doc artifact H3 |
| `read` | Newsreader | 18.5 / 30 | 400 | auto (18.5) | 0.002em | sentence | answer and doc prose; max-width 68ch (about 660px) |
| `read-sm` | Newsreader | 16 / 26 | 400 | auto | 0.004em | sentence | prose in hover cards, flashcard backs, plan task detail |
| `quote` | Newsreader | 15 / 22 | 400 italic | auto | 0.004em | sentence | quoted text in margin cards and hover cards |
| `numeral-xl` | Newsreader | 44 / 44 | 400 | opsz 72 | -0.02em | | receipt numerals |
| `numeral-md` | Newsreader | 24 / 28 | 400 | opsz 60 | -0.01em | | progress counts on sheet covers, flashcard counter |
| `code` | JetBrains Mono | 13.5 / 22 | 430 | | 0 | | code blocks |
| `mono` | JetBrains Mono | 12.5 / 20 | 430 | | 0 | | inline code in prose is 0.88em of `read`; paths, trail, rail counts |
| `mono-sm` | JetBrains Mono | 11.5 / 16 | 450 | | 0.01em | | path:line in cards, timestamps, line labels in gutter |
| `kbd` | JetBrains Mono | 11 / 16 | 500 | | 0 | | key caps |

Dark weight compensation: Newsreader `read` 400 -> 380, `quote` 400 -> 380. Mono 430 -> 400. Archivo `ui` 450 -> 430. Headlines unchanged.

Inline code inside prose: mono 0.88em, `--ink`, ground `--paper-3` (light) / `--paper-3` (dark), padding 1px 4px, radius 2px, no border. Inside a claim band the inline code ground becomes transparent so the band reads continuous.

Hyphenation: prose uses `hyphens: manual`. Never justify. Ragged right.

Weights below 400 are banned in UI. Weight never changes on hover or selection (layout shift); selection uses background and the `ui-strong` weight is set only on rows that are selected by state, not by hover.

---

## 5. Space, layout, shape

### 5.1 Spacing scale (4px base)
`--s-0: 0` `--s-1: 2px` `--s-2: 4px` `--s-3: 6px` `--s-4: 8px` `--s-5: 12px` `--s-6: 16px` `--s-7: 20px` `--s-8: 24px` `--s-9: 32px` `--s-10: 40px` `--s-11: 48px` `--s-12: 64px` `--s-13: 80px`

Rows: dense list rows 28px (rail, palette, tree, menus). Comfortable rows 36px (history, printed sheets). Paragraph spacing in prose: 18px (0.6 of line). Section spacing in the page: 32px.

### 5.2 App frame (1440 x 900 reference)

```
+--------------------------------------------------------------------------------+
| top bar 48                                                                     |
+-----------+--------------------------------------------------------------------+
| rail 248  | page (scrolls)                                                     |
|           |   gutter 40 | column 660 | gap 36 | margin 300                     |
|           |                                                                    |
|           |   composer (pinned to bottom of page, spans gutter..margin)        |
+-----------+--------------------------------------------------------------------+
| key strip 28                                                                   |
+--------------------------------------------------------------------------------+
```

- **Top bar** 48px, `--paper-2`, 1px `--rule` bottom. Contents left to right: mark + LECTERN (padding-left 16), divider, notebook switcher, breadcrumb `> 047 Client-to-server packets`, flexible space, mini receipt, palette field (width 320), index status, running-recipe chip (only while a recipe runs), theme toggle. Contour corner: a static SVG of 5 contour lines in `--contour`, 1px, 260 x 48, anchored right, `pointer-events:none`, faded with a left-to-right mask so nothing sits on text.
- **Rail** 248px, `--paper-2`, 1px `--rule` right edge.
- **Page** `--paper`. The content block (gutter + column + gap + margin = 1036px) is left-aligned at 32px from the rail, not centred, so the margin stays near the right edge on wide screens.
- **Composer** pinned to the bottom of the page area, 24px from the key strip, width = content block, max 1036px.
- **Key strip** 28px, `--paper-2`, 1px `--rule` top.
- **Drawers** (source drawer, artifact detail) slide over from the right, width 640px (min(640px, 56vw)), `--paper`, 1px `--rule-strong` left edge plus the floating shadow.
- **Studio** is a full view in the page area (rail stays).

### 5.3 Breakpoints

| Width | Behaviour |
|---|---|
| 1600 and up | margin 340, column 680, gap 48 |
| 1280 to 1599 | reference layout above |
| 1024 to 1279 | margin folds: citations become hover/focus cards only, receipt lives in the top bar and at the head of the answer as one line; gutter marks stay; column fills to 68ch |
| 768 to 1023 | rail collapses to a 48px strip of layer swatches (expand with `Ctrl+B`, overlays at 248); top bar hides breadcrumb |
| under 768 | single column, 16px side gutters, rail and drawers become full-screen sheets, gutter marks move inline before each claim |

No horizontal page scroll at any width. Code blocks scroll horizontally inside their well.

### 5.4 Radii
Maps are crisp. Radii are small.
`--r-0: 0` panes, rules, sheet cells, code wells
`--r-1: 2px` chips, inline code, kbd, scope chips
`--r-2: 4px` buttons, inputs, menu items, toggles' track ends use full round
`--r-3: 6px` cards (margin exhibits, hover cards, printed sheet rows), toasts, menus
`--r-4: 8px` command palette, dialogs, composer
`--r-full: 999px` citation number circles, toggle track and thumb, status dots

### 5.5 Borders and the neatline
- Hairline: `1px solid var(--rule)`.
- Control border: `1px solid var(--rule-strong)`.
- **Neatline** (the map frame, used on: command palette, dialogs, sheet cells when selected, sheet covers, the receipt block, onboarding sheet): outer 1px `--rule-strong`, 3px of the surface colour, inner 1px `--rule`. CSS: `box-shadow: inset 0 0 0 1px var(--rule-strong), inset 0 0 0 4px var(--surface), inset 0 0 0 5px var(--rule);` where `--surface` is the element ground.
- Double rule (under the top of the receipt and sheet covers only): 2px `--ink` + 2px gap + 1px `--ink`.

### 5.6 Elevation (no shadows on resting surfaces)
Elevation is shown by surface step and hairline, not by shadow.

| Level | Surfaces | Treatment |
|---|---|---|
| 0 | page | `--paper` |
| 1 | rail, margin cards, composer, top bar, key strip | `--paper-2` or 1px `--rule` frame on `--paper` |
| 2 | floating: hover card, menu, palette, dialog, toast, drawer | ground `--paper` (light) / `--paper-2` (dark), border 1px `--rule-strong`, and the one allowed shadow |

The one allowed shadow, `--float`:
- Light: `0 1px 0 rgb(38 29 23 / 0.04), 0 10px 28px -10px rgb(38 29 23 / 0.22)`
- Dark: `0 1px 0 rgb(0 0 0 / 0.3), 0 12px 32px -8px rgb(0 0 0 / 0.55)`

Scrim behind dialogs and palette: light `rgb(38 29 23 / 0.18)`, dark `rgb(4 8 12 / 0.55)`. No blur. Ever.

Focus ring everywhere: `outline: 2px solid var(--ink); outline-offset: 2px;` On ink buttons: `outline-color: var(--ink); outline-offset: 2px` still (ring sits outside on paper). Inside cells with tinted ground, same ring.

---

## 6. The mark, hatches and texture

### 6.1 The benchmark mark
Lectern's own drawing of a surveyor's cut mark. Drawn on a 16-unit grid, stroke 1.75, butt caps, miter joins, `currentColor`.

```svg
<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="butt" stroke-linejoin="miter" aria-hidden="true">
  <path d="M3 3.5H13"/>          <!-- the bench (bar) -->
  <path d="M8 6V13.5"/>          <!-- stem -->
  <path d="M3.6 13.5L8 6L12.4 13.5"/> <!-- broad arrow legs -->
</svg>
```

Variants (all 16px in the gutter and in cards, 12px inline in the top-bar receipt):

| State | Drawing | Colour | Word |
|---|---|---|---|
| verified | the mark, solid | `--verified` | verified |
| moved | the mark plus a short arrow off its right foot (`M12.4 13.5 L15 11`) and the new line label in `mono-sm` beside it: `L96` | `--moved` | moved |
| unverified | no mark. A dashed circle r=6 (`stroke-dasharray: 2 2`) with a `?` inside in Archivo 600 10px | `--unverified` | unverified |
| pending | the mark outline at stroke 1, `--pending`, 60% opacity | `--pending` | checking |
| uncited | nothing | | (no word inline; counted in the receipt) |

The **logo** is the mark at 18px in `--accent`, 8px gap, then LECTERN in `wordmark`. App icon: the mark in paper on a vermilion square with 3px radius, neatline inset.

### 6.2 Hatches
Hatches identify layers. They are drawn with CSS gradients in the layer's `mid` colour over its `fill`.

```css
.hatch-water  { background: repeating-linear-gradient(0deg,   var(--h) 0 1px, transparent 1px 3px), var(--f); }
.hatch-heath  { background: repeating-linear-gradient(45deg,  var(--h) 0 1px, transparent 1px 4px), var(--f); }
.hatch-spruce { background: radial-gradient(circle, transparent 1.1px, var(--h) 1.2px 1.8px, transparent 1.9px) 0 0 / 6px 6px, var(--f); }
.hatch-sand   { background: radial-gradient(var(--h) 0.8px, transparent 1px) 0 0 / 4px 4px, var(--f); }
.hatch-moor   { background: repeating-linear-gradient(45deg, var(--h) 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, var(--h) 0 1px, transparent 1px 5px), var(--f); }
.hatch-lichen { background: repeating-linear-gradient(90deg,  var(--h) 0 1px, transparent 1px 3px), var(--f); }
.hatch-clay   { background: repeating-linear-gradient(-45deg, var(--h) 0 1px, transparent 1px 4px), var(--f); }
.hatch-dusk   { background: linear-gradient(90deg, var(--h) 0 3px, transparent 3px 6px) 0 0 / 6px 3px, var(--f); }
/* --h = layer mid, --f = layer fill */
```

Where hatches appear: legend swatch (18 x 12, 1px `mid` border), scope chips (10 x 10 swatch inside), margin card left edge (4px wide strip), graph node left edge for nodes with a `ref`, Studio cell group band (top 6px), source drawer header swatch. Hatches never sit behind text.

### 6.3 Texture rules
- Contour lines are the only texture. They appear in: the top bar right corner, Studio index gutters and frame, sheet covers, onboarding sheet, export covers, empty-state illustrations.
- Contours are static SVG paths, 1px `--contour`, `pointer-events:none`, never under text, never animated except the one print trace (section 8).
- No halftone, paper grain, noise, tape, stickers, script, offset shadows or rotated badges in the working UI.
- Riso overprint (two-ink offset) only on sheet covers and exports: title in `--ink` with a 2px x / 1px y offset copy in the group tint `mid` at `mix-blend-mode: multiply` (light) / `screen` (dark).

---

## 7. Iconography

- Base set: Lucide (MIT), stroke 1.5, size 16 (14 in dense rows), `currentColor`, butt caps and miter joins forced via CSS (`stroke-linecap: butt; stroke-linejoin: miter`) to match the mark.
- Custom glyphs (draw on the same 16 grid): benchmark and its variants, query ring, layer swatch, sheet (a rectangle with a folded top-right corner and a 1px neatline), trail steps (search = magnifier, read = open page with line marks, check = benchmark), print (sheet with arrow out).
- Colour: icons are `--ink-3` at rest, `--ink` on hover and focus. Only status glyphs carry status colour. No filled icons except status dots and the toggle thumb.
- Icons appear only where a label alone is slower: icon-only buttons in the top bar and drawer header (each with `aria-label` and a tooltip with its shortcut), artifact list kind glyph, trail steps. Rail rows have swatches, not icons. Menu items have no icons except destructive (trash) and external (arrow-up-right).
- Kind glyphs (artifact list, sheet cells): doc = page with lines, graph = three nodes and two edges, sequence = two lifelines with an arrow, plan = checklist, quiz = card with question mark, file = page with `</>`.
- Never emoji. Never multicolour icons. Never icon backgrounds or blobs.

---

## 8. Motion

### 8.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--d-0` | 0ms | every keyboard-initiated move, palette list, exhibit stepping, pane jump, theme switch |
| `--d-1` | 120ms | hover colour, button press |
| `--d-2` | 160ms | popover, tooltip, hover card, menu in (out is 100ms) |
| `--d-3` | 200ms | citation resolve stamp, chip state change |
| `--d-4` | 320ms | drawer in/out, Studio view switch content fade |
| `--d-5` | 420ms | print finish (neatline trace, printed sheet slide) |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | hover, popover, chip |
| `--ease-drawer` | cubic-bezier(0.32, 0.72, 0, 1) | drawers, printed sheet slide |
| `--ease-linear` | linear | progress fills, neatline trace |
| spring `stamp` | perceptual duration 0.2s, bounce 0.15 | gutter mark inks in |
| spring `drag` | perceptual duration 0.35s, bounce 0, keeps velocity | graph node drag and release, canvas fling |
| spring `print` | perceptual duration 0.42s, bounce 0.1 | printed sheet lands |

Springs are implemented with WAAPI keyframes generated once from the spring parameters (precompute 60 samples into a `linear()` easing string). No Framer Motion, no rAF loops for UI motion. Only `transform` and `opacity` animate (plus `stroke-dashoffset` for the two SVG traces and `background-color` for 120ms hover).

### 8.2 What animates

| Moment | Motion |
|---|---|
| Sequence play | a packet dot moves along each arrow by `transform: translate`, 320ms linear, then rests 140ms (900ms after a step whose source opened in the drawer). Activation bars fade in and out by `--d-1`. Reduced motion: no packet, steps advance every 900ms |
| Hover on row, button, chip | background and colour, `--d-1` `--ease-out` |
| Button press | scale 0.97 on `:active`, `--d-1` |
| Tooltip | appears after 500ms hover delay; once one tooltip has shown, the next shows with 0 delay for 800ms; fade + translateY(2px to 0), `--d-2` |
| Citation hover card | opacity + translateY(4px to 0) + scale(0.98 to 1), origin at the chip, `--d-2`; opens after 120ms hover dwell; on focus opens with 0 delay and no motion |
| Menu | opacity + scale(0.97 to 1), origin at trigger, `--d-2`; menus open on `mousedown` |
| Drawer | translateX(24px to 0) + opacity, `--d-4` `--ease-drawer`; close 200ms |
| Dialog | opacity + scale(0.96 to 1), `--d-2`; scrim fade 160ms |
| Command palette | appears with **no motion** (keyboard initiated). If opened by mouse click on the top-bar field, 120ms opacity only |
| Answer streaming | words revealed at a steady cadence (section 11.10), trailing 3-word fade from 0.35 to 1 opacity over 160ms |
| Citation resolve | chip goes from pending (hairline, ink-4) to final state; gutter mark scales 0.9 to 1 with spring `stamp`, opacity 0 to 1; total under 200ms; one per citation as each check lands |
| Receipt | when the last check lands, numerals count up once over 300ms (`--ease-out`, integer steps), never again for that answer |
| All-verified | if every citation is verified and there are 2+, the receipt's double rule draws left to right in 300ms. Optional sound (section 9) |
| Trail | live line replaces its text in place (no slide); collapses to the summary line with a 160ms height transition when the answer completes |
| Studio running cell | neatline traces around the cell as a determinate progress (stroke-dashoffset = 1 - progress), linear |
| Print finish | the cell's neatline completes and holds 200ms; the cover's riso offset settles from 2px to 0 over 300ms; the printed sheet row slides into Printed sheets from translateY(-8px) with spring `print`. Plays once per generation |
| Plan checkbox | check stroke draws in 120ms; phase segment fills 160ms |
| Flashcard flip | rotateY 0 to 180 over 240ms `--ease-out`, backface hidden; with reduced motion, crossfade 0ms |
| Graph | node drag and fling use spring `drag`; zoom by wheel is immediate (no easing); `0` (fit) animates the viewport over 240ms `--ease-out` |
| Reopen replay | only citations that changed since they were written stamp in again (gutter marks and, on sheets, chips); a moved label rolls from the cited line to the found line over `--d-3`; skipped in reduced motion |

### 8.3 What never animates
- Keyboard navigation of any kind: J/K, arrows in lists, 1 to 9, `[` `]`, Tab, palette results, tree expand by key, Studio cell focus. Play on a sequence sheet is something the user starts on purpose, so the packet moves; J/K and the arrows on that sheet still jump with no animation.
- Theme switch: add `<style>*{transition:none!important;animation:none!important}</style>`, flip `data-theme`, read `getComputedStyle(document.body).opacity`, remove the style.
- Text layout: no reflow on chip resolve (chips reserve their width from the start, section 11.5).
- Scroll: no smooth-scroll on programmatic jumps. Jumps are instant; the target line flashes (band-strong, 600ms fade out) so the eye finds it.
- Loading: no spinners anywhere. No shimmer on prose. No skeleton for anything that loads under 300ms.
- Decorative loops: none. The running-recipe dot in the top bar chip is the one loop (opacity 1 to 0.4, 1.2s, `steps(2)`), paused when the tab is hidden or the chip is off-screen.

### 8.4 Interruptibility
Every animation is a CSS transition or a WAAPI animation that can be reversed or retargeted. Closing a drawer mid-open reverses from its current position. Hover cards cancel if the pointer leaves before the dwell ends. Never `await` an animation before applying state.

### 8.5 Reduced motion
`@media (prefers-reduced-motion: reduce)`: all durations become 0 except opacity fades at 120ms for hover cards and menus. Stamp, count-up, neatline traces, riso settle, flip, drawer slide and graph springs are off. Progress still updates (as discrete fills). The setting can also be forced from Settings > Motion.

---

## 9. Sound
Off by default. One toggle in Settings > Sound, persisted. One MP3 sprite (`sounds.mp3`, under 40KB) with three cues at volume 0.3, leading silence trimmed:
- `peg`: a soft wooden tick, played when every citation in an answer is verified (2 or more citations).
- `press`: a short paper thunk, played when a Studio sheet finishes printing.
- `flag`: a low two-note, played when a citation comes back unverified.
Never on hover, typing, navigation or errors from the app itself. Never the only signal. No haptics.

---

## 10. Keyboard grammar
One grammar everywhere (Raycast rules): every list filters by typing, arrows move, Enter opens, Esc backs out one layer, number keys jump.

| Key | Action | Where |
|---|---|---|
| `Ctrl+K` | command palette | everywhere |
| `/` | focus composer (Ask) | everywhere except inputs |
| `N` | new question (clears page, focuses composer) | page |
| `Up` in empty composer | edit last question | composer |
| `Tab`, `Enter` | open the earlier answer the composer offers (`Esc` dismisses it) | composer |
| `J` / `K` | next / previous claim (claim cursor) | page |
| `1` to `9` | open citation n (pins its hover card and scrolls its margin card into view) | page |
| `[` / `]` | previous / next citation | page |
| `Enter` on a claim | pin the hover card for its citation | page |
| `O` | open the cursor's citation in the source drawer at the line | page |
| `C` | copy answer with citations (markdown footnotes with path:line) | page |
| `X` | challenge the claim under the cursor | page |
| `W` | ask "What could make this wrong?" | page |
| `H` | toggle claim bands (underline-only mode) | page |
| `L` | toggle the trail log | page |
| `V` | proof ribbons: widen the margin into the cited files, a ribbon from each claim to its lines | page |
| `E` | show the cited file as it was when the answer was written (or the saved lines when there is no usable commit) | drawer, on a moved or unverified citation |
| `D` | list the commits since that touched the cited lines | drawer, on a moved or unverified citation |
| `P` | Studio | everywhere |
| `Ctrl+1` / `2` / `3` | focus rail / page / margin | everywhere |
| `Ctrl+B` | toggle rail | everywhere |
| `Space` on a source row | toggle its scope | rail |
| `Esc` | close the top layer (hover card, menu, palette, drawer, proof ribbons, dialog), then clear claim cursor | everywhere |
| `?` | shortcut sheet dialog | everywhere |
| `Ctrl+Shift+L` | toggle theme | everywhere |
| `Ctrl+Enter` | Generate (Studio form), Ask (composer, plain Enter also asks) | forms |
| `Ctrl+Alt+Space` | quick-ask popup, from any app (desktop app, off until switched on in Settings) | Windows |
| `Alt+Enter` | open this question in the main window | quick-ask popup |
| Studio: type | filter cells | Studio |
| Studio: two digits | jump to sheet number (`0` `9` = Sequence diagram) | Studio |
| Studio: `Enter` | open the selected recipe's form | Studio |
| Studio: `V` | toggle index / list view | Studio |
| Graph: `+` `-` `0` | zoom in, out, fit | graph |
| Graph: arrows | move to neighbour node | graph |
| Graph: `M` | matrix view toggle | graph (over 20 nodes) |
| Flashcards: `Space` flip, `Right` got it, `Left` again, `S` shuffle | | quiz |
| Plan: `X` on a task toggles its next acceptance item, `Shift+X` all | | plan |
| Sequence: `Space` plays or stops, `Esc` stops it before anything else closes | | sequence |

In the quick-ask popup Esc hides the window once no layer (drawer, dialog, menu, hover card) is open, and while an answer streams it stops the answer first.

Shortcut hints are shown inline: in the palette next to each command, in tooltips, in the key strip, and on buttons as `kbd` caps.

---

## 11. Components

Each component lists anatomy, sizes, tokens and every state. "Hover" means pointer over. "Focus" means keyboard focus (`:focus-visible`). All interactive elements are real `<button>`, `<a>`, `<input>`, `<textarea>`, `<select>` or have the matching ARIA role and keyboard handling.

### 11.1 Buttons

| Variant | Use | Rest | Hover | Pressed | Focus | Disabled |
|---|---|---|---|---|---|---|
| **Primary** | Ask, Generate, Write file | ground `--ink`, text `--paper` `ui-strong`, height 32, padding 0 14, radius 4, trailing `kbd` in `--paper` at 70% opacity on a 1px `--paper`/30% border | ground oklch(from var(--ink) calc(l + 0.08) c h) light / calc(l - 0.08) dark | scale 0.97 | ring | ground `--rule-strong`, text `--ink-3` |
| **Secondary** | Copy with citations, Challenge, Export | ground `--paper`, 1px `--rule-strong`, text `--ink` `ui`, height 28, padding 0 10, radius 4, trailing kbd | ground `--paper-3` | scale 0.97 | ring | text `--ink-4`, border `--rule` |
| **Quiet** | toolbar actions, card actions | no ground, no border, text `--ink-2` `ui`, height 28, padding 0 8 | ground `--paper-3`, text `--ink` | ground `--paper-3` darker one step | ring | `--ink-4` |
| **Link** | scrutiny link, "open all", inline actions | Newsreader italic 15px `--accent` (scrutiny) or Archivo `ui` `--ink-2` underline on hover (others) | underline 1px offset 3px | | ring | |
| **Icon** | top bar, drawer header | 28 x 28, icon 16 `--ink-3`, radius 4, `aria-label` and tooltip | ground `--paper-3`, icon `--ink` | scale 0.95 | ring | `--ink-4` |
| **Destructive** | confirm delete, overwrite | ground `--accent`, text `--paper` `ui-strong` | L -0.05 | scale 0.97 | ring | |

Loading inside a button: label stays, a 12px segment bar replaces the kbd hint. Never a spinner. Buttons have a minimum hit area of 28 x 28 (24 x 24 for inline chips).

### 11.2 Inputs
- **Text field**: height 30, padding 0 10, `--paper`, 1px `--rule-strong`, radius 4, text `ui` `--ink`, placeholder `--ink-4`. Label above in `kicker` (`--ink-3`) with 6px gap, or inline left in `ui-sm` for dense forms.
- States: hover border `--ink-3`; focus border `--ink` + ring; filled; invalid border `--accent`, message below in `ui-sm` `--accent` with the query glyph; disabled ground `--paper-2`, text `--ink-4`; read-only no border, ground `--paper-2`.
- **Textarea** (longtext recipe inputs): same, min-height 96, `read-sm` Newsreader for prose inputs, `mono` for diffs and paths. Grows with content up to 320px then scrolls.
- **Select / picker** (root, artifact picker): same box with a 12px chevron; opens a menu (11.13) with type-to-filter.
- **Toggle switch** (scope): track 26 x 14, radius full. Off: track `--rule-strong`, thumb `--paper` with 1px `--rule-strong`. On: track = the source's layer `mid` (light) or layer `ink` at 60% (dark), thumb `--paper`. Focus ring around the track. Toggling is instant (0ms) by keyboard, 120ms thumb slide by pointer.
- **Checkbox** (plan acceptance): 14 x 14, radius 2, 1px `--ink-3`. Checked: ground `--ink`, check stroke `--paper` 1.75. Indeterminate: a bar. Focus ring.
- **Segmented control** (doc/list toggles, theme): height 26, 1px `--rule-strong`, radius 4, segments `ui-sm`, active segment ground `--ink` text `--paper`.

### 11.3 Composer
The ask box is a ruled line, not a chat bubble.

Anatomy (height 104 when idle, grows to 220 max):
- Frame: `--paper`, 1px `--rule-strong`, radius 8, neatline inner rule on focus.
- Row 1: kicker `ASK` (`--accent`) left; right: `Question 048` in `mono-sm` `--ink-3`.
- Row 2: textarea in Newsreader 18px/28, placeholder `Ask a follow-up, or press / for a new question` (`--ink-4`). One line idle, grows.
- Row 3 (32px): scope chips left, model picker and primary **Ask** button right.
  - Scope chips: one chip per source in scope: 10px hatch swatch + name in `ui-sm`, ground layer `fill`, text layer `ink`, radius 2, height 22. When all sources are in scope, one chip `All 5 sources` with five tiny swatches. Click or `/` then type `@` to change scope (opens a filterable menu of sources with toggles).
  - Model: quiet button `Opus` with chevron; menu lists Opus, Sonnet, Haiku with one-line cost hints in `mono-sm`. Shortcut `M` when composer focused and empty.
  - Ask: primary button `Ask` + `Enter` kbd.

States:
- Idle (unfocused): only row 2 and a collapsed row 3 (chips and Ask visible), border `--rule`.
- Focused: border `--ink-2`, neatline inner rule appears.
- Typing: Ask enabled. `@` opens source scope menu inline at caret. `#` opens a "pin a file" menu (adds a path chip).
- Asking (streaming): textarea locked showing the question in `--ink-3`, Ask becomes secondary `Stop` with `Esc` kbd. Composer stays where it is.
- Selection-scoped: when the user selects text in the answer or source drawer and presses `/` or clicks **Ask about this**, a quote strip appears above row 2: 3px left border in the selection's layer `mid`, quote in `quote` style, truncated to 2 lines, path:line in `mono-sm`, and an `x`.
- Recall: one line under the textarea when an earlier answer in any notebook reads like the question being typed, shown only for 3 or more meaningful words and a close match: `Asked before: Question 044. 9 citations, all still verified.` (with ` in NeoForge 1.21.1` when it lives in another notebook). Status glyph in the status colour, an `Open` button with `Tab`, and a dismiss `x`. Words come from the fresh citation check and say no more than the receipt: verified, moved, unverified. It never blocks typing or Ask, and `Esc` dismisses it.
- Error: a line under the frame in `ui-sm` `--accent`: `The model did not answer. Retry  R` with a secondary Retry button.
- Disabled (no sources yet): placeholder `Add a source first`, Ask disabled, link `Add a source` in row 3.

### 11.4 Source list (the legend)
In the rail. Header row: kicker `SOURCES` left, `scope 5 of 5` in `mono-sm` `--ink-3` right.

Groups (kicker, `--ink-3`, 11px, 20px top margin): `PINNED DOCS`, `CODE ROOTS`, `YOUR REPO`.

Source row, 40px for code roots (two lines), 28px for docs (one line):
- 18 x 12 hatch swatch (layer fill + hatch, 1px layer `mid` border).
- Name in `ui` `--ink`. Names are never italic; the map convention lives in the hatch.
- Second line (code roots): `live · 21.1.77` in `mono-sm` `--ink-3`. For your repo: `main · 3 dirty` with `3 dirty` in `--moved`.
- Right: file count `956` in `mono-sm` `--ink-3` tabular, then a scope toggle.

States: rest; hover ground `--paper-3`, a quiet `...` menu button appears; focus ring on row; out of scope: swatch at 35% opacity, name `--ink-3`, count hidden, toggle off; indexing: count replaced by a 40px segment bar and `412/956` in `mono-sm`; stale (index older than the source's last change): small `--moved` dot after the name with tooltip `Changed since last index. Reindex  R`; error (path missing): name `--ink-3`, the query glyph in `--accent`, second line `Folder not found` in `--accent`; selected (drawer open on this source): ground `--paper-3`, 2px left bar in layer `mid`.

Row menu: Reindex, Change layer (shows the 8 swatches), Open folder, Rename, Remove (destructive, confirm).

After the groups: quiet button `+ Add a source` (dashed 1px `--rule-strong` frame, height 32, `kbd A`).

Below: **History** (kicker `HISTORY`, `kbd H` focuses it). Rows 44px: `047` in `mono-sm` `--accent`, title in `ui` `--ink` (2-line clamp), meta line `today · 3 citations` in `mono-sm` `--ink-3`; a 6px status dot after the meta if any citation is moved (`--moved`) or unverified (`--accent`). Current question row: ground `--paper-3`. Type-to-filter when focused.

Footer (pinned, 48px, 1px `--rule` top): `Indexed 2 min ago` and `1,588 files · 5 sources` in `mono-sm` `--ink-3`; second line `MCP · CLI listening on :7419` with a 6px dot (`--verified` when up, `--ink-4` when off).

### 11.5 Citation marker (inline chip)
Sits glued to the last word of its claim with a no-break join (wrap the last word and the chip in `white-space:nowrap`).

- Size: 18 x 18 circle, radius full, numeral in `mono-sm` 500, 2px left margin.
- Ground: the source layer `fill`. Numeral: layer `ink`. Border: 1px layer `mid`.
- Pending: ground transparent, 1px dashed `--ink-4`, numeral `--ink-4`. The chip occupies its final size from the first frame so nothing reflows.
- Verified: as above, solid border.
- Moved: border 1px dashed `--moved`, numeral `--moved`, ground `--moved-wash`.
- Unverified: border 1px dashed `--accent`, numeral `--accent`, ground `--unverified-wash`.
- Hover: ground layer `band-strong`, opens the hover card after 120ms.
- Focus (Tab reaches every chip in reading order): ring, hover card opens immediately.
- Active (its card pinned): ground `--ink`, numeral `--paper`.
- Unresolved token from the model (bad citation syntax): rendered as an unverified chip with tooltip `Citation could not be read`. Never show raw `[[...]]` or `@1` text.

### 11.6 Claim span, gutter mark and claim cursor
- **Claim span**: the clause the citation covers (from the model's citation span, or the sentence if no span). Default treatment: background layer `band` with 2px vertical padding (`box-decoration-break: clone`), plus a 1px underline in layer `mid`, offset 4px.
  - Moved claim: band `--moved-wash`, underline 1.5px dashed `--moved-line`.
  - Unverified claim: band `--unverified-wash`, underline 1.5px dashed `--accent`.
  - Uncited sentences: no band, no underline, no mark.
  - `H` (underline-only mode): bands off, underlines stay. Remembered per user.
- **Gutter mark**: in the 40px gutter left of the column, top-aligned to the first line of the claim's line box (positions measured after each paragraph finishes revealing; recomputed on resize with a ResizeObserver, debounced 50ms). The mark per state from 6.1. Moved adds `L96` in `mono-sm` `--moved` to the right of the glyph (the gutter is wide enough; the label may overhang into the column's left padding 4px). Two claims on one line: marks stack horizontally, 2px apart.
- **Claim cursor** (J/K): active claim gets band `band-strong` (or the stronger moved/unverified wash at L -0.03), a 2px `--ink` caret bar to the left of the gutter mark, and its margin card gets a 1px `--ink` ring. Cursor movement is instant, scrolls the claim into the middle third if it is out of view (instant scroll), and announces via `aria-live="polite"`: `Claim 3 of 4. Moved. Handlers run on the main thread by default.`

### 11.7 Citation hover card
Opens from a chip (hover dwell 120ms, focus immediate, `1` to `9` pins), anchored below the chip, flips above if no room. Width 380. `--paper` ground (light) / `--paper-2` (dark), 1px `--rule-strong`, radius 6, `--float`.

Anatomy:
1. Header row (28px): status glyph + status word in `kicker` in status colour (`VERIFIED`, `MOVED`, `UNVERIFIED`, `CHECKING`), right: citation number `3` in a small chip and `of 3`.
2. Quote: `quote` style (Newsreader italic 15/22) for docs; for code, a 3 to 7 line excerpt in `code` on `--well` with line numbers, the cited lines on layer `band-strong`.
3. Location line: hatch swatch (10px), path in `mono-sm` `--ink-2` (middle-truncated: `networking/payload.md`), `:96` in `--ink`.
4. Moved line (moved only): `Cited L92, found at L96. Same text.` in `ui-sm` `--moved`. Code citations save the cited lines when the answer is written, and a re-check compares them ignoring whitespace and blank lines, so there is no closest-match view. The saved block is found whole (moved) or it is gone. Rewritten code is unverified, and its card shows the saved lines above and today's lines below (`Saved L31-40 · Oct 28`, `Now L31-40`, at most 8 rows each), saved words that changed struck in `--ink-3` and today's changed words on `--moved-wash`. A plain note under it says whether the trail read those lines (`The trail read L22-58, which covers these lines.`, or that it never opened the file).
5. Unverified line, in `ui-sm` `--accent`: for a quote `Quote not found in Foo.java.` plus quiet button `Search all sources`; for code `These lines were rewritten after the answer was written.` (or `Foo.java no longer has these lines.` when the file got shorter). Citations saved before lines were kept get their baseline at the first re-check and say so: `Lines saved on Oct 28 when this citation was first re-checked. Earlier edits are not visible.`
6. Actions row (28px, 1px `--rule` top): `Open at line  O`, `Copy ref`, `Challenge  X`.
7. History row (only for a citation that has changed since it was written, above the actions row): kicker `History`, then one status glyph and date per entry, as written first (`Oct 24 verified L92` in the title and the aria-label), at most 7 entries (the first plus the last six).

States: loading never shown (excerpt is prefetched when the chip resolves; if it is not ready the card shows the quote from the citation and the location line with excerpt space reserved, filling in place); pinned (a small pin glyph in the header, stays open while the cursor moves inside it, Esc closes); file deleted (`File no longer exists at this path.` in `--accent`, status forced to unverified).

### 11.8 Margin citation card (exhibit)
In the 300px margin, each card top-aligned with its claim's line (Tufte alignment). When cards would overlap, later cards push down with 12px gap and a 1px `--rule` leader line connects card to claim line in the gutter of the margin.

Head of the margin is the **receipt** (11.9). Then the kicker `CITATIONS` with `1-9  [ ]` in `kbd` right.

Card anatomy (radius 6, `--paper`, 1px `--rule`, 4px left edge strip in the layer hatch):
- Row 1: number chip (same as 11.5 but static), status glyph, status word in `kicker` status colour.
- Quote: `quote` style for docs (max 4 lines, then fade with a `more` link), code line in `mono` on `--well` for code.
- Path: `mono-sm` `--ink-3`, `networking/payload.md:9`.
- Moved only: `Cited L92, found at L96. Same text.` in `mono-sm` `--moved`.
States: rest; hover (ring 1px `--rule-strong`, claim gets band-strong); cursor-linked (1px `--ink` ring); pinned (ground `--paper-2`); verified cards are visually the quietest; moved and unverified cards carry their status line, so the margin reads calm when everything checks out.

Below the cards: **Print this as...** panel (11.19 compact form): kicker `STUDIO`, four suggested recipes as rows `09 Sequence diagram ...... diagram` (dot leaders, number in `--accent` `mono-sm`), then link `All 24 recipes  P`.

**Proof mode (`V`).** The margin widens to `clamp(300px, 34cqw, 440px)` and the gap to 64px. Each verified or moved card with a claim grows an excerpt pane built from the hover card rows (cited lines banded, a few lines of context). A ribbon in the layer's `band-strong` with a `mid` edge runs from the claim's first line across the gap to those lines. A moved card adds a dashed `--moved-line` ribbon to the lines the model cited, with `cited here` and `found here` tags on the rows, the same words as the drawer. `J`/`K` keeps the cursor claim's ribbon filled and drops the others to hairlines. Unverified and missing cards get no pane and no ribbon. Nothing animates. `V` again, `Esc` or opening the drawer ends it, and below 1100px `V` toasts that the margin is folded.

### 11.9 Receipt
The honest count. Two forms.

**Full receipt** (top of margin, 300 wide):
- Top double rule (2px + 2px gap + 1px, `--ink`).
- Kicker row: `CHECKED` `--accent` + `re-read 14:02` `mono-sm` `--ink-3`.
- Four columns of `numeral-xl`: `2` verified (`--verified`), `1` moved (`--moved`), `0` unverified (`--ink-4` when zero, `--accent` when not), `1` uncited (`--ink-3`). Under each, glyph + word in `mono-sm` in the same colour.
- Caption in `quote` style `--ink-2`: `Every quote here was found again in its file, or where it moved to. Sentences with no mark are uncited.` When unverified > 0: `1 quote was not found. It is marked in red.`
- Clicking a numeral filters the margin to that state and steps the cursor through those claims.
- On a reopened answer `re-read` is the time of the re-check. If a citation changed status since it was written, two `mono-sm` lines sit under the numerals: `Written Oct 24: 3 verified.` and `Today: 2 verified, 1 moved.` (`Written 14:02` when it was today). Sheets show the same pair beside the cover receipt with `Printed`.

**Mini receipt** (top bar, and the one-line receipt under the trail at narrow widths): 12px marks + counts in `mono-sm`: `[mark] 2  [moved] 1  [query] 0  · 1 uncited`. `aria-label="2 verified, 1 moved, 0 unverified, 1 uncited"`.

States: checking (numerals show `-` in `--ink-4`, caption `Checking 3 citations...`); complete; all verified (double rule draws once, section 8); no citations at all (numerals hidden, caption `This answer has no citations. Treat it as a sketch.` in `--moved`).

### 11.10 Trail (tool steps) and streaming
The trail is a factual action log, never narration.

**Live** (while working): one line under the headline, height 28, `mono` `--ink-2`, prefix kicker `TRAIL`. Steps join with ` > ` in `--ink-4`: `grep PayloadRegistrar · neoforge > read RegisterPayloadHandlersEvent.java 22-58 > read networking/payload.md 1-120 > checking 3 citations`. The current step is `--ink`; finished steps `--ink-3`. If the line overflows, older steps collapse into `3 steps >` at the left. First step must appear within 1s of Ask; if the model has not issued a tool call by 800ms, show `reading the question` as step 0.

**Done**: collapses to summary: `TRAIL  Read 3 files · 2 searches · checked 3 citations · 4.1 s` with a chevron and `L` kbd. Expanded log: a list, one row per step (24px): step glyph (search, read, check), the command in `mono` (`grep "PayloadRegistrar" neoforge`), result in `mono-sm` `--ink-3` (`4 matches in 3 files`), duration right-aligned. Every file path is a link that opens the source drawer at that range. Every source consulted is listed, including ones not cited. Expanded, the log opens under a survey drawing: a band per source consulted, a station per file read or place searched, a traverse line in visit order (solid legs for reads, dashed for searches), the benchmark mark in status colour on cited files and a hollow dot on files read but not cited. Stations open the source drawer.

**Streaming answer**:
- Tokens buffer and reveal at a steady word cadence (target 28 words/s, catch up to 60 words/s if the buffer exceeds 80 words), decoupled from network bursts. Written to the DOM through direct node appends, not framework re-renders.
- Trailing 3 words fade in (section 8).
- Markdown blocks are laid out stably: a code fence reserves a well with the line count known so far and grows by line; syntax highlighting is applied when the fence closes.
- Citation chips appear pending at their final width as soon as the citation token arrives and resolve in place when the check returns.
- Auto-scroll only when the reader is within 48px of the bottom. Otherwise a quiet pill appears above the composer: `New text below  End`.
- The headline and trail never move once placed.
- Screen readers: `aria-busy="true"` on the answer while streaming; announce once per completed paragraph, not per token.

**Stopped** (Esc / Stop): text kept, a line `Stopped after 41 words.` in `ui-sm` `--ink-3`, and secondary `Continue`.

### 11.11 Answer actions row
Under the answer, 16px gap. Secondary buttons: `Copy with citations  C`, `Challenge a claim  X`, `Show the code path`. Then the scrutiny link on its own line in Newsreader italic `--accent`: `What could make this wrong for 1.21.1?  W` (version taken from the notebook's pinned version; generic notebooks show `What could make this wrong?`).
Copy feedback is inline: the button label becomes `Copied with 3 citations` with a check for 1.6s. No toast.

### 11.12 Toasts
Bottom-left, 16px above the key strip, width 340, stack max 3 with later ones scaled 0.96 and offset 6px. `--paper` ground, 1px `--rule-strong`, radius 6, `--float`. Content: optional status glyph, one line `ui` `--ink`, optional action as quiet button. Auto-dismiss 4s, paused on hover and while the tab is hidden. Esc dismisses the newest when focus is on a toast.
Used only for things that happen away from where the user is: `Sheet 06 printed. Code map · 48 nodes.  Open`, `Wrote CLAUDE.md to C:/projects/wtg/CLAUDE.md.  Show`, `Reindexed neoforge · 956 files`, `MCP client connected: claude-code`. Errors that block nothing use a toast with `--accent` glyph; errors that block use an inline banner.

### 11.13 Menus
Ground `--paper`, 1px `--rule-strong`, radius 6, `--float`, padding 4. Items 28px, `ui`, padding 0 8, radius 4; trailing shortcut in `kbd`; leading swatch for source items only. Hover and keyboard highlight ground `--paper-3`. Destructive item text `--accent` with trash icon, separated by a 1px `--rule`. Submenus open on hover with a prediction cone and on `Right`. Type-to-filter when the menu has more than 7 items (a filter input appears at the top). Opens on mousedown. Esc closes and returns focus to the trigger.

### 11.14 Command palette
Opens with `Ctrl+K` from anywhere, centred at 18vh from the top, width 640, max height 60vh. Neatline frame, radius 8, `--paper`, `--float`, scrim.

Anatomy:
- Input row 48px: magnifier 16, input in Archivo 16px `--ink`, placeholder `Ask, jump to a file, or run a recipe`, right `Esc` kbd.
- Results grouped, each group headed by a kicker (`--ink-3`, 24px row): `ASK`, `QUESTIONS`, `FILES`, `STUDIO`, `SOURCES`, `COMMANDS`.
- Row 32px: leading glyph or swatch (16), title in `ui` with matched characters in `ui-strong` `--ink` and unmatched `--ink-2`, secondary in `mono-sm` `--ink-3` (path, recipe kind, `047 · today`), trailing shortcut `kbd`.
- First row is always `Ask "<query>"` with `Enter` when the query is 3+ characters.
- Footer 28px, 1px `--rule` top: `Up Down to move · Enter to open · Tab to scope · Ctrl+Enter ask in new question` in `mono-sm` `--ink-3`.

Behaviour: fuzzy match over titles plus aliases (shown as `Ask (survey)` when an alias matched); default ranking before typing: recent questions, then commands by frequency, rare commands scored 0 so they appear only when matched; context boost (on an artifact, its actions rank first); up to 3,000 items without virtualisation; nested pages via a stack (a recipe opens its input form page inside the palette; Backspace on empty input or Esc pops); `loop` arrow navigation; numbers `Ctrl+1` to `Ctrl+9` pick the nth row; Tab cycles a scope filter chip (All, Files, Studio, Questions, Recall). Recall searches the past questions, answers, notes and sheets of every notebook, grouped under `ANSWERS`, `NOTES` and `SHEETS` kickers (Recall scope only); a row in another notebook switches to it first.
States: empty query (recent questions and top commands); typing; no results (`No match. Enter asks "<query>" across all sources.`); file index still warming (`Indexing files · 412 of 1,588` row at the top of FILES with a segment bar); recipe page (form fields, Generate `Ctrl+Enter`).

### 11.15 Dialogs
Width 480 (small) or 720 (large). Neatline, radius 8, `--paper`, `--float`, scrim. Title in `ui-title`, body `ui` or `read-sm`, actions right-aligned (secondary then primary), 24px padding. Focus trapped, initial focus on the least destructive action, Esc cancels. Used for: confirm remove source, overwrite file, shortcut sheet (`?`, large, two columns of key groups), settings (large, left tab list).
Never used for: errors, success, onboarding steps.

### 11.16 Tabs
Compact, never full width. Labels in `ui` `--ink-3`, 28px tall, 12px gap, active label `--ink` with a 2px `--ink` underline 4px below the baseline. Hover `--ink-2`. Keyboard: arrows move, Home/End, automatic activation. Used in: artifact header (`Rendered`, `Source`, `Citations 32`), source drawer (`File`, `Outline`), settings.

### 11.17 Tree
Used in the source drawer (file tree of a source) and the Add source dialog folder picker.
Rows 24px, indent 14px per level, chevron 12 (`--ink-3`), folder and file names in `mono-sm` `--ink-2`, counts right in `--ink-4`. Files with citations in the current question show a 6px dot in the citation's status colour. Hover ground `--paper-3`; focus ring; selected ground `--paper-3` and text `--ink`. Keyboard: Up/Down, Right expands or enters, Left collapses or goes to parent, Enter opens, type-ahead jumps by name. Expand is instant.

### 11.18 Source drawer
Slides from the right over the margin. Width 640. Opens from: citation `O`, hover card `Open at line`, trail file links, palette file results, tree.

Anatomy:
- Header 48px: hatch swatch, source name `ui-strong`, path `mono-sm` `--ink-3` with copy button, tabs `File` / `Outline`, icon buttons `Open in editor` (vscode:// link), `Close  Esc`.
- Status strip (only when opened from a citation), 32px, ground status wash: glyph, `Citation 2 · verified · line 31` or `Citation 3 · moved · cited L92, found at L96`. An unverified code citation reads `lines rewritten since the answer`. When the citation is moved or unverified the strip also holds two quiet small buttons with `kbd` caps, `Show as it was  E` (or `Compare saved lines  E` when the file had uncommitted edits, the root is outside git or the answer has no commit but has saved lines) and `What changed it  D` (only with a commit). `E` swaps the body for two columns in one scroller, the file at the commit (`As it was · 9f3c1d2 · 28 Oct`) beside `Today`, rows in the code type with the cited range banded on both sides and the shorter side padded down so the two bands line up; saved lines show only the saved range against today's lines around it. `D` puts a panel between the strip and the body, `Commits since 9f3c1d2 that touched L96-105, as of the last commit.`, one 24px row per commit (short hash, subject, `date · author`; click copies the hash), at most 20. Errors, such as a remote viewer or a commit that is gone, are one line in the panel. Both buttons are toggles with `aria-pressed`.
- Body: code on `--well`, `code` type, line numbers in `--ink-3` 48px column, the cited range on layer `band-strong` with a 2px layer `mid` bar at the left of the line numbers; for moved, the original cited line has a dashed `--moved-line` outline and a label `cited here` while the found line has the band and `found here`. Markdown sources render as reading prose (`read`, 60ch) with the cited passage banded.
- Selection: selecting lines shows a floating mini toolbar (`Ask about this  /`, `Copy ref`) above the selection.
- Jump: opens scrolled so the cited line sits at 35% of the drawer height; the range flashes (band-strong fading to band over 600ms; off in reduced motion).
States: loading (only if over 100ms: header renders, body shows line numbers column and `Reading RegisterPayloadHandlersEvent.java` in `mono-sm`); file too large (over 2MB: first 5,000 lines with `Showing lines 1-5000 of 18,240. Jump to line  G`); binary (`Binary file, not shown.`); missing (`This file is gone from neoforge. It was cited from an older index.` + `Reindex`).
Dependents: lines that a saved answer, sheet or note cites carry the status glyph (`glyph sm`, 12px) in the right 16px lane of the line-number column, x 41-53, clear of the digits and the `read` bar. A range gets the glyph on its first line and a 2px stem of the same ink (50%) down the rest, through the middle of the glyph column. Colour is the worst current status of whatever covers the line. Statuses come from `GET /cited`, which re-checks the file's citations on every open, so they can differ from the stored ones. Hover (120ms dwell) or click a mark lists the dependents in a `hovercard` (`Q012 [3]`, `Sheet 06 node PayloadRegistrar`, `Note <title> [2]`; status word and `L12-20`, or `L96 · cited L92` when moved). One dependent: click jumps to it, the drawer collapses and the answer's citation card is pinned. Several: click pins the list. Marks are mouse and touch only; the keyboard way in is the `Cited by n` button in the drawer's tab row, which opens the whole file's list with focus on the first row (Up and Down move, Enter jumps, Esc closes the list before the drawer). Page mode has no number column, so each block with a citation gets one glyph in the left margin instead.

### 11.19 Studio recipe card (sheet cell)
In the Studio index, cells are 156 x 104 in a 6-column grid, 1px gaps where contour lines run.

Anatomy:
- 6px top band: group hatch (group tint fill + hatch).
- Ground: group `band` (light) / group `band` (dark).
- Top left: sheet number `07` in `mono-sm` 500 `--accent`. Top right: kind glyph 14 `--ink-3`.
- Title: `ui-strong` `--ink`, 2-line clamp: `Code map`.
- Bottom: one-line blurb `ui-sm` `--ink-2` 1 line clamp (`Graph of the codebase's main parts`), and for recipes with required inputs a small `needs: root` in `mono-sm` `--ink-3`.

States:
- Rest.
- Hover: ground group `band-strong`.
- Focus / selected (keyboard or click): neatline frame in `--ink` (outer 1px `--ink`, 3px ground, inner 1px `--rule-strong`), detail panel on the right shows the form.
- Filtered out (typing in Studio): opacity 0.25, not focusable.
- Running: neatline trace in `--ink` advancing with progress; a 6px `--accent` dot top right blinking per section 8.3; bottom row replaced by `4 of 6 · Sync` in `mono-sm` and a segment bar.
- Done, unseen: a 6px `--ink` dot top right until the sheet is opened.
- Disabled (required input not available, e.g. `diff-review` with no git root): ground `--paper-2`, title `--ink-3`, bottom `needs a git root` in `--ink-3`; still focusable with a tooltip explaining.
- Error last time: bottom row `Last run failed · Retry` in `--accent`.

**List view** (`V`, and the layout under 1024 wide): a contents page. Rows 32px grouped under group kickers with a hatch swatch: `07  Code map ............................. graph  needs root` with number in `--accent` `mono-sm`, title `ui`, dot leaders in `--rule-strong` (CSS: a flex filler with `border-bottom: 1px dotted`), kind in `mono-sm` `--ink-3`.

**Compact panel** (margin "Print this as..."): rows as the list view, 4 suggestions picked by the question (rule-based: a question about a flow suggests Sequence diagram, Flow diagram; about porting suggests Porting guide; always include Build X here).

### 11.20 Recipe form
Opens in the Studio detail panel (or as a palette page). Title in `headline-sm` with the sheet number in `--accent` kicker above (`SHEET 02 · PLAN`). Blurb in `read-sm`. Inputs from the recipe's `InputSpec` in order: `text` text field, `longtext` textarea, `root` select listing roots with swatches, `artifact` select listing compatible earlier sheets (`from` recipes) with their sheet number and date, `diff` segmented `Paste` / `From git` (root select + range text field `HEAD~5..HEAD`), `gitlog` root select + range, `path` text field defaulting to `<root>/<filename>`. Model picker. Primary `Print sheet  Ctrl+Enter`. Required fields marked with a small `required` in `mono-sm` `--ink-3` (no asterisks). Validation inline on submit.

### 11.21 Artifact list item (printed sheet)
In Studio's right column under kicker `PRINTED SHEETS`, and in the palette.
Row 52px, radius 6 hover ground `--paper-3`:
- 28 x 36 sheet thumbnail: group fill with the group hatch top band and the kind glyph centred `--ink-2`.
- Title `ui-strong` (`Networking map`), meta line `mono-sm` `--ink-3`: `sheet 06 · graph · 48 nodes · 31/32 verified · 2h ago`.
- Right: status. ok: nothing extra. Running: segment bar 64px and `4 of 6`. Invalid: query glyph + `invalid` in `--accent` and quiet `Retry`. Error: same with `failed`.
- Hover reveals quiet `...` menu: Open, Regenerate, Export, Copy, Delete.
States: rest, hover, focus ring, selected (ground `--paper-3`, 2px left bar group `mid`), new (an `--ink` dot until opened).

### 11.22 Progress
- **Segment bar**: N segments (one per section/phase/step known in advance; 10 when unknown), each 6 x 6 squares with 2px gaps (or width-filling segments at 4px tall in wider slots). Done segments `--ink`, current `--ink` at 50% blinking per 8.3 rule only in the top-bar chip, upcoming `--rule-strong`. Always paired with text `4 of 6 · Sync`. Determinate always; when the total is unknown, show count only (`12 steps`) and no bar.
- **Index progress** in the rail footer: segment bar + `412/956`.
- **Running-recipe chip** in the top bar: 24px, 1px `--rule-strong`, radius 2, `--accent` dot, `Tech spec · 4 of 6` in `mono-sm`, click opens Studio with that sheet selected.
- No spinners. No indeterminate shimmer.

### 11.23 Top bar parts
- Notebook switcher: `NeoForge 1.21.1 modding` in `ui-strong` with chevron; menu lists notebooks with their layer swatches as a 5-swatch strip, `New notebook`.
- Breadcrumb: `> 047 Client-to-server packets` `ui` `--ink-2`, truncates.
- Palette field: 320 x 30, `--paper`, 1px `--rule-strong`, radius 4, magnifier, placeholder `Ask, jump, or run`, `Ctrl K` kbd.
- Index status: 6px dot (`--verified` up to date, `--moved` indexing or stale) + `1,588 files · 2 min ago` `mono-sm` `--ink-3`.
- Theme toggle icon button (sun/moon), `Ctrl+Shift+L`.

### 11.24 Key strip
28px, `--paper-2`, 1px `--rule` top. Left: key hints relevant to the focused pane, each `kbd` + label `ui-sm` `--ink-3`, 16px apart. Page: `J next claim  K previous  1-9 citation  O open at line  C copy  / ask  P studio`. Studio: `type to filter  00 jump  Enter open  V list view  Esc back`. Right: status legend `[mark] verified  [moved] moved  [query] unverified  no mark = uncited` in `ui-sm` with status colours on glyphs only.
Settings > Show key strip (on by default; after 14 days of use a one-time inline note offers to hide it). `kbd` style: `kbd` type, 1px `--rule-strong`, 1px bottom border `--rule-strong` + 1px extra bottom (2px total), radius 2, padding 0 4, height 18, ground `--paper`.

### 11.25 Banners
Inline, full width of the column, radius 4, 12px padding, glyph left. Info: ground `--paper-2`, 1px `--rule`. Warning: `--moved-wash`, title `--moved`. Error: `--accent-wash`, title `--accent`, body `--ink`. Always state what happened and the one action: `Index is 3 days older than neoforge. Answers may cite moved lines.  Reindex`. A reopened turn whose citations got worse says so above the answer: `2 of 5 citations got worse since Oct 24.` `1 moved, 1 unverified.` with `Re-ask` (first turn only; it starts a new conversation). A sheet shows the same with `Regenerate`.

---

## 12. Artifact renderers

Every artifact opens in the page as a full canvas (`P` back to Studio, `Esc` back to where it was opened from). Shared header for all kinds:

**Sheet header** (the cover strip, 168px, the one place the loud display voice lives in the daily app):
- Ground: group `band`. Contour relief SVG (6 to 9 closed contour paths in `--contour` plus 2 in group `mid`) filling the right 45%, `pointer-events:none`, never under text (text column is the left 55%).
- Double rule at top (`--ink`).
- Kicker row: `SHEET 06 · VISUAL · CODE MAP` in `kicker` `--accent`.
- Title in `cover-xl` (56px Archivo wdth 125 weight 800 upper), with riso overprint (6.3) settling once on first open after printing. Long titles step down to 40px then 28px to stay on 2 lines.
- Meta line in `mono-sm` `--ink-2`: `neoforge · 48 nodes · Opus · $0.41 · printed 14:20`. A sheet an outside agent submitted over MCP shows `via claude-code` (the client's name) where the model goes, and has no cost.
- Receipt mini (`31 verified · 1 moved · 0 unverified`).
- Actions row (right aligned, quiet buttons): `Regenerate`, `Export`, `Copy`, `...` (Delete). Then "Next step" chips (secondary buttons with an arrow): PRD -> `Tech spec`, Tech spec -> `Build plan`, `Test plan`, any doc -> `CLAUDE.md`.
- Tabs below: `Rendered`, `Source` (raw JSON or markdown), `Citations 32`.
Under 1024 wide the header shrinks to 96px, title 28px, no relief.

Shared states for every renderer:
- **Generating**: header shows with title from the form input, segment bar under the meta, and the live trail line. Sections render as they validate (docs section by section; structured kinds render the summary prose first, then the visual when the JSON validates). The user can leave; progress continues and a toast fires on finish.
- **Repairing** (`phase: repair`): a banner `First draft failed validation. Asking for a fix (1 of 1).` warning style.
- **Invalid**: banner error style `This sheet did not validate. 3 errors.` with the error list in `mono-sm`, the raw text in a `--well` block below, primary `Retry`.
- **Error**: banner with the message and `Retry`; the form inputs are kept.
- **Empty data** (validated but zero items): the renderer's empty line (below) plus `Regenerate`.
- **Huge**: limits listed per renderer; beyond them the renderer switches to its dense mode and says so.

Citations inside artifacts render with the same chip, hover card, status and drawer behaviour as answers. Graph nodes, plan tasks, sequence steps and quiz items with a `ref` carry a small benchmark glyph in their status colour.

### 12.1 Doc
- Layout: sticky table of contents 220px on the left of the page (H2 and H3, `ui-sm`, current section `--ink` with a 2px `--ink` bar, others `--ink-3`), prose column 660 (`read`), margin 300 for citation cards aligned to claims, same as answers. Gutter marks on every cited claim.
- Each H2 section shows a per-section receipt to the right of the heading in `mono-sm`: `4 verified · 1 moved`.
- Tables: `ui-sm` Archivo, header row kicker style, 1px `--rule` rows, numeric columns right-aligned tabular, cells with citations carry the chip.
- Code blocks: `--well`, `code` type, caption under in `mono-sm` `--ink-3` with provenance.
- Callouts (from `> **Note**` patterns): left 3px `--rule-strong`, `read-sm`.
- Empty: `This doc has no sections.` Huge (over 40 sections): TOC collapses H3s; sections render lazily as they scroll into view.
- Export: Markdown with citations as footnotes `[^1]: networking/payload.md:9 (verified)`, plus a colophon line at the end: `Printed by Lectern · Sheet 14 · 31 of 32 citations verified · 2026-10-24`.

### 12.2 Graph (code map, concept map, flow diagram, dependency graph)
- Canvas: `--paper` with a 24px dot grid in `--rule` at 50% (dots 1px), full page area under the sheet header. Header collapses to 64px when the canvas has focus.
- Layout: `layered` (Sugiyama: longest-path layering, barycenter ordering 4 passes, crossing minimisation, top to bottom; flow diagrams left to right) default for code map, flow, dependency; `radial` for concept map. Edges orthogonal with 6px rounded corners for layered, straight for radial. Over 20 nodes: default view is **focus + neighbourhood** (the most connected node and its 2-hop neighbours, others dimmed to 25%), with a toggle to all and a `Matrix` view (`M`): an adjacency matrix with node labels on both axes in `mono-sm`, cells `--ink` filled where an edge exists, cycle edges `--accent`.
- Node: HTML element, min 120 x 32, padding 6 10, radius 4, ground by kind tint `fill`, 1px kind `mid` border, label `ui-strong` `--ink`, kind word in `mono-sm` kind `ink` above the label. Nodes with `ref` get a 4px left hatch strip of the source layer and a status glyph at top right. Kind tints: package sand, class water, interface heath, event clay, concept dusk, step lichen, decision moor (diamond-cut corners via clip-path), external `--paper` with 1px dashed `--rule-strong`. The legend (bottom left, 1px `--rule`, `--paper`) lists the kinds used.
- Edge: 1.25px `--ink-3`, arrowheads 6px; label `mono-sm` `--ink-2` on a `--paper` halo (2px). Kind `cycle`: `--accent` 1.5px dashed. Async/optional: dashed.
- Interactions: design-tool pan and zoom (scroll pans, Space-drag or middle-drag pans, Ctrl+scroll and pinch zoom, drag on empty canvas selects a box). Hover a node: its edges and neighbours go full strength, others 30%. Click or Enter: detail card in the right margin (label, kind, detail in `read-sm`, citations, `Open at line O`). Arrows walk to neighbour nodes along edges (Up/Down between layers, Left/Right within a layer). Search box top left (`F`): type to filter, matches ringed in `--ink`, others 20%. Zoom controls bottom right: `-`, `100%`, `+`, `Fit 0`. Labels never render under 12px; below 60% zoom labels hide and nodes show kind colour only.
- Running: nodes appear as the JSON validates, placed by layout once; never animate the layout on load (no force simulation jiggle).
- Empty: `No nodes. The model found nothing to map in neoforge.` Huge: over 120 nodes is refused by the validator; over 60 starts in focus mode.
- Export: SVG, PNG (2x), Mermaid text.

### 12.3 Sequence
- Actors across the top as header boxes (`ui-strong` on actor kind `fill`, 1px `mid`), 160px apart minimum, sticky when scrolling vertically. Lifelines 1px dashed `--rule-strong`.
- Steps numbered down the page, 40px row pitch: arrow 1.25px `--ink-2` with 6px head (async: dashed with open head; return: dashed thinner), label above the arrow in `ui-sm` `--ink`, step number in a 16px circle `mono-sm` at the arrow's start. Notes: a `--paper-2` box with 1px `--rule`, `read-sm` 14px, attached to the actor's lifeline. Steps with `ref` carry the status glyph after the label and open the drawer on click.
- Activation bars: 8px wide `--paper-3` boxes on a lifeline between a request and its return.
- Keyboard: Up/Down steps through steps (highlight row with band of the ref's layer, or `--paper-3`), Enter opens ref, `O` same.
- Empty: `No steps.` Huge: 60 steps max by contract; over 30, a step minimap appears on the right edge.
- Play: a `Play` button and `Space` send a 9px packet (`--ink` with a `--paper` ring) along each arrow in turn, the row, list and step panel advancing with it; bars open on the callee as the call lands and close as the reply leaves. Next to it, `Follow code` (shown when a step has a ref, remembered per viewer) opens each step's ref in the drawer as the packet lands. Play never starts on open. J/K and the arrows stay instant and stop a run. `Esc` stops a run first, a second `Esc` closes the drawer.
- Export: SVG and Mermaid.

### 12.4 Plan
- Toggle `List` / `Columns` (segmented). Default List under 1280 wide, Columns at 1280+.
- Phase header: `PHASE 1` kicker + name `headline-sm` + segment bar of tasks done (`3 of 5 tasks`).
- Task card (radius 6, 1px `--rule`, `--paper`, padding 12): id `T1.2` in `mono-sm` `--accent`, title `ui-strong`, estimate pill `S` / `M` / `L` (`mono-sm`, 1px `--rule-strong`, radius 2), detail `read-sm` (3 lines, expand), file chips (`mono-sm` on `--paper-3`, radius 2, path middle-truncated, click opens drawer if the file exists, otherwise dashed border meaning "new file"), depends-on badges (`after T1.1` `mono-sm` `--ink-3`; unmet deps show `--moved`), acceptance checklist (checkboxes, `read-sm`), ref glyph if present.
- Task states: todo; in progress (any acceptance checked) left 2px `--moved-line`; done (all checked) title stays unstruck, card ground `--paper-2`, a verified glyph replaces the id colour; blocked (deps unmet) the checkbox list is enabled but a line `Blocked by T1.1` in `--moved`.
- Checkbox changes PATCH the artifact immediately (optimistic, roll back with an inline `Could not save` on failure).
- Empty: `No tasks.` Huge: over 80 tasks, Columns view virtualises cards.
- Export: Markdown checklist, GitHub issues bundle (markdown files plus a `gh issue create` script shown as text, never run).

### 12.5 Quiz and flashcards
- **Quiz mode**: one question per page centred in a 640 column. Counter `Question 4 of 20` in `numeral-md`. Question in `headline-sm`. Options as full-width 44px rows (radius 4, 1px `--rule-strong`, `ui` 15px), keyboard `1` to `9` select, `Enter` checks. After check: correct option gets `--verified-wash` and verified glyph, a wrong pick gets `--unverified-wash` and the query glyph, then the explanation in `read-sm` with its citation chip. Short answers: text field, checked by the model with result and citation. Score strip at top: segments per question coloured verified / unverified / `--rule-strong` unanswered.
- **Flashcard mode** (flashcards recipe default): one card 560 x 340, radius 6, `--paper`, 1px `--rule-strong`, neatline, contour relief faint in the bottom right corner (static, under no text). Front: `CARD 4 OF 12` kicker, prompt in `headline-sm` centred. Back: answer in `read` + citation chip + path line. Below the card: three piles as counters, `Again 1`, `Left 8`, `Got it 3` (`numeral-md`), and buttons `Again  Left`, `Flip  Space`, `Got it  Right`, `Shuffle  S`.
- States: front, back, end of deck (`12 of 12 done. 9 got it, 3 again.` + `Review the 3 again`), empty (`No cards.`).
- Export: JSON eval set.

### 12.6 File (CLAUDE.md, AGENTS.md, SKILL.md)
- Header meta shows target filename and language.
- Body: tabs `Preview` (markdown rendered in `read`, or highlighted code) and `Edit` (textarea in `code` on `--well`, line numbers, soft wrap off).
- Write bar pinned at the bottom (56px, `--paper-2`, 1px `--rule` top): path field `C:/projects/wtg/CLAUDE.md` (default `<root>/<filename>`), primary `Write to file`, secondary `Copy`, `Download`.
- Write states: file does not exist (primary says `Write`); exists (primary says `Overwrite...` and opens a large dialog with a unified diff in `code` on `--well`, removed lines `--unverified-wash`, added `--verified-wash`, buttons `Cancel` and destructive `Overwrite`); written (inline `Written 14:22 · C:/projects/wtg/CLAUDE.md` with verified glyph, and a toast if the user moved away); refused (path outside a notebook root: error banner `Lectern only writes inside a notebook root. C:/temp is not one.`).
- SKILL.md shows a frontmatter validity line: verified glyph `Frontmatter valid` or `--accent` query `Missing description`.

---

## 13. Empty, loading and error states

Copy is final unless marked.

| Where | State | What shows |
|---|---|---|
| App, no notebooks | empty | Onboarding sheet (SCREENS.md, screen 9) |
| Notebook, no sources | empty | rail shows three dashed slots under PINNED DOCS, CODE ROOTS, YOUR REPO with `+ Add`; page shows the onboarding sheet's add step |
| Notebook, sources, no questions | empty | page: kicker `QUESTION 001`, headline in `--ink-3` italic `Nothing asked yet.`, below it three example questions generated from the sources as quiet link rows (not cards), e.g. `How do I register a client-to-server packet?`; composer focused |
| Answer, no citations | warning | receipt caption `This answer has no citations. Treat it as a sketch.`, gutter empty |
| Answer, model refused or empty | error | banner `The model returned nothing. Retry  R` |
| Answer, sources out of scope | info | banner `Asked 2 of 5 sources. Widen scope  /` |
| Index building | loading | rail rows show segment bars; composer works on indexed sources; banner `neoforge is still indexing (412 of 956). Answers may miss it.` |
| Citation check slow (over 3s) | loading | chips stay pending; receipt caption `Checking 3 citations...`; never blocks reading |
| Citation file missing | error | chip and mark unverified, hover card `File no longer exists at this path.` |
| History empty | empty | `No questions yet.` `ui-sm` `--ink-3` |
| Studio, no sheets printed | empty | Printed sheets column: `No sheets yet. Pick one from the index and press Enter.` and a faint contour drawing of an empty sheet (static SVG 120 x 80) |
| Studio recipe needs missing input | disabled | cell disabled state with reason |
| Palette, no results | empty | `No match. Enter asks "<query>" across all sources.` |
| Source drawer loading | loading | header and line-number column, `Reading <file>` |
| MCP/CLI down | warning | rail footer dot `--ink-4`, `MCP · CLI off`, tooltip with the start command `lectern serve` |
| Network/model API unreachable | error | composer error line `Cannot reach the model. Check your connection or API key in Settings.` |
| Write refused | error | see 12.6 |
| Any unexpected error | error | banner with the message, `Copy details`, and `Retry` where possible. Never a blank pane |

Loading rule: anything under 300ms shows nothing. 300ms to 1s shows the frame of the destination (header, rails) with no placeholder blocks. Over 1s shows a determinate segment bar or the trail. No spinners anywhere.

Jokes allowed (one per screen, only here): onboarding (`A blank sheet. Every good map starts as one.`), empty Studio, about sheet (`Surveyed by Lectern. Ground truth or nothing.` is fine in about, never in the masthead).

---

## 14. Signature moments
These are the things that make it unmistakable. Build them with the most care.

1. **The benchmark in the gutter.** A column of tiny cut marks down the left of every answer, one per claim, moved ones carrying their new line `L96`. You can audit an answer by glancing down the gutter without reading or clicking.
2. **The stamp.** As each citation check lands, its chip settles and its gutter mark inks in with a 0.15-bounce, 200ms. It is the one moment of delight in the daily loop, and it is honest: it only happens when a check really finished.
3. **The receipt.** Big Newsreader numerals at the head of the margin, `2 1 0 1`, verified moved unverified uncited, with the plain caption. When every citation is verified the double rule draws once (and the optional peg tick plays).
4. **Layers.** Every source is a map layer with a pastel tint and a hatch. The same tint marks the claim band, the chip, the card edge, the scope chip, the graph node. You learn which colour is your repo within a day.
5. **The claim cursor.** J and K walk claims; the clause lifts to band-strong, the caret bar sits in the gutter, the margin card rings, `O` opens the file at the line. Auditing an answer is a keyboard rhythm.
6. **The sheet index.** Studio's 24 recipes as a numbered map-sheet grid, rows by group, contour lines running between the cells. Type to filter, two digits to jump, Enter to print.
7. **The print.** When a sheet finishes, its cell's neatline closes, the cover title settles out of a two-ink riso offset, and the printed sheet drops into the list. Once per generation.
8. **Sheet covers and exports.** Wide 56px map caps, contour relief, group tint, sheet number in vermilion, the colophon line on every export. This is where the zine energy lives.
9. **The question as a headline.** Newsreader 34px, the first sentence upright and anything after it in italic: `How do I register a client-to-server packet? *I only know SimpleChannel.*`
10. **Numbered questions.** Every answer is `Question 047`, the same number in History, the breadcrumb, the CLI (`lectern show 047`) and MCP, so agents and people refer to the same thing.

---

## 15. Accessibility

- Contrast: every text pairing in 3.6 meets WCAG AA (4.5:1) and APCA Lc 60 for content text in light mode; dark mode content text is Lc 57 to 92 (metadata at Lc 57 to 60 is set at 11.5 to 12.5px with weight 450 to compensate). High contrast mode (3.7) for anyone who needs more.
- Status never relies on colour: glyph shape (mark / mark+arrow+line / dashed query ring / outline / nothing) plus the word in hover cards, margin cards and the receipt. Layers never rely on colour: hatch plus name.
- Forced colors (`@media (forced-colors: active)`): glyphs use `currentColor` with `CanvasText`; bands become a 2px `Highlight` underline; hatches are replaced by the layer's first letter in a 12px box.
- Keyboard: everything reachable and operable; order follows reading order (rail, page header, answer, chips in order, actions, composer, margin). Skip link `Skip to answer` as the first tab stop. Visible focus ring on every focusable element.
- Screen readers: landmarks (`nav` rail, `main` page, `aside` margin, `form` composer). Chips are buttons labelled `Citation 3, moved, networking/payload.md line 96`. Gutter marks are `aria-hidden` (the chip carries the state). Receipt has a full `aria-label`. Streaming announced per paragraph. Claim cursor announces claim number, status and text. Toasts use `role="status"`; blocking errors `role="alert"`.
- Hover content is also available on focus and stays while the pointer moves onto it (WCAG 1.4.13), dismissible with Esc.
- Targets 24 x 24 minimum; dense rows are 28px tall full-width targets.
- Text resizes to 200% without loss: the layout reflows (margin folds at effective widths under 1280).
- Reduced motion per 8.5. Reduced transparency is a no-op (there is none). Sound is off by default and never the only signal.
- Language: plain words, no jargon on buttons, survey terms explained in tooltips.

---

## 16. Never do

- Violet or indigo as a brand colour, gradients of any kind on surfaces, glassmorphism, backdrop blur, glowing orbs, mesh blobs.
- Chat bubbles, avatars, "AI" sparkle icons, typing dots.
- A centred empty-state hero with three feature cards.
- Narrated reasoning ("Thinking...", "I'll look at", "Let me"). The trail lists actions only.
- "100% cited", trust badges, confidence percentages, any claim the receipt does not support. A single footer disclaimer instead of per-claim status.
- Colour as the only carrier of status or source.
- Bands or texture behind long body text other than claim bands; halftone, grain, tape, stickers, rotated badges, script fonts, offset drop shadows in the working UI.
- Bodoni, Fraunces, Inter-only, Space Grotesk, Geist as the identity.
- Vermilion on anything that is not the mark, a kicker, a sheet number, the scrutiny link, unverified or destructive. Dark text on vermilion.
- Spinners, shimmer skeletons on prose, progress without a count.
- Animating keyboard actions, theme switches, list navigation, palette results. Animations over 420ms in the app (covers and exports are static).
- Smooth-scrolling programmatic jumps, or auto-scrolling while the user reads above the bottom.
- Reflowing text when a citation resolves.
- Raw citation tokens (`[[...]]`, `@1`) in rendered output.
- Prose lines longer than 68ch.
- Weight changes on hover or selection.
- Modal dialogs for errors or success.
- Typing a count that the data provides (recipes, sources, files, citations are always computed).
- Survey jargon on primary buttons.
- Any recipe text, empty state or default copy that assumes Minecraft or NeoForge (only the sample notebook content does).

---

## 17. Implementation notes

### 17.1 CSS variables
Put this in `styles.css` (abridged; layer steps follow the same naming for all eight layers: `--water-fill`, `--water-band`, `--water-band-strong`, `--water-mid`, `--water-ink`, and so on; values from 3.3):

```css
:root, :root[data-theme="light"] {
  color-scheme: light;
  --paper: oklch(0.985 0.006 85);   --paper-2: oklch(0.966 0.010 84);  --paper-3: oklch(0.940 0.014 82);
  --well: oklch(0.958 0.012 220);   --rule: oklch(0.890 0.014 80);     --rule-strong: oklch(0.800 0.016 75);
  --ink: oklch(0.240 0.018 60);     --ink-2: oklch(0.400 0.018 60);    --ink-3: oklch(0.500 0.016 62);  --ink-4: oklch(0.640 0.012 65);
  --accent: oklch(0.540 0.180 31);  --accent-wash: oklch(0.950 0.030 31);
  --verified: oklch(0.470 0.110 150); --verified-wash: oklch(0.950 0.035 150);
  --moved: oklch(0.500 0.110 65);   --moved-wash: oklch(0.935 0.065 85); --moved-line: oklch(0.740 0.130 75);
  --unverified: var(--accent);      --unverified-wash: oklch(0.945 0.035 28);
  --pending: var(--ink-4);          --contour: oklch(0.860 0.030 75);
  --water-fill: oklch(0.925 0.045 235); --water-band: oklch(0.950 0.032 235); --water-band-strong: oklch(0.905 0.060 235);
  --water-mid: oklch(0.780 0.080 235);  --water-ink: oklch(0.440 0.090 235);
  /* heath 305, spruce 190, sand 80, moor 350, lichen 115, clay 50, dusk 270: same L/C */
  --float: 0 1px 0 rgb(38 29 23 / 0.04), 0 10px 28px -10px rgb(38 29 23 / 0.22);
  --scrim: rgb(38 29 23 / 0.18);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* same block as below */ } }
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: oklch(0.195 0.018 252);  --paper-2: oklch(0.225 0.020 252); --paper-3: oklch(0.265 0.022 252);
  --well: oklch(0.165 0.016 240);   --rule: oklch(0.360 0.020 252);    --rule-strong: oklch(0.470 0.020 252);
  --ink: oklch(0.930 0.012 85);     --ink-2: oklch(0.850 0.012 85);    --ink-3: oklch(0.760 0.012 85);  --ink-4: oklch(0.610 0.012 85);
  --accent: oklch(0.780 0.140 38);  --accent-wash: oklch(0.280 0.050 31);
  --verified: oklch(0.780 0.120 150); --verified-wash: oklch(0.270 0.045 150);
  --moved: oklch(0.820 0.120 80);   --moved-wash: oklch(0.300 0.055 80); --moved-line: oklch(0.700 0.120 75);
  --unverified-wash: oklch(0.290 0.055 28); --contour: oklch(0.400 0.025 250);
  --water-fill: oklch(0.330 0.055 235); --water-band: oklch(0.285 0.045 235); --water-band-strong: oklch(0.350 0.070 235);
  --water-mid: oklch(0.620 0.090 235);  --water-ink: oklch(0.860 0.060 235);
  --float: 0 1px 0 rgb(0 0 0 / 0.3), 0 12px 32px -8px rgb(0 0 0 / 0.55);
  --scrim: rgb(4 8 12 / 0.55);
}
```

Source elements carry `data-layer="water"`, and a small rule maps it to generic names so components never hard-code a hue:
```css
[data-layer="water"] { --l-fill: var(--water-fill); --l-band: var(--water-band); --l-band-strong: var(--water-band-strong); --l-mid: var(--water-mid); --l-ink: var(--water-ink); }
```
Studio cells do the same with `data-group="plan"` mapping to clay, and so on.

Body: `background: var(--paper); color: var(--ink); font: 450 13px/20px var(--font-ui);`.

### 17.2 Data the UI needs from the server
- Per source: `layer`, `kind` (`docs` | `primer` | `root` | `repo`), `version` (for roots), `branch` and `dirty` count (for repos), file count, index time, index progress.
- History, local only. Per answer and per artifact: `commits`, `{ [root]: { sha, dirty: [paths] } }` for the roots whose files it read or cited. `GET /api/notebooks/:nb/history/was?path&sha` returns the file at that commit (2 MB cap, `binary`, `truncated`), and `.../history/changes?path&sha&line&endLine` returns the commits since that touched the lines (or the path, with `by: 'path'` and a `change` letter per commit). `sha` is a full lowercase hex hash and nothing else.
- Per citation: `n`, `path`, `line`, `foundLine`, `status` (`pending` | `verified` | `moved` | `unverified`), `quote`, `span` (character offsets of the claim in the answer), `layer`, `saw` (for code: `from`, `to`, `text` and `read`, the saved lines and which of them the trail read; the word diff is worked out in the browser from `saw.text` and the file, nothing is stored for it), `sha` (the git HEAD of its code root when the answer was written) and `dirty` (true when its file differed from that commit then).
- Per answer: `number` (047), trail steps with `tool`, `args`, `result`, `ms`, and an `uncited` sentence count.
- Per citation after a re-check: `status0`, `line0`, `checkedAt0` (as written) and `drift` (dated changes), plus `citeCheck.checkedAt` and `checkedAt0` on the turn or sheet. The reopen replay (8.2, 11.7, 11.9) reads these. A sheet's written date is `generatedAt`; older sheets fall back to `updatedAt`.
- Per artifact: `sheet` number (stable, per notebook, assigned at creation), group, plus the existing artifact fields.
- Per recall hit (`GET /api/recall`): `kind` (`answer` | `note` | `sheet`), `notebook`, `notebookTitle`, `id`, `turn` (answers), `num` (the question number, answers), `title`, `at`, `score`, and `cites` (`total`, `verified`, `moved`, `unverified`, `missing`, checked again when asked; `null` for notes).

### 17.3 Files
- `public/styles.css`: tokens, base, components 11.x.
- `public/ui/cites.js`: chips, gutter marks, claim cursor, hover card, receipt.
- `public/ui/chat.js`: becomes the page (question headline, trail, streaming reveal, actions, composer).
- `public/ui/rail.js`: legend and history. `palette.js`: palette per 11.14. `viewer.js`: source drawer. `studio.js`: sheet index, form, printed sheets.
- `public/studio/*.js`: the six renderers per section 12, shared sheet header in `common.js`.
- `public/sounds.mp3`, `public/marks.svg` (symbol sprite: mark, moved, query, pending, kind glyphs, sheet).
