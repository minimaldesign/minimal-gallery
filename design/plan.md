<!-- Canonical copy since 2026-10-23. The same text started as a Claude plan file; this one in the repo is the one to update. -->

# minimalgallery v2: approach and plan

## Context

minimalgallery 0.8 (2005, PHP) let anyone drop JPGs into folders on shared hosting and get a gallery organized from file metadata. Shared PHP hosting is no longer where enthusiasts live, images are 24 to 60 MP now, and the old app’s weak spots (ordering by mtime instead of EXIF date, on-request GD thumbnails with no invalidation, sidecar captions executed as PHP) would not survive a rewrite anyway. v2 is a modern successor for photo enthusiasts with a modicum of tech ability: free hosting, drag-and-drop ingest, EXIF-driven organization with overrides, no platform lock-in, a viewer that feels native on desktop, and a theme that is tweakable with CSS.

Decisions made so far: default host is Cloudflare Pages + R2; theme CSS is built on mCSS; Astro 7.4 (current, 7.4.2 released October 21, 2026); the old themes are discarded and v2 ships one new theme; the design is reviewed as a clickable prototype before the build; ingest ships as the browser admin + CLI, and the desktop app is parked as a GitHub issue for later (both are still laid out below); the theme is built so a customization UI can be added later without rework; minimalgallery.net is the demo gallery and docs.minimalgallery.net carries docs, version history and downloads.

## The answer: not an app, not a theme, an Astro toolkit with a local pipeline

A hosted app (Immich, PhotoPrism style) needs a VPS and upkeep and fails the free-hosting goal. A bare Astro theme fails the other way: every existing Astro photo theme is a lightbox over a folder, and the value here is in ingest, derivatives, EXIF organization, overrides and the viewer, which a theme cannot own.

The right form is an Astro integration plus a local processing pipeline, delivered as npm packages: a static site generator for photographers. Heavy work (EXIF, AVIF encoding) runs once on the owner’s machine; the host only builds HTML. The viewer is a static multi-page site whose native feel comes from cross-document view transitions, prerendered neighbours and modern CSS, not from a JS app. It is realistic today because every hard piece exists natively: Astro 7’s Rust compiler, incremental static builds and content loaders; Sharp for AVIF; cross-document view transitions and anchor positioning across all three engines; Cloudflare static hosting with unlimited free requests and R2 with zero egress.

## Phase 0: design first, with a clickable prototype

Yes, the design is seen and approved before the build. Static comps cannot show the thing that makes this gallery different (motion, transitions, scroll behaviour), so the design deliverable is a working HTML prototype, not a Figma file.

Deliverables, in order:

1. **Design brief** (one page, in the repo under `design/`): direction and references, the spatial model below, motion language, typography and colour tokens in oklch, and a table mapping each interaction to the CSS feature that carries it and its fallback. Produced with the `impeccable` skill’s direction and critique process.
2. **Clickable prototype** (`design/prototype/`, plain HTML + CSS, no build): about 30 real photos from the demo set, three screens (view, grid, filter) wired as real pages so cross-document view transitions, the filmstrip, the info popover and the filter palette behave for real. Published as a private artifact link for review in Chrome, Safari and Firefox, on desktop and a phone.
3. **Two review rounds** on the prototype. Sign-off gates Phase 1. The prototype’s tokens become the mCSS theme tokens; its markup becomes the component contract.

Figma frames can be added for static reference if wanted, but the prototype stays the source of truth.

### The UX hypothesis the prototype will test

Principle: the photo is the page; browsing is a layer over it; metadata is navigation.

- **View** (landing state, and every photo URL): one photo, full-bleed, `object-fit: contain`, on a backdrop derived from the photo’s dominant colour (extracted at ingest, stored in the manifest as oklch, dimmed via `color-mix()`). Chrome is a thin HUD that fades out when the pointer is idle: title and album top-left, “N of M” and actions top-right, filmstrip along the bottom. Arrow keys, click-to-advance with wrap (kept from v0.8), swipe on touch. Next and previous pages are prerendered via Speculation Rules, so advancing is instant; the transition is directional (view transition types `forward`/`back` drive a slide, `view-transition-class` keeps the HUD static).
- **Strip**: the filmstrip is a CSS carousel (`scroll-snap`, `::scroll-marker` and `::scroll-button` where supported, plain snapping scroll elsewhere). Dragging or scrolling the strip upward expands it into the grid: one gesture from viewing to browsing, carried by a scroll-driven animation.
- **Grid** (album, facet and home-as-archive pages): justified rows that preserve every aspect ratio, so photos are never cropped (row geometry computed at build time from known dimensions; pure flex + `aspect-ratio`). A zoom level (`-`/`+`, like Lightroom) changes row height; `display: grid-lanes` masonry is an optional mode behind `@supports`. Thumbs fade and settle in on scroll (`view-timeline`). A date rail on the right shows the current month and year via a `scroll-state(stuck)` container query, and dragging it scrubs the timeline. Hovering a thumb shows an anchor-positioned tooltip (title, date, camera). Clicking a thumb morphs it into View.
- **Filter** (the powerful browse): a palette (`/` or Cmd-K) with chips for album, year, month, day-across-years, camera, lens, focal range, aperture, keyword, place. Every chip is a static facet page with a shareable URL; the palette only navigates, so arriving by URL needs no JS. The v0.8 list view’s “click any cell to filter” generalizes: every value in the info panel is a link to its facet page (click “f/1.4”, see every f/1.4 photo).
- **Info**: a `popover` panel anchored to the info button (anchor positioning): EXIF, a histogram (tiny SVG computed at ingest), location with a static map image, all values clickable. Animated open/close with `@starting-style` and `transition-behavior: allow-discrete`.
- **Zoom**: `z` or click toggles 1:1 using the largest derivative or the original inside a scroll container, pan by drag; `cursor: zoom-in`.
- **Slideshow** (space), **random**, **list** (a sortable table, kept for the spreadsheet-minded), **feed**, **last updated**.
- **Phone**: the same pages; the HUD becomes a bottom sheet, the strip stays, swipe replaces keys. Desktop is the design target; phone must be decent, not identical.

Revisions from the design review rounds (2026-10-22), which supersede the bullets above where they differ: the direction is a near-black “projection evening”, not a light table; no uppercase anywhere; all overlays are translucent blurred HUD surfaces; arrow keys never reveal chrome, only pointer movement does; the info panel is a draggable toggle at the top right that stays open across photos; the grid is square 1:1 crops by default with an original-ratio toggle, no headings or groups, flat thumbnails, a dark pointer-following tooltip (name, date, place); the filmstrip is stuck to the bottom, off by default, an owner token and a viewer toggle turn it on, and when on it shows and fades with the HUD; the HUD left side is a breadcrumb (gallery / context / photo), the right side is a help icon, icon toggles (crop, grid or list, strip), Info and Filter, with no counter and no zoom button (`z` and double-tap keep the function); touch: tap toggles chrome, swipe advances, double-tap zooms; links have no underline and change color on hover; the dominant color is not shown to viewers; grid pages hide the page scrollbar with plain CSS; the list is flat with a hover preview of the photo.

### Modern CSS inventory (status as of October 2026)

| Feature | Carries | Status | Fallback |
| --- | --- | --- | --- |
| Cross-document view transitions, `view-transition-class`, types | thumb to photo morph, directional slides | Chrome, Safari 18.2+/26; Firefox 144+ partial; Interop 2026 focus area | Instant navigation |
| Scroll-driven animations | grid reveal, strip-to-grid gesture | Chrome, Safari; Firefox landing (Interop 2026 focus area) | Static layout |
| Scroll-state container queries (`stuck`, `snapped`) | date rail, current strip item | Chrome 133+ | Plain sticky header |
| Anchor positioning | tooltips, info popover | Baseline Newly available since Firefox 147 (Jan 2026); Safari 26 | Fixed placement |
| CSS carousel (`::scroll-marker`, `::scroll-button`) | filmstrip markers and buttons | Chrome 135+; Safari unconfirmed; Firefox no | Snapping scroll, no markers |
| Grid Lanes (masonry) | optional grid mode | Safari 26.4 only; others flagged | Justified rows (the default) |
| `popover`, `dialog`, `@starting-style`, `allow-discrete` | info panel, palette | All engines; dialog/popover additions are an Interop 2026 focus area | n/a |
| Container size and style queries, `:has()`, `@layer`, `@scope` | component-level responsiveness, theming | All engines | n/a |
| oklch, `color-mix()`, `light-dark()`, `contrast-color()` | photo-derived backdrops, legible HUD text | All engines; `contrast-color()` is an Interop 2026 focus area | Precomputed contrast |
| `scroll-snap`, `shape()`, `corner-shape` | strip, masks, squircles | Snap everywhere; others Chrome-first | Rounded corners |
| `if()`, `@function` | nothing load-bearing | Chrome only | Avoid |

## Architecture

### Packages (pnpm monorepo in this repo)

| Package | Role |
| --- | --- |
| `@minimalgallery/pipeline` | Pure Node, no Astro dependency. Walk `photos/`, extract metadata (exifr, ExifTool fallback), Sharp ladder, dominant colour, histogram, thumbhash, per-photo manifest, storage adapters. Shared by CLI, admin and any desktop shell. |
| `@minimalgallery/astro` | Integration + Content Layer loader exposing `albums` and `photos` collections and derived facets; the default theme (layouts, components, mCSS theme and component files); dev-only admin routes. |
| `minimalgallery` (CLI) | `add`, `sync`, `doctor`, `publish`, `admin`, `watch`. |
| `create-minimalgallery` | Scaffold with host choice. |

One theme ships in v2, inside the astro package. The theme contract (layout slots, component props, token names) is what a second theme would implement later.

### Folder conventions in a user’s gallery

```
photos/
  japan-2025/                album = folder; nesting allowed
    _album.md                frontmatter: title, description, sort, order[], hidden, date
    DSC_0412.jpg             original, kept out of git
    DSC_0412.jpg.xmp         per-photo override written by the admin (XMP)
    DSC_0412.xmp             Lightroom sidecar, read only
.minimalgallery/manifest/<photoId>.json   committed; the contract between local processing and CI
public/_mg/<photoId>/<hash8>-<variant>.avif   repo storage mode only
minimalgallery.config.ts
custom.css                   the user’s last cascade layer
```

### Data model

- Album: `id` (slugged folder path), `title`, `description` (markdown), `sort` (`date | name | manual`), `order`, `children`, `dateRange`, `count`, `hidden`, `updatedAt`.
- Photo: `id` = `<album-slug>__<file-slug>` (the v0.8 convention from `mg_brain.php:151`; loader errors on collision), `album`, `title`, `caption`, `date` + `dateSource`, `camera`, `lens`, `exposure` (shutter, aperture, focal, ISO, EV, metering, flash), `gps`, `location`, `keywords`, `copyright`, `width/height`, `color` (dominant, oklch), `histogram`, `thumbhash`, `placeholder`, `variants[]`, `original?`, `hidden`, `digest` (feeds Astro’s incremental build `cacheKey`).
- Facets derived at load, each a static page: year, month across years, day across years (the v0.8 `m`/`d` semantics from `mg_brain.php:198-209`), camera, lens, focal bucket, aperture, keyword, country/city.
- Override precedence: `.md`/`.json` sidecar > `_album.md` per-photo map > `.xmp` sidecar > embedded XMP > IPTC > EXIF > filename/mtime. Date falls back to mtime with `dateSource: "mtime"` so the admin can flag it.

### URL scheme

`/` (the all-photos context, opened on the viewer with the newest photo) · `/<album path>/` · `/year/2005/` · `/month/02/` · `/on/02-27/` · `/camera/nikon-d70/` · `/lens/<l>/` · `/aperture/1.4/` · `/place/<p>/` · `/keyword/<k>/` (every context page, opened on its grid) · `/<album path>/<file-slug>/` (the one page per photo) · `/map/` · `/random/` · `/feed.xml`. Legacy `?id=colors__red_door` links are honoured by a small script on `/` reading a generated map.

Context model (decided in the round 3 design review, 2026-10-22): a context is the whole archive, an album, or a facet. Every context page uses one template, the viewer on top and that context’s grid (or list) below; home opens on the viewer, albums and facets open scrolled to their grid, and scrolling up reveals the current photo full size. A thumbnail clicked inside a context links to the photo page with `?in=<context id>`; the photo page ships its album grid and strip statically, and a small script reads `in`, fetches that context’s JSON (`<context>.json`, emitted beside every context page: ordered ids, slugs, titles, thumb URLs, ratios, dates, places, context title) and keeps prev/next, the strip, the grid below, the breadcrumb and the prerender list inside the context. With JS off everything falls back to the album. This keeps one page per photo; the alternative of real pages per context and photo would multiply pages by about ten and hit Cloudflare’s 20k file cap near 2,000 photos. There is no separate list route: grid and list are two renderings of the same context, toggled in the HUD.

### Derivative ladder and budgets

| Variant | Long edge | Format | Typical bytes (24 MP source) |
| --- | --- | --- | --- |
| `grid` | 640 | AVIF | 40 KB |
| `w1280` | 1280 | AVIF | 120 KB |
| `w2048` | 2048 | AVIF | 300 KB |
| `w3200` (pro / zoom) | 3200 | AVIF 4:4:4 | 700 KB |
| `jpeg1600` (fallback, og:image) | 1600 | JPEG q80 | 350 KB |

About 5 files and 1.5 MB per photo. Thumbs are the full photo at `grid` size, never cropped (the v0.8 “artsy” detail crop is dropped; it contradicts showing full photos). Colour: convert to sRGB with ICC embedded (the demo set is Adobe RGB, so this is mandatory), P3 opt-in. Keys are content-addressed (`<hash8>-<variant>`): immutable, cached forever.

| Storage mode | Ceiling | Limited by |
| --- | --- | --- |
| Repo, Cloudflare Pages free | ~3,000 photos by the 20k file cap; ~700 practical | Git repo size (1 GB at 1.5 MB/photo) |
| R2 bucket, 10 GB free | ~6,500 photos, derivatives only | Bytes |
| R2 + Pages | ~15,000 photos | 20k files, now HTML only |

`doctor` projects both numbers and recommends bucket mode above about 500 photos.

### Storage adapter

`Storage { put, has, url, list, remove }` with `repo` (writes `public/_mg`, URLs under `/_mg/`) and `s3` (R2/B2/S3 via `aws4fetch`, custom-domain URL). The CI build only reads manifests and calls `url()`; it never runs Sharp or touches the bucket.

### Where processing runs, and incremental updates

Locally, before the build. Free CI tiers give 10 to 20 minutes and little memory; AVIF-encoding thousands of 24 MP files there is impossible and would force originals into the repo. On-the-fly CDN transforms (Cloudflare Images 5k/month, Vercel 5k, Netlify credits) are metered and lock-in; a `cloudflare-images` adapter can come later as paid opt-in.

Each manifest stores `sourceHash` (xxhash64), `pipelineVersion`, a ladder-config hash and a `(size, mtime)` shortcut. Unchanged files skip; sidecar edits never re-encode. Encoding runs in a `piscina` worker pool at AVIF `effort: 3` (measured in the spike).

### What Astro 7.4 brings to this

- Rust compiler, Vite 8 + Rolldown (7.0): faster builds for sites with thousands of pages.
- Experimental incremental static builds (7.2): pages whose `cacheKey` (the manifest digest) and code are unchanged are not re-rendered. On Cloudflare Pages, restore `node_modules/.astro` between builds. Caveat: disabled when `build.concurrency > 1`; pick incremental or parallel after measuring.
- Experimental parallel prerendering across worker threads (7.4): the alternative for very large galleries.
- `astro build --timings` (7.4): the spike’s measurement tool.
- `deferRender` for content collections (7.1) and experimental chunked content storage: for large collections; verify exact semantics in the spike.
- Live content collections (6.0) and background/multiple dev servers (7.0/7.1): the admin refreshes the grid as the pipeline runs, and can run beside the site’s dev server.
- Fonts API and CSP (6.x) for the theme.

## Viewer implementation notes

- MPA; native cross-document view transitions by default (`@view-transition { navigation: auto }`, `view-transition-name` assigned on `pageswap`/`pagereveal` so only the clicked thumb morphs). `<ClientRouter />` is an opt-in; Astro’s docs now say it becomes increasingly unnecessary as browsers catch up.
- Preloading: Speculation Rules `prerender` of next and prev (cap 2), `<link rel=preload as=image imagesrcset>` for the next hero, Astro prefetch on hover.
- `<img srcset sizes>` from the ladder, build-time 16 px placeholder, `fetchpriority=high` on the hero.
- JS rule (set by Yann in the round 4 review): no size cap. CSS whenever CSS can do it, JS only as a last resort; 0 KB is needed to view a photo, and the enhancement script (keys, swipe, palette, zoom pan, timeline scrub, context navigation from `?in=`, persisted toggles, info drag, grid focus navigation) reports its size for information; map loaded only on `/map/`.
- Context JSON: the build emits one small JSON per context (archive, each album, each facet) with the ordered photo list the script needs; the photo page never inlines other contexts.
- Theming: mCSS layers; theme = layouts + components + `theme.*.css` + `component.*.css`; the user’s `custom.css` is the last layer. Load the `mcss` skill before writing any theme CSS.
- Theme token contract (so a customization UI can come later without rework): every user-facing token lives in the theme’s tokens file as a CSS custom property registered with `@property` (typed `syntax`, `initial-value`) and a one-line comment with its label and group. The future admin settings page reads that file, generates controls from the types, and writes overrides to `custom.css` under the user layer; nothing else in the theme changes. v2 exposes a handful (accent, backdrop mode, grid row height, HUD density) and the contract is documented, but no UI is built now.

## First-run journey (onboarding)

Persona: a photo enthusiast on a Mac with Lightroom, who has opened a terminal a few times. The whole journey is designed so the terminal appears exactly twice, and never again after a shortcut is created.

1. **Discover.** minimalgallery.net is itself a gallery built with the tool (the demo set). Its only chrome beyond the gallery is a “Make yours” link to docs.minimalgallery.net, whose getting-started page lists what you need: Node 22+ (installer link), a free Cloudflare account, and optionally GitHub.
2. **Create** (terminal, once). `npm create minimalgallery@latest` asks, with `@clack/prompts`: gallery name, your name, where it will live (Cloudflare, preselected and recommended; GitHub Pages; Netlify; or “build locally”). There is no photo-count question: every gallery starts in repo mode (see the publishing decision of 2026-10-23). It scaffolds, installs, writes the host config and `.env.example`, and on macOS drops a double-clickable `Open minimalgallery.command` in the folder so the next step never needs a terminal again. It prints the next command.
3. **Open the admin** (terminal, once, or the `.command` file). `npm run admin` starts the dev server and opens `localhost:4800/admin`. The first-run screen is a four-step checklist with live ticks: add photos, name the gallery, preview, publish. The grid is an empty state with one large drop target and a line about the Lightroom export preset.
4. **Add photos.** Drop a folder from Finder: an album appears, thumbnails fill in as each ladder finishes, and a “needs attention” badge marks photos whose date came from mtime, that have no EXIF, or that duplicate an existing file. Clicking the badge opens the inspector on the right field.
5. **Look.** The Preview button opens the real site in a new tab; it live-reloads as photos land. A `?` overlay shows the keyboard map the first time.
6. **Make it yours.** Settings: name, tagline, sort and landing behaviour, and the theme tokens the design phase exposes (accent, backdrop mode: photo colour, neutral dark, light). A custom CSS panel writes `custom.css` and the preview updates live.
7. **Publish.** The first click shows “Connect Cloudflare”: a `wrangler login` browser OAuth, then the admin creates the Pages project (and the R2 bucket in bucket mode) and deploys. The log streams in the page and ends with the live URL, a copy button, and a link to Cloudflare’s custom-domain steps. Every later publish is one click. The GitHub path is the alternative: the admin inits the repo, creates it with `gh`, pushes, and shows the Cloudflare Pages “connect repo” link with the build command prefilled.
8. **Next time.** Double-click the `.command` file (or run `npm run admin`), drop, publish. For a folder-based habit, `minimalgallery watch` plus a Lightroom export preset pointed at `photos/<album>/` with metadata included: titles, captions and keywords flow through XMP and no sidecars are ever written by hand.
9. **Upgrading.** `npx minimalgallery upgrade` updates the packages, migrates the config if a version changed, and runs `doctor`, which reports file count, bytes, and anything it would change.

Power-user variant, no admin: `minimalgallery add ~/Export/japan --album japan-2025`, edit the album’s `_album.md` in any editor, `minimalgallery publish`.

Option B variant: download and open the app; “Create a gallery” replaces steps 2 and 3 with a folder picker; everything from step 4 on is the same screens in a native window, with publish credentials in the keychain.

## Ingest: option A now, option B parked

Both share `@minimalgallery/pipeline` and the same local HTTP API, so the admin UI is a web app either way. Option B is a shell around option A: building A first does not foreclose B. Both are kept here so the issue filed for B has its full write-up.

### Option A: browser admin + CLI

What the user installs: Node 22+ (and git, unless using direct deploy).

First run:

1. `npm create minimalgallery@latest my-gallery` asks name, host (Cloudflare), and scaffolds.
2. `npm run admin` starts the dev server and opens `http://localhost:4800/admin` in the default browser.

Adding photos: 3. Sidebar: album tree. Main pane: the current album’s grid with a drop zone. Dropping a Finder folder on the sidebar creates an album; dropping files on the grid adds to it (dropped folders are read recursively in every modern browser via `webkitGetAsEntry`). 4. Each file uploads to localhost in chunks, is hashed and deduped, written to `photos/<album>/`, then processed by Node; progress streams back over SSE and the thumb appears as soon as its ladder is done. The live collection refreshes the preview.

Editing: 5. Click a photo for an inspector: title, caption (markdown), date, location, keywords, hidden. Extracted values show greyed with an override affordance; saving writes `<file>.xmp` containing only the overridden fields, or into the photo itself with `saveEdits: 'photo'` (revised 2026-10-25, see below). Album inspector and drag-to-reorder write `_album.md`.

Publishing: 6. A Publish button runs `minimalgallery publish`: `sync` pending derivatives to R2 in bucket mode, then `git commit && git push` (host builds) or `astro build && wrangler pages deploy dist`. First time, a guided `wrangler login`. Deploy log and final URL shown in the page.

Also: `minimalgallery watch` picks up files dropped into `photos/` in Finder while running.

Feel: a CMS admin in a browser tab at a localhost URL. No dock icon, no OS notifications; the user runs one command to start it. Cross-platform for free, no packaging or signing, one codebase, ships in Phase 3.

Effort: about 2 to 3 weeks on top of the core.

### Option B: desktop app (Tauri 2)

What the user installs: a `.dmg` / `.exe`. Code signing and notarization are needed to avoid Gatekeeper and SmartScreen warnings (Apple Developer, $99/year, plus a Windows cert).

First run:

1. Open the app. “Create a gallery” picks a folder and scaffolds the same project layout as option A; “Open a gallery” opens an existing one. The gallery stays a plain folder.

Adding photos: 2. Same admin UI in a native window: drag from Finder onto the window or the dock icon, native file dialogs, menu bar, app-wide shortcuts. A watch-folder mode runs in the background. 3. Processing runs in a sidecar: a bundled Node + Sharp running the same pipeline (simplest, adds roughly 80 to 120 MB to the app), or a Rust rewrite of the pipeline, which means two implementations to keep in sync. The sidecar route is the realistic one.

Editing and publishing: 4. Same inspectors. Publish shows a native progress notification; tokens live in the OS keychain. Auto-update via Tauri’s updater.

Feel: the “pro desktop app” the brief describes; no terminal, ever. Costs: Tauri + Rust in the stack, release engineering for two platforms, signing fees, sidecar bundling, a second thing to test on every change. Roughly 3 to 5 times the effort of option A, and it still needs option A’s UI and API underneath.

A middle path: a tiny Tauri menubar launcher that only starts and stops the admin server and opens the browser, giving a dock icon and “open at login” for about two days of work.

Decision: A ships in Phase 3. B is not implemented now; during Phase 1 setup the option B write-up above is filed as a GitHub issue (“Desktop app shell (Tauri)”, label `later`) so it is not lost, and nothing in A’s API is allowed to assume a browser host (the admin talks to a local HTTP API, never to Node directly).

## Decisions added 2026-10-23 (after Phase 1)

- minimalgallery.net is Yann’s own photo gallery, not a product pitch. The product site is docs.minimalgallery.net: its home page is the marketing one-pager (dark, minimal, the gallery’s own design language) and the docs sit behind it. There is no demo subdomain.
- Every gallery carries a quiet “Powered by minimal gallery” credit linking to the docs home: one line at the end of the browsing panel after the last grid row or list row, and a smaller “minimal gallery <version>” line in the Keyboard Shortcuts pane footer. Config option `credit`, on by default.
- Bucket mode (R2) is available on Cloudflare: derivatives (and optionally originals) live in R2 behind a `media.` subdomain, and Publish uploads new derivatives before it deploys or pushes. It is an opt-in, not the default (revised the same day, see the last bullet); repo mode is the default for every host. The demo moves to bucket mode to dogfood it.
- Docs: scaffold and navigation in Phase 2 (so the credit link has a target); final content and a design round at the end of Phase 4, after the admin and bucket mode are stress-tested. Starlight restyled with the gallery tokens.
- No ratings, album covers or about text (decided by Yann during Phase 3): minimal gallery is a gallery, not a photo organizer, and the theme has no place for them. Ratings are not read from Lightroom or sidecars, an album is represented by its first photo (drag to reorder to choose it), and the admin offers none of the three.
- Work runs two phases at a time at most (#2 and #3 first, on their own branches, each merged by PR), the docs scaffold and one-pager when one merges, the release last, #5 when the photos arrive.
- The simplest path is the default (decided by Yann on 2026-10-23, after the first docs round; it replaces the git-first publishing model and the Cloudflare bucket default above). A Cloudflare gallery publishes from the owner’s computer: Publish processes new photos, builds the site locally and uploads it with `wrangler deploy`, and the resized photos are uploaded with the site (repo mode; no git and no GitHub account needed). The target onboarding: install Node, `npm create minimalgallery@latest`, open the admin and organize the photos, “Connect Cloudflare” (sign in or create the account in the browser, then choose the `workers.dev` name), Publish. Git publishing (Workers Builds from a repository) and R2 bucket mode are opt-ins: git for a history of published versions, a backup on GitHub and publishing from more than one computer; R2 for galleries near the 20,000-file limit, roughly 3,000 full-size photos (enabling R2 asks for a payment method even on the free tier). Without git, Cloudflare’s version history is the record of what was published (`wrangler rollback` restores the previous version), and the gallery folder needs a backup of its own. GitHub Pages and Netlify still publish from git. The demo keeps Workers Builds from `master` (reversed on 2026-10-24, see below).

## Decisions added 2026-10-24

- Bucket mode keeps the S3 keys (decided by Yann on 2026-10-24). Uploading with the owner’s wrangler login instead, so the scaffold and the admin could skip the R2 API token step, was looked into and parked. S3 keys stay the only way to reach the bucket, for R2 as for Backblaze B2 and MinIO.
- Why the wrangler login does not work for uploads: `wrangler r2 object put` and every other call made with the login go through the Cloudflare API, which allows 1,200 requests per 5 minutes per user. The dashboard and `wrangler deploy` count toward the same total, and over it every API call gets a 429 for the next 5 minutes. Each file is one request, and wrangler’s own `r2 bulk put` holds itself to 1,100 requests per 5 minutes, about 3.7 files per second. Bucket mode is for galleries that are already large (near the 20,000-file limit of a Worker’s assets), so almost every first upload is large: 3,000 photos at the demo’s 2 files per photo are 6,000 files, at least 27 minutes; 10,000 photos take at least 91 minutes. The S3 API has no such limit (482 files in 1.3 s against MinIO), and R2’s limits page recommends it for “high-throughput object operations”. A publish of a few dozen new photos would fit, but a login that works only for small uploads does not remove the token step.
- What was checked, for when this comes back: the Cloudflare API has list (1,000 keys per page, with a cursor), get, upload and delete for R2 objects, and no HEAD. `wrangler auth token --json` refreshes an expired token before printing it; the token lasts 1 hour, so a longer run has to fetch it again. The login cannot create S3 keys for the owner, because it has no permission to manage API tokens.
- To try once R2 is enabled for the demo: wrangler’s remote R2 binding. `startRemoteProxySession` and `getPlatformProxy`, public exports of wrangler 4.152, give Node a binding on the real bucket that uses the wrangler login. Objects then go through a temporary preview Worker instead of the Cloudflare API, so the 1,200-request limit should apply only to starting the session, not to each file. The binding has `put` with HTTP metadata (Content-Type, Cache-Control), `head`, `list` (1,000 keys per page) and `delete` of up to 1,000 keys per call, which covers staging, upload, prune and `checkBucket`. Unknown until it runs against real R2: how fast thousands of files upload, whether those requests count toward the Workers daily request quota (100,000 on the free plan), whether the 100 MB request body limit of Workers applies (it would matter for originals only), and how long a session takes to start. It also starts workerd on the owner’s computer, which makes wrangler a runtime dependency of publish. If it holds up, it replaces the R2 API token step in the scaffold and the admin, with S3 keys still winning when they are set (CI, B2, MinIO).
- Git publishing leaves the original photos out of the repository, in every git setup (GitHub Pages, Netlify, Cloudflare with `--publish git`; repo and bucket mode), decided by Yann. The host build never reads them, a repository of originals passes GitHub’s 1 GB recommendation and 100 MiB file limit, and on GitHub Pages’ free plan it is public, full-resolution files included. The scaffold’s `.gitignore` ignores every file under `photos/` except the sidecars (`.md`, `.json`, `.xmp`, so `_album.md` too), and `publish --git` commits the same files whatever `.gitignore` says. `"minimalgallery": { "commitOriginals": true }` in `package.json` is the opt-in for an owner who wants the repository as a backup; `doctor` then counts the originals in the repository size. A gallery that already tracks originals keeps them tracked: publish commits their edits and deletions, adds no new ones, and prints the commands to stop tracking them. History is never rewritten.
- A clone without the originals must publish the same site, so the pipeline separates a deleted photo from an absent one. A manifest whose photo is missing counts as deleted, and can be pruned, only when this gallery folder had the photo before, as recorded in `.minimalgallery/cache/seen.json` (ignored by git, and tied to the folder’s path so a copied cache is not trusted). Otherwise the photo is absent: it stays in its album (an album whose folder is missing is rebuilt from the manifests), and its manifest and derivatives are never rewritten or pruned. A clone therefore writes the same `_albums.json` as the computer with every original. `doctor` counts absent photos instead of calling them orphans. Edits and deletions happen on the computer that has the original.

## Decisions added 2026-10-25

- Photo sidecars are XMP, not markdown (decided by Yann). The admin writes `<file>.xmp` (`DSC_0412.jpg.xmp`) with ExifTool (`exiftool-vendored`), holding only the edited fields; `<name>.md` and `<name>.json` photo sidecars are no longer read. `<name>.xmp` from another app is still read, below the album map. `hidden` and the album order have no standard tag and live in `_album.md`.
- Edits can be saved inside the photo (decided by Yann; the earlier “originals are never modified” rule was a planning default, not a requirement). `saveEdits: 'sidecar' | 'photo'` in the config, a choice in the admin’s settings. In photo mode a save writes XMP plus the EXIF and IPTC copies (MWG), then removes the field from `<file>.xmp` and the album entry, so a saved value is never hidden by an older copy; the precedence order stays fixed. Switching offers to move the existing sidecars into the photos.
- Derivatives are reused by an image data hash (`pixelsHash`: a JPEG or PNG without its metadata segments, plus the EXIF orientation), so metadata written into a file does not re-encode it. Other formats hash whole.

## Hosting

Publishing model (decided 2026-10-23, revised the same day): on Cloudflare, Publish builds the site on the owner’s computer and uploads it with `wrangler deploy` (`publish --deploy`); only new or changed files are sent, and Cloudflare keeps every deployed version. Git is the opt-in: the admin’s Publish button commits and pushes, and Cloudflare builds from the repository (Workers Builds connected to the repo, production branch only), so nothing goes live without a commit. GitHub Pages and Netlify publish from git. The demo uses the git path: Workers Builds builds `master`. Revised 2026-10-24: the demo publishes like a user’s gallery, with `pnpm demo:publish` (`minimalgallery publish --deploy`) from Yann’s Mac, so the default user path is the one the demo exercises; Workers Builds is disconnected from the demo Worker, and `master` is no longer production for it.

Stepping rule (added 2026-10-23 after Yann’s Safari and Firefox tests): next and previous happen inside the current document when JavaScript runs: the hero is swapped with a plain CSS opacity transition, the strip highlight glides, the URL, title, info rows and neighbours update from the context data, and history is pushed. Page loads remain for grid-to-photo (where the thumbnail morph uses cross-document view transitions), facets and home, and every photo URL still works without JavaScript. Cross-document view transitions are never relied on for the step itself, because only Chrome performs them well.

Viewer performance rule (added 2026-10-23 after the first Safari and Firefox pass): the plain navigation path must be fast and smooth in every engine, measured in WebKit and Firefox with the Playwright bench in `examples/demo/bench`; Chrome-only features (prerender, `pageswap`/`pagereveal` types, render-blocking scripts) only improve on that baseline. Pages carry the grid statically and build the list and strip on demand; fonts are self-hosted.

Default: Cloudflare Workers static assets, one account, one CLI; R2 as the opt-in for large galleries. (Found on 2026-10-23 at the first deploy: wrangler 4.152 folds Pages into Workers, so the config is a Worker with `assets: { directory: "./dist" }` and the command is `wrangler deploy`; `wrangler pages deploy` fails on a Pages-style config. The demo is live at https://minimalgallery.net and www, attached as Worker custom domains on 2026-10-23.) Secondary configs for GitHub Pages (1 GB site, 100 GB/month soft cap, no bucket) and Netlify (credit-based since 2025, roughly 15 to 30 GB/month free; documented as “works, not recommended for large galleries”). Vercel Hobby is non-commercial only and capped at 5k image transformations; not targeted. Hotlinking: Cloudflare’s Hotlink Protection toggle.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Sharp prebuilt binaries lack JXL encode | AVIF primary; JXL via optional `cjxl` adapter (Chrome 155 and Safari decode it). Verify in spike. |
| AVIF encode speed on big libraries | Worker pool, `effort: 3`, incremental manifests. Measure on 20 real 24 to 45 MP files. |
| Astro incremental builds are experimental | Measure with `--timings`; fall back to parallel prerender or plain builds; the per-page cost is small anyway since no Sharp runs in CI. |
| Firefox lags on carousel pseudo-elements and some transitions | Every feature in the inventory has a listed fallback; the prototype is reviewed in Firefox. |
| HEIC input (iPhone) | No HEVC decoder in prebuilt Sharp. Resolved: HEIC is decoded before Sharp, with macOS `sips` on a Mac and `libheif-js` (WebAssembly) elsewhere. On iPhone XS Max, 13 mini and 16 Pro files the two agree to within one level in 255 on average; libheif takes 0.5 s for 12 MP, 0.9 s for 24 MP. |
| RAW input | Out of scope; export from Lightroom. |
| HDR gain maps | Stretch: pass the original JPEG through unresized as the pro variant when `hdr: true`. Sharp drops gain maps on resize. |
| Repo bloat | `originals: 'none'` default in repo mode; bucket mode above 500 photos; `doctor` warns at 500 MB. No Git LFS. |
| 20k file cap | `doctor` projects the count; bucket mode moves derivatives out. |
| Content Layer at 10k+ entries | Verify store performance, `deferRender` and chunked storage in the spike. |
| exifr vs Lightroom XMP | Verify `dc:title`, `dc:description`, `dc:subject`, `xmp:Rating`, IPTC Core location; `fast-xml-parser` for `.xmp`; `exiftool-vendored` as the heavyweight fallback. |
| Colour management | Always convert to sRGB with ICC embedded; eyeball on a P3 display. |
| Admin endpoint exposure | Injected only when `command === 'dev'`, bound to localhost, absent from builds. |

## Phases

**Phase 0, design (about 1 week, can overlap the spike)**: brief, clickable prototype, two review rounds, sign-off. Described above.

**Spike (1 to 2 days, design-independent)**

- Day 1: `pipeline` script over the demo `photos/` (250 Adobe RGB JPEGs from the legacy backup) plus 20 of Yann’s full-res files: exifr, ladder, dominant colour, histogram, thumbhash, manifest. Record seconds per photo, bytes per photo, file count.
- Day 2: Astro 7.4 project, custom loader from manifests + sidecars, `/[...album]/` and `/[...album]/[photo]/`, cross-document morph from grid to photo, speculation rules, incremental build on, `wrangler pages deploy`. Measure with `--timings`.
- Exit criteria: the thumb morphs into the photo in Chrome and Safari; ~250 photos under 1.5k files; a second build with one changed photo re-renders only that page; encode under 3 s per 24 MP photo; a public Pages URL.

**Phase 1, core (2 to 3 weeks)**: monorepo setup (pnpm, Prettier config, changesets, the “Desktop app shell” issue filed), `pipeline` and `astro` packages, Zod 4 config carrying the useful parts of the old `mg_prefs.php` surface, override precedence, facets, the theme built from the approved prototype on mCSS with the typed token contract, CLI `add`/`sync`/`doctor`, repo adapter, minimal `create-minimalgallery`. Deliverable: the demo gallery live on Cloudflare Pages, matching the prototype.

**Phase 2, viewer completion (2 weeks)**: filter palette, info popover with clickable values, strip-to-grid gesture, date rail, zoom, slideshow, random, list, OG and feed, phone pass, theming docs.

**Phase 3, ingest (2 to 3 weeks)**: option A admin (drag-drop, progress, metadata and album editors, reorder, publish button), S3 adapter for R2/B2, `sync --prune`, `watch`.

**Phase 4, breadth and launch**: GitHub Pages and Netlify configs, map, download original, legacy `?id=` redirects, optional JXL, HDR experiment; minimalgallery.net goes live as the demo gallery (`apps/site`); docs.minimalgallery.net goes live (`apps/docs`, Starlight) with getting started, the theme and token contract, sidecar reference, CLI reference, a version history page generated from the changesets changelog and GitHub releases, and a downloads page (npm packages now, app installers if option B ever ships). Both are Cloudflare Pages projects on the same account; DNS for the apex and the `docs` subdomain is set at Cloudflare.

**Later, if wanted**: option B desktop shell (tracked in the issue); theme customization UI in the admin, generated from the token contract; browser-only ingest (jSquash + GitHub API); a second theme against the theme contract.

Libraries: astro@7.4, sharp, exifr, thumbhash, zod 4, piscina, hash-wasm, gray-matter, fast-xml-parser, aws4fetch, simple-git, wrangler, @clack/prompts, maplibre-gl + pmtiles. Verify before relying on: Sharp JXL and P3 output, exifr sidecar XMP, Astro incremental builds with the Content Layer, `deferRender` and chunked storage semantics, `view-transition-name` via `pageswap`, Safari status of carousel pseudo-elements, wrangler upload time for 1 GB.

## Monorepo layout and the legacy code

```
minimalgallery.net/
  pnpm-workspace.yaml
  .prettierrc.yaml            per the global formatting rules
  design/                     brief, prototype, tokens
  packages/ pipeline/ astro/ cli/ create/
  examples/demo/              the 250-photo gallery; photos/ committed as the test fixture
  apps/site/                  minimalgallery.net: the demo gallery, built with the tool
  apps/docs/                  docs.minimalgallery.net: Starlight docs, version history, downloads
  .changeset/                 changesets drive package versions, the changelog and GitHub releases
  legacy/                     the PHP app, moved with git mv
```

Keep `legacy/` for reference during the port (id slugging, filter semantics, the prefs surface); remove after v2 ships. From the backup deployment copy only `photos/` into `examples/demo/`, converting its two `.txt` captions to `.md` sidecars; the rest is unrelated site code.

## Execution model and what is needed from Yann

Execution: this session orchestrates and reviews; the work is done by subagents on Opus 5.5. Design-heavy and architecture-heavy tasks (the prototype, the loader, the pipeline, the theme) run at high effort; mechanical tasks (scaffolding, configs, docs pages) at medium. Each task gets a self-contained brief naming files, contract and done-criteria; independent tasks run in parallel when they touch different files (the pipeline spike and the prototype can start together). Every result is reviewed here against the plan before the next task starts, and verification commands are run from here.

Already on this machine: Node 24.11, npm, gh (logged in as minimaldesign, remote `minimaldesign/minimal-gallery`), ExifTool 13.55, cjxl 0.11.2 (so JXL encode is available), the mCSS skill. pnpm and wrangler are installed as part of setup (corepack, npx).

Needed from Yann:

1. A folder of about 20 full-resolution JPEG exports (ideally with Lightroom titles, keywords and ratings) for the spike’s pipeline measurements.
2. One `npx wrangler login` in the browser when the spike reaches deploy (this session will say when), and the Cloudflare account that owns minimalgallery.net DNS.
3. Agreement that this repo is restructured in place (PHP moved to `legacy/`, monorepo at the root) and that the desktop-app issue is filed on `minimaldesign/minimal-gallery`.
4. Review time for the prototype: two rounds in Phase 0.

## Verification

- Design: the prototype opens from the artifact link; grid-to-photo morph, strip, info popover and palette work in Chrome and Safari; Firefox degrades to the listed fallbacks; it reads well on a phone.
- Spike: the numbers in the exit criteria, and correct colour on the Adobe RGB sources.
- Each phase: `examples/demo` builds and deploys from CI with no Sharp in the build; `doctor` reports file count and bytes; Lighthouse on an album and a photo page (no CLS, LCP from the preloaded hero); the built site is compared against the approved prototype.
- Ingest: drop a folder of 100 photos; confirm dedupe, manifests, sidecar writes contain only overridden fields, and `publish` ends with a live URL.

## Research appendix (verified October 2026)

| Host | Facts | Verdict |
| --- | --- | --- |
| Cloudflare Pages / Workers static | 20,000 files/site, 25 MiB/file, 500 builds/month, 20 min build timeout, static requests free and unlimited | Default |
| Cloudflare R2 | 10 GB, 1M class A + 10M class B ops/month, zero egress, S3 API | Default for large galleries |
| Backblaze B2 | 10 GB free, free egress behind Cloudflare | Alternative bucket |
| GitHub Pages | 1 GB site, 100 GB/month soft cap, 10 min deploy timeout | Small galleries |
| Netlify | Credits since Sept 2025: 300/month, 10 to 20 per GB, team pauses when exhausted | Not recommended |
| Vercel Hobby | Non-commercial, 5k image transforms/month, 10 MB / 8192 px source limits | Not targeted |
| Cloudflare Images | 5,000 unique transformations/month free, then $0.50 per 1,000 | Optional paid adapter |

Astro: 7.0 (June 2026) Rust compiler, Vite 8 + Rolldown, route caching; 7.1 per-element CSP, `deferRender`, multiple dev servers; 7.2 experimental incremental static builds, background preview; 7.3 multiple preview servers; 7.4 (Oct 15, 2026) `--timings`, experimental parallel prerendering, static redirect page; 7.4.2 current. Browsers: cross-document view transitions in Chrome and Safari, Firefox 144+ partial; anchor positioning Baseline since Jan 2026; Grid Lanes in Safari 26.4 only; carousel pseudo-elements Chrome 135+; JPEG XL decoded by Chrome 155 and Safari 17+; HDR gain maps in Chrome (JPEG) and Safari 26, not Firefox. Interop 2026 focus areas include view transitions, scroll-driven animations, anchor positioning, scroll snap, `contrast-color()`, `shape()`, dialog and popover additions.

Landscape: Sigal, Fussel, thumbsup (static, no modern viewer or ingest); Astro Photo Folio, Memori (lightbox themes, no pipeline); Immich, PhotoPrism, Photoview (servers); SmugMug, Pixieset, Format (lock-in). The gap is a static toolkit that owns the path from “drop JPGs here” to a polished high-res viewer on free hosting.
