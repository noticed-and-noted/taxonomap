# Taxonomap design system

The rules for how Taxonomap looks. Read this before changing anything visual: colours, type, the logo, or a new component.

The code is the source of truth. This file explains it and names where each part lives; if they disagree, fix this file.

| Part                         | Lives in                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Colour, radius, motion       | `src/styles/tokens.css`                                                                                                              |
| Fonts, Tailwind theme, bases | `src/styles/global.css`                                                                                                              |
| Map density ramps            | `src/lib/ramp.ts` (choice stored by `src/stores/ramp.ts`)                                                                            |
| Logo                         | `docs/brand/wordmark-light.svg` (the master artwork); paths in `src/lib/wordmark.ts`, drawn by `src/components/atoms/Wordmark.astro` |
| Favicon                      | `public/favicon.svg`                                                                                                                 |
| Logo artwork                 | `docs/brand/` (mark, app icon, light and one-colour cuts, logo with outlined letters, README banners)                                |
| Brand board                  | Claude artifact "Taxonomap brand" (canvas, for reference)                                                                            |

## Principles

- **The data is the colour.** Chrome stays quiet (forest and paper neutrals) so the density hexes and photos carry the page. One accent, used sparingly.
- **Field notebook, not dashboard.** Serif headings, a soft serif wordmark, warm paper in light mode. Avoid glossy gradients, glows and neon.
- **Two equal themes.** Dark "forest" is the default; light "paper" is a full theme, not an afterthought. Every change is checked in both.
- **Accessible by default.** Text meets WCAG 2.2 AA (4.5:1) on `--bg` and `--surface` in both themes. Never rely on hue alone.

## Colour

Always use the tokens (`var(--accent)`, or Tailwind's `bg-surface`, `text-muted`, `border-border` and so on). Don't write hex values in components. The exceptions are places that can't read CSS: the satori Open Graph card and MapLibre fallbacks. Keep those in step with the tokens by hand.

### Dark theme (default)

| Token               | Value                    | Name   | Use                               |
| ------------------- | ------------------------ | ------ | --------------------------------- |
| `--bg`              | `#0e1813`                | Forest | Page background, app-icon tile    |
| `--surface`         | `#14221b`                | Canopy | Panels, pills, cards              |
| `--surface-2`       | `#1b2d24`                |        | Hover, nested surfaces            |
| `--surface-3`       | `#243a2f`                |        | Pressed, deepest nesting          |
| `--border`          | `#2c4437`                | Moss   | Hairlines                         |
| `--border-strong`   | `#3f5c4c`                |        | Emphasised dividers               |
| `--text`            | `#f2ede2`                | Bone   | Body text, wordmark (15.5:1)      |
| `--text-muted`      | `#a8b8ae`                | Lichen | Secondary text (8.7:1)            |
| `--text-subtle`     | `#93a79b`                |        | Captions, metadata (7.1:1)        |
| `--accent`          | `#e89141`                | Amber  | Selection, focus, the fern's coil |
| `--accent-contrast` | `#1d1404`                |        | Text on an accent fill            |
| `--accent-soft`     | `rgb(232 145 65 / 0.16)` |        | Selected-row and active tints     |
| `--focus`           | `#f2a865`                |        | Focus ring                        |
| `--danger`          | `#ff8a7a`                |        | Errors                            |

### Light theme (`[data-theme='light']` on `<html>`)

| Token               | Value                   | Name   | Use                               |
| ------------------- | ----------------------- | ------ | --------------------------------- |
| `--bg`              | `#f5efe3`               | Paper  | Page background                   |
| `--surface`         | `#fdfaf3`               | Vellum | Panels, pills, cards              |
| `--surface-2`       | `#efe7d7`               |        | Hover, nested surfaces            |
| `--surface-3`       | `#e5dbc6`               |        | Pressed                           |
| `--border`          | `#d8ccb5`               | Sand   | Hairlines                         |
| `--border-strong`   | `#b9a989`               |        | Emphasised dividers               |
| `--text`            | `#0e1813`               | Forest | Body text, wordmark (15.8:1)      |
| `--text-muted`      | `#3f5c4c`               | Fern   | Secondary text (6.4:1)            |
| `--text-subtle`     | `#556159`               |        | Captions, metadata (5.7:1)        |
| `--accent`          | `#a45710`               | Rust   | Selection, focus, the fern's coil |
| `--accent-contrast` | `#fffaf0`               |        | Text on an accent fill            |
| `--accent-soft`     | `rgb(164 87 16 / 0.12)` |        | Selected-row and active tints     |
| `--danger`          | `#b3261e`               |        | Errors                            |

`--leaf` (`#27553a`, Leaf) colours the leaf on the fern mark in both themes. It is decoration, not text: on forest it sits low (2.1:1), as drawn.

**Accent rules.** The accent marks what is selected, active or focused, plus the fern in the logo. It is not a decoration colour and not a second button style. Text on an accent fill uses `--accent-contrast`.

### IUCN Red List

`--iucn-{lc,nt,vu,en,cr,ew,ex}` fill the code square in the species page's Red List chip, each with a matching `-text` colour (4.5:1 or better). Threat levels rise in hue and lightness from amber (Near threatened and Vulnerable share one colour) to coral in forest, and from bright amber (with dark text) to brick red on paper. Extinct uses the text colour. The chip always shows the category name too, so the colour is never the only cue. Species GBIF lists as "not evaluated" or "data deficient" get no chip.

### Range dots

`--range-introduced` (the `--iucn-en` orange) and `--range-invasive` (the `--iucn-cr` coral) mark the rows of the species page's "Introduced range" list. They sit beside a text label, so they never carry meaning alone.

### Basemap land

`--map-land` fills the plain basemap's land: `#2c4437` (Moss) on forest, lifted off `--bg` so the map shows under the hexes, and `--bg` on paper. On the dark style, water drops to `--bg` so land reads lighter than sea, as on paper.

### Map density ramps

The hexes are shaded on a log scale through 8 stops, `--ramp-0` to `--ramp-7`. The map bins use stops 1 to 7. Charts that want a single data colour use `var(--ramp-4)`.

- The default is **Lichen to fern** (deep teal to pale straw), set in `tokens.css` and as `DEFAULT_RAMP` in `src/lib/ramp.ts`. A unit test keeps the two in step.
- Viewers can pick another ramp under Settings on the map's left rail (or in the phone filters sheet). The choice is saved in `localStorage` (`map-colours`) and written onto `<html>` as `--ramp-*` overrides.
- Choices: Lichen to fern, Viridis, Forest to pollen, Cividis, Plasma, Mako, Batlow, Bamako.
- A new ramp needs 8 stops that rise steadily in lightness from dark (few records) to light (many), so the order reads in greyscale. Its end stops must stay visible on both basemaps.

## Typography

| Role               | Font                        | Token / class                            | Notes                                                  |
| ------------------ | --------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| Interface and body | Lexend (variable)           | `--font-sans` (the default)              | Everything that isn't a heading                        |
| Headings, display  | Source Serif 4 (variable)   | `--font-serif`, `h1–h3`, `.font-display` | Optical sizing on, tracking −1%                        |
| Scientific names   | Source Serif 4 italic       | `.sci-name`                              | Every Latin binomial, everywhere                       |
| Wordmark only      | Fraunces SemiBold, outlined | none (artwork, not a loaded font)        | The letters are drawn shapes; the font is never loaded |

- Fonts are self-hosted through `@fontsource` packages. Don't add Google Fonts links. The sans and serif files are preloaded in `BaseLayout.astro`.
- Use sentence case for headings, buttons and labels.
- Use `tabular-nums` wherever counts sit in columns or change live.

## Logo

The logo is a **fiddlehead fern** (a frond unfurling: life still being discovered) to the left of the word **Taxonomap** in Fraunces SemiBold.

- **The wordmark**: Fraunces SemiBold, optical size 70, softness 20, no wonky letters, letter spacing 0.045em. Capital T, the rest lowercase. In the artwork the mark is about as tall as the type size and sits 0.17em from the T. Never retype the wordmark, and never show the plain word as a logo. In running text the name is plain "Taxonomap".
- **The mark**: a coil ending in a ball, on a stem that sweeps down to the left, with one leaf. Coil, stem and ball use `--accent`; the leaf uses `--leaf`. The letters use `--text`. So the logo follows the theme with no extra artwork.
- **The artwork is the master.** `docs/brand/wordmark-light.svg` is the logo as designed on the brand board (exported from it, letters outlined); `wordmark-dark.svg` is the same artwork recoloured. Never retype the wordmark. Change the master, then update its copies: the paths in `src/lib/wordmark.ts` (`LOCKUP`, drawn by `Wordmark.astro`; the mark alone as `BALL`, `COIL` and `LEAF`, drawn by `Wordmark.astro` on phones, `WebglNotice.vue` and `ChecklistFinish.vue`), the README banners, the mark files, the app icon and the favicon. The Open Graph card reads `wordmark-dark.svg` directly. The artwork is 104.78 units to the em: `Wordmark.astro` draws it with the word at 1em, so the logo sizes from the parent's font-size (22 px in the header pill).
- **Small screens**: below 640 px the header shows the mark alone (the letters are hidden). The link keeps its "Taxonomap home" label for screen readers.
- **Clear space**: keep at least half the coil's width clear around the logo. The bare mark stays at least 24 px tall; below that, use the app tile.
- **Colourways**: on forest, Amber mark and Bone letters. On paper, Rust mark and Forest letters. The leaf is Leaf on both. One colour: all Forest on paper or Amber.

### Icons

- **Favicon** (`public/favicon.svg`): the app icon as is (the mark on a Forest rounded square, rx 14 of 64), so the browser tab matches the logo. At 16 px the leaf merges into the tile; that is accepted.
- **App icon** (`docs/brand/app-icon.svg`): the mark on the tile, for 32 px and up (social avatars, home screens). `src/pages/icons/[name].png.ts` renders the PNG cuts from it at build: 192 and 512 px for the web app manifest, a full-bleed 180 px `apple-touch-icon` (iOS rounds the corners itself), and a full-bleed maskable 512 px with the mark shrunk into Android's safe zone.
- **Browser bar**: `theme-color` follows the chosen theme (`--bg`: Forest or Paper). Its two values sit on the meta tag in `BaseLayout.astro`.
- Don't add other logo variants; derive from these files.

## Shape, depth and motion

- **Radius**: `--radius-sm` 6 px (chips, small controls), `--radius` 10 px (pills, inputs, buttons; Tailwind `rounded-md`), `--radius-lg` 16 px (panels, flyouts, cards).
- **Shadow**: one shadow, `--shadow` (`shadow-panel`), only on things floating over the map (header pills, rail, panels, legend). Content inside a panel is flat and uses borders.
- **Borders**: 1 px `--border` hairlines. Use `--border-strong` only for emphasis.
- **Motion**: `--ease` with `--dur-fast` (200 ms) for hovers, `--dur` for panels, `--dur-slow` (300 ms) for flyouts. All drop to 0 under `prefers-reduced-motion`.

## Layout and components

- **The map is the page.** The header, rail, panels and legend float over it as separate pills with gaps (`--header-gap`), never as a solid bar. Wrappers are `pointer-events: none` so the gaps pass clicks through to the map; only the floating pieces are clickable.
- **Header** (`SiteHeader.astro`): wordmark pill, search, nav pill (Map, Tree of Life), theme toggle. Height `--header-height` (44 px).
- **Footer** (`SiteFooter.astro`, content pages only): the wordmark linking home beside the privacy and terms links (the pages live on the main site, taxonomap.com), at the species page width. A page's data credit (`.page-credit`) sits directly above it as one block under a single rule.
- **Mode switch**: Explore, Near me and Analyse. From 1000 px it's a `SegmentedControl` at the top right of the map, as tall as the basemap switch beside it (2rem), the selected mode in accent, its corners concentric with the container's (`--radius` less the 1px border and 2px padding, as in the basemap switch); below that, one accent `ModeMenu.vue` button names the mode and drops the other two out beneath it, one after the other.
- **Analyse panel**: with no species, a filter box, the count, then the starting list, which scrolls inside the panel (most of the screen in the phone sheet), each row a 44 px photo (`SpeciesThumb.vue`), its names, small dotted tags (Migrates in `--ramp-4`, Introduced and Invasive in the range colours) and a joined Migration | Spread button; with one, the species card with Change, the Years setting (a closed summary row that opens to a two-handle slider and presets) and underlined Migration and Spread tabs, as in Near me. Migration shows the month in the serif display face with its record count, 12 month bars in `--ramp-4` with the picked one in accent (each a button), then a 44 px accent Play and 40 px back and on buttons. Spread is the same frame by year: each bar stacks the cells first recorded that year (`--ramp-7`) on those recorded before (`--ramp-2`), the map's spread cells use the same two colours (keyed under the chart, as the density legend is hidden), with All to date or New only as a `SegmentedControl`, and the countries list with introduced and invasive dots in the range colours.
- **Phone bottom row** (below 1000 px): a wide button named after the mode, which opens Explore's results, Near me's list or Analyse's panel, with the record count in Explore (everything the filters match) and Near me (within the radius); and Filters as a square icon button with its count badge. Both are 44 px tall with `--radius` corners. From 768 px the side panel's own tab opens the list, so the row keeps just Filters. The legend dock and MapLibre's zoom and info buttons sit above the row, info on top.
- **Map controls**: MapLibre's zoom buttons and folded credits (the info button) are restyled in `MapCanvas.vue` to match: 40 px squares in a `--border` hairline box with `--radius` corners and the shadow, the house stroke icons drawn in `--text` (info in `--text-muted`) through a CSS mask so both themes need no filter, and the `--focus` ring for keyboard focus only.
- **Left rail** (`FilterRail.vue`): icon buttons with short labels (What, When, Where, How, Source, then Settings after a divider). Each opens a flyout beside the rail. The flyout's heading stays put and only its body scrolls. Below 1000 px (the `rail` breakpoint) the rail gives way to a Filters button that opens the filters sheet.
- **Text links**: a plain `<a>` with no class gets the house link style (underlined in `--accent`, accent on hover) from `global.css`. Don't restyle links per page; give a link a class only when it isn't a text link (a button, chip or nav item).
- **Search boxes** use `SearchInput.vue`: the leading icon, a spinner while results load, and its own clear button (iOS Safari draws none). Don't hand-roll a `type="search"` input.
- **Long scrolling lists** get edge fades: the `.fade-list` class plus `useScrollFade`. In markup that never hydrates (the pre-rendered species page), add `.fade-scroll` instead of the composable; it drives the same fades from CSS.
- **Names still loading**: a result whose iNaturalist name is on its way holds the name's place with `NameSkeleton.vue`, so a name never shows and then changes. Its scientific name shows throughout.
- **Toggles** (`SegmentedControl`; the basemap switch uses it too): one accent highlight sits behind the selected option's text, inside the control, and slides to the next option picked (`--dur`, `--ease`), so it moves with the control and never covers a label.
- **Selected state**: an accent border with an `--accent-soft` fill and a small "Selected" label in accent. Don't add checkmark icons.
- **Visually hidden radios or checkboxes** inside a label: give the label `position: relative`, so focusing the input doesn't scroll the page.
- **Icons**: 24×24 stroke icons, `stroke-width` 1.7, `currentColor`, round caps and joins. Mark them `aria-hidden`; the control carries the label.

## Reading settings

Viewers can change how text reads from the welcome card ("Reading and display options") or under Settings. `src/stores/reading.ts` saves the choices in `localStorage` (`reading`) and writes them onto `<html>` as data attributes, which the rules at the end of `global.css` style. An inline script in `BaseLayout.astro` applies them before first paint.

- **Text size** (`data-text-size`): `large` is 112.5%, `larger` 125% of the root size. Size text in `rem`, never `px`, so it scales.
- **No italics** (`data-no-italics`): everything upright, scientific names included.
- **Wider spacing** (`data-wide-spacing`): WCAG 1.4.12 letter, word and line spacing. Check new layouts don't clip with it on.
- **Reduce motion** (`data-reduce-motion`): the same as `prefers-reduced-motion`. In script, ask `prefersReducedMotion()` rather than the media query.
- **Render scale** (`renderScale`, no attribute): how many canvas pixels the map draws per CSS pixel. Max (3×), High (2×, the default) or Low (1×), never more than the screen's own density; `mapPixelRatio()` in the store works it out. Filling pixels is the costliest part of a frame on a phone, so a 3× phone draws at 2× unless its viewer picks Max, and Low is for older phones. The control offers only the scales the screen can tell apart (`renderScalesFor()`): Max on screens denser than 2×, High on screens denser than 1×, and nothing on a 1× screen. Keep `backdrop-filter` off surfaces over the map: it is redrawn every map frame.
- The welcome card also offers the map colours as a dropdown, colour-blind-safe ramps first (`colourBlindSafe` in `src/lib/ramp.ts`).

## Accessibility checklist

- Text contrast is AA in both themes. Check new colour pairs; `tokens.css` notes the ratio next to each text token.
- Every control works by keyboard and shows the `--focus` ring (`:focus-visible`, 2 px).
- Icon-only buttons have an `aria-label`; decorative SVG is `aria-hidden`.
- Colour-coded things also differ in lightness or carry a label.
- Respect `prefers-reduced-motion` (the duration tokens already do).
- Touch targets are at least 44 px on phones.
