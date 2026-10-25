# minimal gallery v2: design handoff

The map for the theme builders. The prototype in `design/prototype/` is the source of truth: `build.mjs` (markup), `mg.js` (behavior), `styles/site/*.css` (the mCSS theme and blocks). Rationale and review history are in `design/brief.md`.

## 1. Direction

A slide show in a dark room: the photo is the page, on a near-black neutral ground (`oklch(0.14 0 0)`), with no color in the chrome. All chrome is a translucent HUD surface (dark fill, background blur, 1px hairline) that floats over the photo and steps aside when the pointer rests. Browsing is a panel that slides up under the viewer; metadata is navigation, so every value links to its context.

## 2. Page model

- **One template for every context.** A context is all photos (home), an album or a facet (year, month, place, camera, lens, focal range, aperture, shutter, ISO, keyword). Every page is the viewer (stage) on top and the panel (the context’s photos) below, exactly one window tall, with mandatory snapping between the two states.
- **Initial position.** Home and photo pages open on the viewer. Album and facet pages open on the panel (`scroll-initial-target` on `.table-start`, plus `#grid` on every link to a context, plus `mg.js` scrolling there when the page is still at the top: Chrome 156 supports the property and still opened these pages on the viewer), with the viewer showing the context’s first photo.
- **Context URLs.** Photo pages are `p/<slug>.html` and carry their album statically. Inside another context, links are `p/<slug>.html?in=<id>`, where the id is the context page’s path without `.html` (`grid` for all photos, `a/feelings`, `f/camera-nikon-d200`). `mg.js` applies `<id>.json` (cached in sessionStorage) to prev/next, rel links, image preloads, breadcrumb, strip, grid, list and rail.
- **Context JSON:** `{ title (null for all photos), href, photos: [{ slug, href, title, ar, color, year, tip, cells, sort, thumb, preview, src, srcset, w, h, zoom, info, caption }] }`. `cells` holds the list columns as `[text, href]` pairs; `sort` holds one real sort value per sortable column. `src`, `srcset`, `w`, `h` and `zoom` are the viewer image; `info` is the info pane’s rows as `{ term, html, exposure? }` from `infoOf()`, the same function the static pane renders, and `caption` the caption’s markup. The JSON carries everything a photo page shows, so a step needs nothing else.
- **Steps stay in the page.** With script, next and previous (arrow keys, the click zones, a swipe, a strip frame, and back and forward between two photos of the same context) are not navigations. `mg.js` resolves the photo from the context JSON (loaded after the page loads, cached in sessionStorage), adds a second image to the stage and crossfades it in with a CSS opacity transition, then updates the title, breadcrumb, info pane, prev/next links, neighbor preloads, the `--photo` backdrop, `aria-current` in the strip, grid and list, and glides the strip. The strip is never rebuilt and its frames never reload. `history.pushState` sets the photo’s URL (keeping `?in=`); `popstate` steps in place; any photo URL still loads as its static page. Everything else (grid to photo, crumbs, facets, home) is a page load, and without script every step is one.
- **No wrap.** The last photo has no next, the first no previous: no link and no rel, and keys, click and swipe do nothing there.
- **Prerendering.** Chrome prerenders a thumbnail’s page on hover (Speculation Rules, moderate). Neighbors are not prerendered: a step stays in the page, so a prerendered neighbor would be thrown away; their images are preloaded instead (`link rel=preload as=image` with the hero’s srcset, low priority).
- **Prototype-only files.** `grid.html` redirects to `index.html#grid`. `list.html` is all photos in list view. `filter.html` shows the palette inline. In the real build these are not routes: the panel, the list toggle and the palette dialog cover them.

## 3. Blocks

| Block | File | Markup from `build.mjs` |
| --- | --- | --- |
| Surface | `global.surface.css` | `.surface` mixed onto any overlay |
| Toggles | `component.toggle.css` | `.toggle` (segmented fieldset) or `.toggle-plain`, `.toggle_option` label with a hidden input, `.toggle_svg`, `.toggle_tip` (label plus `kbd`), `.toggle_on`/`.toggle_off` for state-swapping icons |
| HUD | `component.hud.css` | `header.hud.surface.viewer_hud`: `.hud_crumbs` (`ol`, h1 last), `.hud_actions`. Floats with margin and radius in fill mode, a full-width bar in fit mode, hidden in panel state |
| Stage | `component.stage.css` | `.stage` > `main.stage_frame[tabindex=-1]` > `.stage_scroller` > `a.stage_next` > `img.stage_photo`; `a.stage_prev` (left third); hidden `.stage_zoom` checkbox; `.stage_strip`; `.stage_hint`. Chevron cursors on the zones, no href at the ends |
| Strip | `component.strip.css` | `nav.strip.surface` > `ol.strip_list` > `li.strip_item` > `a.strip_link[aria-current]` > `img.strip_image`. On when `input[name=strip]` is checked |
| Panel | `component.table.css` | `section.table#grid`: the HUD, `.table_scroller` (size container) > `header.table_head.surface` (`.table_crumbs`, `.table_count`, `.table_tools`, `.table_gridOnly`), then `.table_body` > `.table_photos` + `.table_rail` |
| Thumbs | `component.thumbs.css` | `ol.thumbs` > `li[style=--ar,--photo]` (first of each year carries `id=y-YYYY`) > `a.thumbs_link` > `img` + `span.thumbs_tip.surface`; item and image carry no class, to keep the repeated markup small |
| Ledger | `component.ledger.css` | `.ledger table`: `th[data-type] > button.ledger_sort` (`aria-sort` when active); rows `tr[data-i]`, cells `td[data-sort]`; `a.ledger_thumb` holds `.ledger_preview.surface[style=--preview:url()]` |
| Rail | `component.rail.css` | `nav.rail` > `ol.rail_list` (`scroll-target-group`) > `a.rail_link[href=#y-YYYY]` |
| Panes | `component.pane.css`, `component.info.css`, `component.keys.css` | `aside.pane.pane-info.info.surface#info`, `aside.pane.pane-keys.surface#keys`: `.pane_head` (drag handle), `.pane_title`, `label.pane_close[for]`; contents `.info_list` and `.keys_section` > `dl.keys_list` > bare `dt` (keys) and `dd` (action); the keys pane ends with `p.credit.credit-small.keys_credit` |
| Credit | `component.credit.css` | `p.credit` (“Powered by `a` minimal gallery”) as `.table_credit` at the end of `.table_photos`, centered, with the same space below it as above, and at the bottom of the panel when the photos are few; `credit-small` with the version in the keys pane, at the right; absent when the config’s `credit` is false |
| Slideshow | in `component.stage.css`, `component.playButton.css` | `span.stage_play` (added to `.stage` by `mg.js` when a slideshow first starts): a hairline whose animation over `--mg-slideshow` is the slideshow’s clock; `span.stage_flash.surface[data-state=play\|pause]`, the large icon that answers a start or stop; `div.toggle.toggle-plain.playButton` > `button.toggle_option[aria-pressed]` > one `svg` with both shapes, first in the HUD’s actions (`.hud_play`) and the panel’s tools (`.table_play`), an icon’s width of space after it |
| Palette | `component.palette.css`, `component.chip.css` | `dialog.palette.surface#palette[closedby=any]`, `.palette_search`, `.palette_group` > `a.chip[aria-current]` |
| Tooltips | in thumbs and toggle | One visible at a time. With a pointer they follow it; with keyboard focus they are anchored (`anchor-scope`), and in-thumb without it |

Page level: `page.viewer.css` (snap point and backdrop modes). Theme: `theme.mg.tokens.css`, `theme.mg.ui.css`. Every `::view-transition` rule lives in `global.transitions.css`.

## 4. State and persistence

Each setting lives in localStorage as `mg-<name>` and is mirrored as `data-<name>` on `<html>`. A small inline script in the head (`restore.js`) runs before first paint in every engine and does only what is cheap and visible: the visitor’s stored settings become `data-*` attributes, hidden chrome carries over (`data-idle`), `data-script` marks that the theme script will run, a page that opens on the panel gets `data-panel` at once, and a `pagereveal` that fires before `mg.js` is kept for it. The CSS reads a setting as `:root:is([data-<name>='<value>'], :not([data-<name>]):has(input…:checked))`: the attribute wins when set, and the inputs are the no-script path. The deferred `mg.js` (`restore()`, run again on `pagereveal`) adds the owner’s token defaults, keeps the inputs in step and writes changes back. Checkboxes store their value or `data-off`.

The strip’s frames and, on pages that open on the viewer, the list rows are not in the HTML; they are built from the context JSON. With the JSON cached, an inline call right after the strip builds its frames during parsing, before first paint. On `?in=` pages, prev/next, rel links, image preloads, prerender rules and the breadcrumb apply as soon as `mg.js` runs; the grid and rail are rebuilt only when the panel is wanted or the page is idle after the step’s transition. Without script the page keeps its album and the grid stands in for the list (the grid/list pair and the strip toggle are hidden).

| State | Storage | Default | Owner token | Applied by |
| --- | --- | --- | --- | --- |
| Fit (`fit`) | localStorage `mg-fit`, `data-fit` | cover | `--mg-fit` | `restore.js`, `restore()` |
| Strip (`strip`) | localStorage `mg-strip`, `data-strip` | off | `--mg-strip` | `restore.js`, `restore()` |
| Crop (`crop`) | localStorage `mg-crop`, `data-crop` | square | `--mg-grid-crop` | `restore.js`, `restore()` |
| View (`view`) | localStorage `mg-view`, `data-view` | grid (`meta mg-view` overrides) | `--mg-grid-view` | `restore.js`, `restore()` |
| Size (`size`) | localStorage `mg-size`, `data-size` | m | none | `restore.js`, `restore()` |
| Info pane (`info`) | localStorage `mg-info`, `data-info` | off | none | `restore.js`, `restore()`, `placePane()` |
| Keys pane (`keys`) | localStorage `mg-keys`, `data-keys` | off | none | `restore.js`, `restore()`, `placePane()` |
| Pane positions | localStorage `mgPane-info`, `mgPane-keys` | top right / top left | none | `placePane()` |
| Hidden chrome | sessionStorage `mgIdle`, `data-idle` | shown | `--mg-hud-idle` | `restore.js`, `restore()` |
| Slideshow | `data-play` (not stored) | off | `--mg-slideshow` | `play()`, `replay()` |
| Panel state | `data-panel` from scroll position | none | none | `restore.js` (pages that open on the panel), `syncPanel()` |
| Strip scroll on a step | sessionStorage `mgStripX` | none | none | `glide()` |
| How the last page was left | sessionStorage `mgVia` | none | none | `pagereveal` |
| Context data | sessionStorage `mgCtx-<id>` | fetched once | none | `withCtx()`, `mgStrip()` |

## 5. Keyboard and touch

**Viewing mode:** `←` `→` previous/next (nothing past the ends, chrome stays hidden) · `Space` or the play button: slideshow (starts and stops, with a large play or pause icon that fades out; starts over after the last photo; an open dialog or zoom pauses it, pointer movement does not; `Esc` and opening the panel stop it) · `r` a random photo of the context, in the page, none twice until all were shown · `↑` open browsing mode · `z` zoom 1:1 · `i` info · `f` fill window / fit photo · `s` filmstrip · `/` or `⌘K` filter · `?` shortcuts.

**Browsing mode:** arrows move the selection (up/down to the nearest photo in the row above or below, or one list row), Enter opens · `Home` `End` · `Esc` back to viewing · `1` `2` `3` size · `t` crop or original · `v` grid or list · `/` filter. The current photo is selected when the panel opens.

**Filter:** `Tab` goes to the first chip, then round the matching chips and the field (`mg.js`: Safari leaves links out of the Tab order and Firefox stops on the chips’ scroller); `Esc` clears the search, then closes.

**Touch:** tap toggles the chrome; swipe left/right steps and hides the chrome; double tap zooms; pinch stays with the browser; scroll for the panel.

## 6. Motion and view transitions

| What | Duration | Easing |
| --- | --- | --- |
| Step (keys, click, swipe, strip frame, back and forward): a CSS opacity crossfade between two images in the stage, inside the page | 900 ms | `cubic-bezier(0.45, 0, 0.55, 1)` |
| Strip glide to the new current frame (rAF tween, snap paused) | 550 ms | ease-out cubic |
| Photo backdrop tint following the new photo’s color | 900 ms | same as the step |
| Thumbnail to photo morph (`object-fit: cover` snapshots) | 440 ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Pane, palette, tooltip open/close | 140 ms | same |
| HUD appears / fades after `--mg-hud-idle` | 140 / 600 ms | same |
| Root crossfade | 360 ms | default |

Durations scale with `--mg-motion`. Reduced motion shortens the step’s crossfade to 140 ms, glides at once, and drops scroll-driven effects.

**The step.** The new image comes in with `is-hidden` (opacity 0) in the same grid cell as the old one (`.stage_next` is a one-cell grid, each image carrying its own `--photo-ratio`), so the two share the stage box in fill and in fit mode with no layout jump. Its fade starts as soon as `img.decode()` resolves, or after 150 ms on the photo’s color if decoding is slower, so a step always answers at once; the old image fades out and is removed. It uses only a CSS transition, so it is the same in every engine and needs no view transition.

**View transitions** are for page loads only, and are enhancements:

- **Static names:** `hud`, `strip`, `info`, `keys`, with `view-transition-class: chrome` (no group motion). While the panel is up the strip is not named, so it is not drawn over the photos.
- **Hidden chrome:** an idle HUD gets `view-transition-name: none`, so no empty blurred group is left over the photo.
- **Strip between two viewer pages** (a page load such as the home link): the old strip snapshot is hidden and the new one is live; only an old strip with no new one (`:only-child`) fades out. Only a bare `:only-child` may follow these pseudo-elements: Chrome drops `:not(:only-child)`.
- **Thumbnail clicks** (where `pageswap` and `pagereveal` exist): the thumbnail’s image and the new `.stage_photo` are both named `photo`.
- **Arriving at a grid:** on a page that opens at the grid, the thumbnail of the photo you came from is named `photo`.

**Performance baseline.** `examples/demo/bench/steps.mjs` is the regression check: with the built demo served (`astro preview --outDir <build> --port 4421 --ignore-lock`), run `node bench/steps.mjs --url http://localhost:4421 --latency 40 --dist <build>` from `examples/demo`. In Chromium, WebKit and Firefox, cold and warm, on a 70-photo album, home and a `?in=grid` page, it steps ten times by key and ten by click, then three times back and three forward, behind a proxy that adds 40 ms per response and applies the build’s `_headers`. Targets: on warm steps the crossfade starts under 50 ms after the key or click and the new photo is opaque at about 900 ms plus decode; the URL is the photo’s; the document stays the same; back and forward step in place; one request per step (the newly needed neighbor’s image); no strip frame is ever fetched again; no console errors. Pages: a photo page under 60 KB of HTML for a 70-photo album, home under 150 KB. `bench/behaviours.mjs` checks the signed-off behaviours (including steps, history and a touch swipe) in the same three engines.

## 7. Token contract (`theme.mg.tokens.css`)

| Token | Label | Group | Syntax | Default |
| --- | --- | --- | --- | --- |
| `--mg-ground` | Background | Color | `<color>` | `oklch(0.14 0 0)` |
| `--mg-accent` | Highlight color | Color | `<color>` | `oklch(0.97 0 0)` |
| `--mg-fit` | Photo fit | Viewer | `cover \| contain` | cover |
| `--mg-backdrop` | Backdrop | Viewer | `neutral \| photo \| light` | neutral |
| `--mg-backdrop-tint` | Backdrop tint | Viewer | `<percentage>` | 10% |
| `--mg-view-inset` | Space around the photo | Viewer | `<length>` | 16px (0 on a phone) |
| `--mg-strip` | Filmstrip | Viewer | `on \| off` | off |
| `--mg-slideshow` | Slideshow interval | Viewer | `<time>` | 3s |
| `--mg-hud-idle` | Hide controls after | Overlays | `<time>` | 2s |
| `--mg-hud-density` | Control density | Overlays | `<number>` | 1 |
| `--mg-hud-blur` | Overlay blur | Overlays | `<length>` | 20px |
| `--mg-hud-opacity` | Overlay fill | Overlays | `<percentage>` | 82% |
| `--mg-grid-crop` | Grid thumbnails | Grid | `square \| original` | square |
| `--mg-grid-view` | Photos view | Grid | `grid \| list` | grid |
| `--mg-row-height` | Thumbnail size | Grid | `<length>` | 180px (112 on a phone) |
| `--mg-grid-gap` | Grid gap | Grid | `<length>` | 3px |
| `--mg-motion` | Motion | Motion | `<number>` | 1 |

## 8. Gaps and caveats

- **Render-blocking:** `blocking="render"` is Chrome only. Persisted settings come from the inline `restore.js` before paint everywhere; what can still trail by a frame outside Chrome is the HUD toggles’ own checked look, which follows the inputs `mg.js` sets.
- **Firefox:** the tested build (157) does not parse `@view-transition` and has no `pageswap` or `pagereveal`, so its steps are plain navigations with no view transition; no scroll-driven effects; style queries unverified (backdrop modes fall back).
- **Blur:** turning `backdrop-filter` off made no measurable difference in headless WebKit, which does not composite like Safari on a GPU; the cost in real Safari is unmeasured.
- **Prerender:** headless Chromium does not prerender, so the speculation-rules path is unmeasured; the bench’s Chrome numbers are plain navigations.
- **Carousel and scroll-spy:** `::scroll-button`, `scroll-initial-target` and `:target-current` are Chrome only; `mg.js` centers the strip elsewhere, and rail ticks stay unmarked.
- **Cursors:** the chevrons are drawn on a 128 grid and shown at 96px (128px is the hard browser limit); Chrome shows the `pointer` fallback where the cursor crosses the window edge.
- **Unverified headless:** real view transitions, hover, smooth-scroll and rAF timing, cursor rendering, touch gestures. Check them in Chrome, Safari 26 and Firefox on desktop and a phone.
- **Safe areas:** `viewport-fit=cover` lets the photo run under a phone’s notch, island and home indicator; the HUD, panel header and grid, panes, strip, handle and slideshow bar keep clear of them through `--mg-safe-right`, `--mg-safe-bottom` and `--mg-safe-left` (`env(safe-area-inset-*)`). Emulation reports 0 for all of them, so this is unverified until a phone in landscape and with Safari’s toolbar collapsed has been checked.
- **Not yet carried by the prototype:** 700px demo images (zoom doubles them), no slideshow (the theme has one since Phase 2), maps or day-across-years facet; vendored mCSS needs a `.prettierignore` entry; 262 publish files exceed one publish.
