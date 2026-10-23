# minimal gallery v2: design brief (Phase 0, round 4)

Prototype: `design/prototype/` (serve it over http, see the end). Product facts: `design/PRODUCT.md`, inferred from the plan.

## Direction: the projection evening

A slide show in a dark room. The photo is the only lit thing on the screen; everything else is near-black and neutral so nothing competes with the photo’s color. Controls are pro-app HUDs: they float over the photo, translucent and blurred, appear when the pointer moves and disappear when it rests. The strip is the tray of slides, kept light.

Alternatives on record: the light table (round 1, rejected: too physical, too bright, all-caps labels) and Datamatics (pure black and white with dense data columns; its rule of colorless chrome is kept). The category standard (a dark lightbox) remains the fallback.

## Round 2 feedback and what changed

**Round 2 (direction switch):** no all caps anywhere; a near-black neutral UI; translucent blurred HUD surfaces with hairlines; no chrome on arrow keys (only pointer movement shows it); the info panel as a toggle that stays open across photos; a plain grid with square crops and an Original switch, a thin date scrubber, a tooltip that follows the pointer; flat thumbnails with no mounts or shadows; a subtle current-frame marker, no red.

**Round 2b:** info panel at the top right, 40px from the edges, draggable by its header, position remembered; links never underlined, white on hover; no Color row in the info panel; American English; three thumbnail sizes.

**Round 2c:** no page scrollbar (the date rail owns the right edge); the list has no frame or column rules, and a hovered thumbnail shows a 320px print that is only fetched on hover.

**Round 3 (this round):**

- One template for every context: the viewer on top, the context’s photos below.
- Context carried by `?in=`.
- A breadcrumb HUD with an icon cluster; no counter, no Zoom button, no “Album” word.
- Grid and list in the same page.
- The filmstrip as a setting, off by default.
- A touch model.

The All photos button and the separate list destination are gone.

**Round 4:**

- The crop and grid/list toggles move from the HUD to a header row on the panel, as segmented pairs; Filter appears in both.
- The page snaps firmly between the viewer and the panel.
- Arrow keys move a selection through the photos in the panel.
- The photo crumb is hidden while the panel is up.
- A swipe hides the chrome like an arrow key.
- Size is a segmented small/medium/large triple in the panel header (round 4b; its keys became `1` `2` `3` in round 7).
- `grid.html` redirects to `index.html#grid`.

**Round 4c:**

- In panel state the HUD is not displayed at all: the panel header is the top of the window.
- The header’s title area is a breadcrumb of links, `minimal gallery / Nikon D70` (just `minimal gallery` for all photos), followed by the count, so home stays one click away.
- List columns sort on a header click.

**Round 5:**

- The photo fills the window by default (`object-fit: cover`). A cover/contain pair in the HUD switches it, remembered, with the owner default `--mg-fit`. In cover mode the HUD floats as a detached bar; in contain mode it is the full-width bar.
- The strip, when on, stays visible instead of fading, and has no frame ticks.
- Opening the panel by scrolling focuses the current photo’s thumbnail.
- Escape in the panel returns focus to the stage, and panel keys follow the panel state only. This fixed arrows reopening the panel after Escape.
- The home link always opens the newest photo on the viewer: manual scroll restoration, and no scroll to a thumbnail unless the page opened at the grid.
- Palette: Tab goes from the search field to the first chip, the hint line is gone, and Escape clears a typed search before it closes.
- The info panel ignores Escape, shows the photo’s file path, and has no histogram.
- Only one thumbnail tooltip is ever visible.

**Round 6:**

- **Panel header:** crop and size hide in list view; the grid/list pair sits at the right end next to Filter, so nothing moves between views.
- **Strip:**
  - a frame click is a step: the photo slides toward it and the strip crossfades, with no thumbnail morph;
  - the current frame is centered, with the ends clamped to the window;
  - its opacity and underline change with a short transition.
- **Info panel:**
  - opens 12px below the nav and 12px from the right edge;
  - is no longer a popover: it is a fixed element opened by a checkbox, so tooltips stack above it.
- **Nav:**
  - one Whole photo toggle replaces the cover/contain pair;
  - order left to right: Filter, Info, Filmstrip, Whole photo, help;
  - Info and Filter are icons with tooltips that carry the key;
  - the nav never hides while the pointer is over it.

**Round 7:**

- The keyboard shortcuts are a pane like the info pane, top left, in two sections (viewing mode, browsing mode), with lowercase key caps that do not stretch.
- New keys:
  - `f` is Whole photo, `s` the filmstrip;
  - `1` `2` `3` are thumbnail sizes;
  - `c` toggles the crop, `v` grid or list.
- Every tooltip carries its key.
- The Whole photo button swaps its icon and tooltip with the state.
- Navigation stops at both ends of a context: no next on the last photo, no previous on the first, so the strip never loops.

**Round 8:**

- Shortcuts panel: white section headings with more space below; descriptions centered on the key caps (measured: under 0.1px off in every row).
- `f` reads “Fill window / fit photo”; shortcut letters are bold in labels and tooltips.
- `t` replaces `c` (Crop or original **t**humbnail); `v` is Grid or list **v**iew.
- Only Escape returns to viewing mode; ArrowUp on the first row no longer does.

**Round 9:**

- Strip flicker on arrow steps, two causes:
  - the strip’s old and new snapshots, scrolled one frame apart, were crossfaded, so mid-step the strip looked as if it vanished;
  - on `?in=` pages the strip was rebuilt after the context JSON arrived, after first paint.

  Now a step has no strip crossfade (the old snapshot is hidden, the new strip is live), and each context’s JSON is cached in `sessionStorage` and applied in the render-blocking script.

- The strip glides from its previous position to the new center.
- Lucide-style chevron cursors.
- Photo-to-photo steps are a quick Ken Burns crossfade instead of a slide.

**Round 9c:** opening the panel in list view (by `↑`, by scrolling, or by switching with `v` while it is up) selects the current photo’s row and scrolls it into view, as the grid does with its thumbnail; a grid/list switch keeps the selected photo. The cursors grow to 128px, the browser maximum.

**Round 9b:** the strip glide is a 550ms ease-out tween; the step is a pure 900ms crossfade on a symmetric curve (no scaling, no drift); the cursors are 64px with a thin white outline.

**How script is used:** CSS whenever CSS can do it, script only as a last resort. The old 6 KB cap is withdrawn; `mg.js` is 22.9 KB, 8.3 KB gzipped, reported for information.

## Spatial model: one template

Every page is the same: the **viewer** (stage) on top, and below it the **table**, the context’s photos as a grid or a list. A context is all photos, an album or a facet (year, month, place, camera, lens, focal range, aperture, shutter, ISO, keyword).

| Page | Context | Opens on |
| --- | --- | --- |
| `index.html` (home) | all photos, viewer on the newest | the viewer; scroll down for the grid |
| `grid.html` | redirect to `index.html#grid` (meta refresh and a link) | the grid |
| `list.html` | all photos, list view | the list |
| `a/<album>.html`, `f/<facet>.html` | that context, viewer on its first photo | the grid; scroll up for the viewer |
| `p/<slug>.html` | the photo’s album, or `?in=` | the viewer |
| `filter.html` | Nikon D200, palette open above the grid | the grid |

**Two states, firm snapping.** `scroll-snap-type: y mandatory` on the page with exactly two snap points: the top of the viewer and the top of the panel. A drag that stops halfway settles to one of them; measured: a scroll to 20% or 40% of the window settles at the viewer, 60% or 85% at the panel. **The panel is exactly one window tall.** Inside it, an inner scroller starts at the top of the window; its first child is the panel header, sticky at 0, followed by the photos and the date rail. The HUD lives in the panel’s markup: fixed at the top of the window over the viewer, and not displayed at all once the page is snapped to the panel. So the panel header is the top of the window and nothing scrolls above it.

Panel state comes from the scroll position: `mg.js` sets `data-panel` on load, `scroll`, `scrollend`, `resize` and after keyboard moves, and the idle timer does nothing while it is set. A `scroll-state(snapped: block)` query on the panel is an extra.

Measured (round 4c), header top 0, scroller top 0, HUD `display: none`, no thumbnail above the header, in each of these:

- `f/camera-nikon-d70.html` after a pointer move, the idle time and an inner scroll;
- `index.html#grid` after a reload;
- ArrowUp from the viewer.

Over the viewer the HUD keeps fading when the pointer rests, and only pointer movement brings it back.

Context pages open at the grid through `scroll-initial-target` on the table and `#grid` on every link to a context (the no-script path). Scrolling up from the grid reveals the viewer full size; on home it is the reverse. A thumbnail morphs into the viewer through the cross-document view transition, and going back morphs the photo into its thumbnail.

## Context URLs: `?in=`

Photo URLs stay `p/<slug>.html`. A thumbnail inside a context links to `p/<slug>.html?in=<context id>`, where the id is the context page’s path without `.html`: `grid`, `a/feelings`, `f/camera-nikon-d200`. No `in` means the album; album links carry none.

The photo page’s static HTML holds its album. With `?in=`, mg.js fetches `<id>.json` and then:

- sets prev and next (keeping `?in=`; none past either end) and the Speculation Rules prerender list;
- rebuilds the strip, the grid, the list and the rail;
- sets the middle crumb to the context title.

Arrow keys, click, swipe and the strip all follow. Without script the page stays in its album. One JSON file per context (80 here, 3 to 20 KB): title, page, and per photo the slug, title, aspect ratio, color, year, tooltip line and the list cells as text and link pairs.

## HUD

Fixed at the top over the viewer; not displayed while the panel is up (the panel header carries the breadcrumb and Filter there).

- **Left:** the breadcrumb only: `minimal gallery / Feelings / Montauk` (gallery, context, photo title as the page’s h1). All photos has no middle crumb. The root goes home.
- **Right**, left to right, all icon buttons with a hover tooltip that carries the label and the key:
  - Filter (`/`);
  - Info (`i`), a toggle;
  - Filmstrip (`s`), a toggle; when on, the strip stays visible;
  - Fit photo / Fill window (`f`), a toggle: off is cover (the photo fills the window, the default), on is contain (the whole photo fits), owner default `--mg-fit`. Its icon and tooltip name the next state: “**F**it photo” (contain icon) while the photo fills the window, “**F**ill window” (cover icon) while it fits;
  - Keyboard shortcuts (`?`), a toggle, hidden on touch.
- **Cover and contain:** in cover mode the HUD floats with a 12px margin and rounded corners; in contain mode it is the full-width bar.
- **Icons:** inline SVG, 16px, 1.5px strokes. Toggles are real checkboxes and radios, remembered in `localStorage`, each falling back to the owner’s token.
- **Idle:** the HUD fades when the pointer rests elsewhere; never while it is over the HUD (`:hover` in the idle rule, and the timer checks it).

**Info panel:** the date, place, camera, lens, exposure, keywords, size and the file’s path in the gallery (for example `feelings/Greenport.jpg`); values link to their contexts.

- **Opening:** a normal fixed element, opened while the Info checkbox is checked (CSS `:has()`, no script needed), remembered across photos and visits.
- **Closing:** only its Close label and `i` close it; Escape does not.
- **Position:** 12px below the nav and 12px from the right edge, in both cover and contain modes; draggable with the spot remembered.
- **Stacking:** inside the panel section, the info panel is at z 4, the HUD at 5 and the tooltips at the top. It sits at the top right, 40px from the edges, is draggable with the spot remembered, and is a bottom sheet on a phone.

## Panel header

The top of the window while the panel is up (sticky at 0 in the panel’s inner scroller).

- **Left:** a breadcrumb of links, `minimal gallery / Nikon D70` (home and context; just `minimal gallery` for all photos), then the photo count.
- **Right:**
  - the crop pair and the size triple, shown in grid view only;
  - the grid/list pair and Filter, always at the right end, so nothing moves between views.
- **Pairs:** segmented, with a hairline frame and a filled selected option. They are radios, so they work without script.
- **Phone:** the header wraps.

## Keyboard

The keyboard shortcuts pane is the same panel as the info pane (surface, radius, drag, opening and closing), placed top left: 12px below the nav, 12px from the left edge. Its title is “Keyboard Shortcuts”. It has two sections; letter keys are lowercase, and key caps keep their height when a description wraps.

**Viewing mode**

| Key | Does |
| --- | --- |
| `←` `→` | Previous / next photo (nothing past either end; chrome stays hidden) |
| `↑` | Open browsing mode (the panel, with the current photo selected) |
| `z` | **Z**oom to 1:1 and back |
| `i` | Photo **i**nformation |
| `f` | **F**ill window / **f**it photo |
| `s` | Film**s**trip |
| `/` or `⌘K` | Filter |
| `?` | Keyboard shortcuts |

**Browsing mode** (the panel; opened by scrolling, swiping or `↑`, the current photo selected first)

| Key | Does |
| --- | --- |
| `←` `→` `↑` `↓` | Select photo; enter to open it (`↑` `↓` move one row: the nearest photo above or below, or one list row; nothing above the first row) |
| `Home` `End` | Select first / last photo |
| `Esc` | Back to viewing mode; focus returns to the stage (the only way back by keyboard) |
| `1` `2` `3` | Thumbnail size |
| `t` | Crop or original **t**humbnail |
| `v` | Grid or list **v**iew |
| `/` | Filter |

**Filter palette:** `Tab` goes from the search field straight to the first visible chip; `Esc` clears the search if it has text, and the next `Esc` closes.

Every button’s tooltip carries its key: Filter `/`, **I**nfo `i`, Film**s**trip `s`, **F**it photo or **F**ill window `f`, Keyboard shortcuts `?`, Crop or original **t**humbnail `t`, Grid or list **v**iew `v`, sizes `1` `2` `3`. In the panel rows and the tooltips the shortcut letter is bold where it appears in the label (not forced where it does not, as in Filter). Section headings are white, with more room below; every description’s first line is centered on its key caps.

The selection is keyboard focus: a 2px white outline on the photo, a filled row in the list. Script only moves focus; there is no CSS for that.

## Filmstrip setting

The strip is pinned to the bottom of the viewer and is not part of the scroll gesture. It is set by the HUD toggle or `s`, remembered per visitor, and defaults to the owner’s `--mg-strip: off` (the owner can set `on`). When on, it stays visible; when off it is not shown at all. A frame click is a step (the photos crossfade, the strip glides to the new frame), and the strip never jumps from the last frame to the first: navigation stops at both ends. The current frame is at full opacity with a 1px underline, the others at 55%.

## Touch model (coarse pointer)

- A tap on the photo toggles the chrome (the HUD, and the strip if on).
- A swipe left or right goes to the next or previous photo (nothing past either end) and hides the chrome like an arrow key: pointer events with a 40px threshold, and `touch-action: pan-y pinch-zoom` so vertical scrolling and pinch stay with the browser.
- A double tap toggles zoom.
- The grid is reached by scrolling.

Desktop keeps click to advance and showing the chrome on pointer movement.

## Motion

| What | Duration | Easing |
| --- | --- | --- |
| Next or previous (keys, click, swipe, a strip frame, back and forward): inside the page, not a navigation; a pure CSS crossfade between two images in the stage, the same both ways, no scaling or drift, on a symmetric curve so there is no visible start or end; it starts once the new photo has decoded, or after 150 ms on its color | 900 ms (140 ms with reduced motion) | `cubic-bezier(0.45, 0, 0.55, 1)` |
| The strip on a step: it stays in the page, never rebuilt, and glides to center the new current frame (a `requestAnimationFrame` tween, the strip’s snapping paused meanwhile) | 550 ms | ease-out cubic |
| Thumbnail to photo and back: both snapshots use `object-fit: cover`, so the square crop opens into the whole photo | 440 ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Chrome appears on pointer movement or a tap | 140 ms | same |
| Chrome fades after 2 s at rest | 600 ms | same |
| Chrome hides on an arrow key | instant | none |
| Popovers, palette, tooltips | 140 ms | same |
| Viewer recedes as the photos rise (scroll-driven, 12 to 80% of the window) | scroll-linked | linear |
| Thumbnails arrive from 0.4 opacity (scroll-driven) | scroll-linked | linear |

Never moves: the photo while viewed, and the HUD and panes during navigation (`view-transition-class: chrome`). Hidden chrome drops its `view-transition-name`, so no empty blurred group is left over the photo. Reduced motion: a step stays the crossfade (only opacity changes, shortened to 140 ms), the strip recenters at once, nothing travels or scales; reduced transparency makes every surface solid.

**Cursors:** over the photo, chevrons in the Lucide style (`chevron-right` for next on the right two thirds, `chevron-left` for previous on the left third), 128px with an 11.2px stroke, black at 70% over a white outline 1px wide on each side so they read on light and dark photos, hotspot at the center, `pointer` as the fallback. 128px is the hard browser limit: Chrome and Firefox drop larger cursor images. Chrome also shows the fallback wherever the cursor would cross the window’s edge. On the last photo there is no next and the cursor is the default; on the first there is no previous zone.

## Type, color, space

- **Type:** Geist for everything, sentence case, tabular figures; Geist Mono only for exposure values. HUD text 13px, small text 12px, weights 400 and 540.
- **Color (oklch, chroma 0):**
  - ground 0.14; surfaces 0.11 at 82% with `blur(20px)`;
  - ink 0.97, muted 0.72, faint 0.55; hairline white at 10%;
  - links 0.86, white on hover, never underlined;
  - no accent hue. Photo mode mixes 10% of the photo’s color in oklab.
- **Space:** mCSS’s 4px scale; HUD 48px, grid gap 3px. **Radius:** controls 6px, panels 10px, thumbnails 0.

## Interaction, the feature that carries it, and the fallback

| Interaction | Carried by | Without script | Safari 26 | Firefox 148 |
| --- | --- | --- | --- | --- |
| Next and previous | Inside the page: `mg.js` crossfades a second image in the stage (a CSS opacity transition) and updates the text, links, URL (`pushState`) and strip from the context JSON | A page load per step | Works | Works |
| Morphs between pages | Cross-document view transitions; the leaving page records how it left (`pageswap`), the arriving page names elements (`pagereveal`) | Root crossfade | Works | No view transition |
| Context on photo pages | `?in=` and `<id>.json` | Album context | Works | Works |
| Context pages open at the grid | `scroll-initial-target`, `#grid` links | `#grid` links | `#grid`, mg.js scrolls direct visits | Same |
| State before first paint | `<script defer blocking="render">` plus `pagereveal` | Defaults | Possible one-frame flash | Same |
| Instant next and previous | Neighbor images preloaded (`link rel=preload as=image`, low priority); the step itself is in the page | Normal loads | Works | Works |
| Display toggles | Radios and a checkbox read by `:root:has()` | Work, not remembered | Works | Works |
| Two-state snapping | `scroll-snap-type: y mandatory`, two snap points | Works | Works | Works |
| HUD hidden while the panel is up | `data-panel` from the scroll position; `@container scroll-state(snapped: block)` as an extra | HUD stays fixed over the panel | `data-panel` | `data-panel` |
| List sorting | Header buttons; `mg.js` reorders rows by each cell’s `data-sort` (ISO dates, seconds, f-numbers, millimeters, ISO, lowercase text), cycling ascending, descending, default; `aria-sort` and a drawn chevron on the active header | Default order | Works | Works |
| Keyboard selection in the panel | Focus moved by `mg.js`; Enter is the native link | Tab order only | Works | Works |
| Strip carousel | `::scroll-button`, `::scroll-marker`, `scroll-initial-target` | Snapping row | Snapping row, centered by mg.js | Same |
| Tooltips | One at a time: with a pointer (`data-pointer`) the hovered one follows it with no flip fallbacks; keyboard focus shows the focused one anchored with `anchor-scope`, and pointer movement over the grid hides it | Anchored or in-thumb label | Same | Same |
| Info panel | A fixed element shown by `:root:has(input[name=info]:checked)`, `@starting-style` and `allow-discrete`, below the tooltips in one stacking context; drag in mg.js | Works, not remembered | Works | Works |
| Strip step | A frame click is a step in the page: the photos crossfade and the strip, never rebuilt, glides to the new frame | Plain navigation | Works | Works |
| Palette | `<dialog>` with `command`/`commandfor`, `closedby` | Works | Esc closes | Works |
| Date rail marking | `scroll-target-group`, `:target-current` | Unmarked ticks | Unmarked | Unmarked |
| Touch tap, swipe, double tap | Pointer events in mg.js | Tap follows the link | Works | Works |

## Token contract (`styles/site/theme.mg.tokens.css`)

| Token | Syntax | Default | Label |
| --- | --- | --- | --- |
| `--mg-ground` | `<color>` | `oklch(0.14 0 0)` | Background |
| `--mg-accent` | `<color>` | `oklch(0.97 0 0)` | Highlight color |
| `--mg-fit` | `cover \| contain` | `cover` | Photo fit |
| `--mg-backdrop` | `neutral \| photo \| light` | `neutral` | Backdrop |
| `--mg-backdrop-tint` | `<percentage>` | `10%` | Backdrop tint |
| `--mg-view-inset` | `<length>` | `16px` (0 on a phone) | Space around the photo |
| `--mg-strip` | `on \| off` | `off` | Filmstrip (owner default; visitors can switch) |
| `--mg-hud-idle` | `<time>` | `2s` | Hide controls after |
| `--mg-hud-density` | `<number>` | `1` | Control density |
| `--mg-hud-blur` | `<length>` | `20px` | Overlay blur |
| `--mg-hud-opacity` | `<percentage>` | `82%` | Overlay fill |
| `--mg-grid-crop` | `square \| original` | `square` | Grid thumbnails |
| `--mg-grid-view` | `grid \| list` | `grid` | Photos view |
| `--mg-row-height` | `<length>` | `180px` (112 on a phone) | Thumbnail size (the medium step) |
| `--mg-grid-gap` | `<length>` | `3px` | Grid gap |
| `--mg-motion` | `<number>` | `1` | Motion |

## Open questions for round 4

1. (Settled in round 8: only Escape returns to viewing mode.)
2. On touch, should a swipe up on the photo also count as “open the panel” (it does now, through scrolling), or should the panel only open from the handle?
3. The panel header repeats the context title that the breadcrumb already shows. Keep both?
4. With the panel up, should Filter in the HUD hide, since the panel header has its own?

## Run it

`cd design/prototype && npm install && node photos.mjs && node build.mjs`, then `python3 -m http.server 4400` there and open `http://localhost:4400/`. View transitions and `?in=` need http.
