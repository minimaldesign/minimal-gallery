# @minimalgallery/astro

The Astro 7.4 side of minimalgallery: an integration, a Content Layer loader over the manifests written by `@minimalgallery/pipeline`, the context model (the archive, albums and facets) with its page helpers, feeds and a sitemap, and the one theme v2 ships.

## Install

```sh
pnpm add @minimalgallery/astro @minimalgallery/pipeline astro
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import minimalgallery from '@minimalgallery/astro';

export default defineConfig({
  site: 'https://photos.example.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [minimalgallery()],
  experimental: { incrementalBuild: true },
});
```

```ts
// src/content.config.ts
import { defineCollection } from 'astro:content';
import { galleryLoader } from '@minimalgallery/astro/loader';

export const collections = {
  albums: defineCollection({ loader: galleryLoader('albums') }),
  photos: defineCollection({ loader: galleryLoader('photos') }),
};
```

The gallery’s name and the viewer defaults live in `minimalgallery.config.ts`, read with the pipeline’s `loadConfig()`:

```ts
// minimalgallery.config.ts
import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'minimal gallery',
  description: 'Photographs from 2004 to 2013.',
  defaults: { fit: 'fill', strip: false, crop: 'square', view: 'grid', size: 2, backdrop: 'neutral' },
});
```

Options passed to `minimalgallery({ ... })` override the same keys of that file. The keys the Astro side reads:

| Key | Default | Used for |
| --- | --- | --- |
| `name` | `'Photos'` | Page titles, the breadcrumb, `og:site_name`, the feeds |
| `description` | `` `Photographs in ${name}.` `` | The home page’s description, the feeds |
| `author` | none | The JSON Feed’s `authors` |
| `site` | none | Absolute URLs when `astro.config.mjs` has no `site` |
| `defaults` | `fit: 'fill'`, `strip: false`, `crop: 'square'`, `view: 'grid'`, `size: 2`, `backdrop: 'neutral'` | The viewer as a first-time visitor sees it (see [Token contract](#token-contract)) |
| `credit` | `true` | The credit lines; an integration option only, for now |
| `galleryDir` | the Astro root | Where `photos/`, `.minimalgallery/manifest/`, the config file and `custom.css` live; an integration option only |

**`site`.** Astro’s `site`, else `site` in the config file, makes URLs absolute. The feeds, the sitemap, the canonical link and the Open Graph tags need it. Without it, pages leave out the canonical link and the `og:*` and `twitter:card` tags, `robots.txt` has no `Sitemap:` line, and the feed and sitemap routes fail the build with a message saying where to set it.

**`credit`.** On by default: “Powered by minimal gallery” after the last row of the grid or the list, and “minimal gallery” with the package version as the footer of the keyboard shortcuts pane, both linking to https://docs.minimalgallery.net/. `minimalgallery({ credit: false })` turns both off. `minimalgallery.config.ts` does not take the key yet: the pipeline’s config schema drops it until it adds `credit` (a follow-up).

The integration registers Geist and Geist Mono with Astro’s Fonts API (self-hosted from their Fontsource packages) and sets Vite’s PostCSS chain for the theme (`@csstools/postcss-global-data` with the mCSS custom media, `postcss-mixins`, `postcss-preset-env` on Baseline 2024 with native cascade layers kept). An inline PostCSS config replaces a project’s `postcss.config.*`; add your own plugins there if you need them.

## Routes

The theme is a set of components; the site owns its routes, so each can be replaced. The demo in `examples/demo/src/pages` is the reference, and every file is a few lines:

| File | URLs | Renders |
| --- | --- | --- |
| `index.astro` | `/` | The archive context (`grid`), opened on the viewer with the newest photo, plus `<LegacyRedirect>` for v0.8 `/?id=` links |
| `[...context]/index.astro` | `/colors/`, `/year/2005/`, `/month/02/`, `/on/02-27/`, `/camera/nikon-d70/`, `/lens/<l>/`, `/aperture/5.6/`, `/shutter/1-60/`, `/iso/200/`, `/focal/<bucket>/`, `/keyword/<k>/`, `/place/<p>/` | Every album and facet context, opened on its photos (`start="grid"`) |
| `[...album]/[photo].astro` | `/<album>/<slug>/` | One page per photo, in its album’s context |
| `[...context].json.ts` | `/grid.json`, `/colors.json`, `/camera/nikon-d70.json`, … | The context JSON the theme script reads for `?in=` |
| `random.astro` | `/random/`, `/random/?in=<context>` | `<RandomPage />`: a random photo, of that context when `?in=` is given |
| `feed.xml.ts` | `/feed.xml` | RSS 2.0, the 50 newest photos (`rssFeed`) |
| `feed.json.ts` | `/feed.json` | JSON Feed 1.1, the same photos (`jsonFeed`) |
| `sitemap.xml.ts` | `/sitemap.xml` | Every context page, every photo page with its image (`sitemap`) |
| `robots.txt.ts` | `/robots.txt` | Crawling allowed, and the sitemap’s address (`robotsTxt`) |
| `legacy-ids.json.ts` | `/legacy-ids.json` | v0.8 photo id to page URL |

Facet slugs and labels come from each manifest’s `facets` (the pipeline’s `photoFacets()`). An album whose first folder segment is a facet route (`year`, `camera`, …), `grid`, `legacy-ids`, `feed`, `random`, `_astro` or `_mg` fails the build with a message naming it (`RESERVED_SEGMENTS` in `@minimalgallery/astro/facets`).

A thumbnail inside a context links to the photo page with `?in=<context id>`; albums need none, they are the default. The photo page ships its album statically; the theme script fetches `<context id>.json` (cached in `sessionStorage`) and keeps previous and next, the strip, the grid, the list, the breadcrumb and the prerender list inside that context. Navigation stops at both ends of a context. `?in=` takes a context id only (slugs joined by `/`); any other value is ignored. Without script the page stays in its album.

The head of every page rendered with `ViewerPage` links both feeds (`<link rel="alternate">`, RSS and JSON Feed). When `site` is known it also carries `<link rel="canonical">` and the link preview tags: `og:type` (`website`), `og:site_name`, `og:title` (the gallery name on the home page, the context’s label on a context page, the photo’s title on a photo page), `og:description`, `og:url`, `og:image` with `og:image:width`, `og:image:height` and `og:image:alt`, and `twitter:card` (`summary_large_image`). The image is `shareImageOf()` of the page’s photo: the newest on the home page, the first on a context page.

## Helpers

From `@minimalgallery/astro/gallery` (inside Astro only, they read the collections):

- `getPhotos()` (newest first, undated last), `getPhoto(id)`, `getAlbums()`, `ARCHIVE_ID` (`'grid'`).
- `getContexts()`, `getContext(id)` (with `photos`, its ordered list), `albumContextOf(photo)`, `getPalette()`.
- `neighbors(contextId, photoId)`: `{ prev, next, index, count }`, with `prev` and `next` null past either end (no wrapping).
- `photoHref(photo, context)`, `contextHref(context)`, `facetHref(key, slug)`.
- `withBase(path)`: a site path with Astro’s `base`; a full URL (a bucket’s) is left as it is.
- `siteOf(site?)`: the site’s URL from the argument (Astro’s `site`), else from the config file’s `site`, else `undefined`. `absolute(path, site)`: a site path or a full URL as an absolute URL.
- `shareImageOf(photo)`: the image for `og:image`, the feeds and the sitemap: the `jpeg1600` variant, else the largest JPEG, else the largest image.
- `captionText(photo, max = 200)`: the caption as one line of plain text, cut at a word near `max` characters; null without a caption. Page descriptions and the JSON Feed’s `summary` use it.
- `contextJson(context)`: the JSON for `?in=` (its shape is under [Theme contract](#theme-contract)).
- `srcsetOf`, `heroOf`, `thumbOf`, `previewOf`, `ratioOf`, `infoOf`, `cellsOf`, `tipOf`, `yearOf`, `shortDate`: the image and text values the components render, shared with the context JSON.
- `pageCacheKey(photo, context)` and `contextDigest(context)`: incremental-build keys from the manifest digests. A page’s key covers the photo it shows, the context it lists, the palette and the config, so a changed caption re-renders only the pages that show that photo.
- `legacyIds()`: the v0.8 id map.

From `@minimalgallery/astro/feeds` (inside Astro only too). Each takes the endpoint’s `site` (Astro’s) and falls back to the config file’s `site`; the first three throw without either.

| Function | Returns | Serve as |
| --- | --- | --- |
| `rssFeed({ site, limit = 50 })` | RSS 2.0 as a string: the newest photos, each with its caption, its album as `category` and its JPEG as `enclosure` and `media:content` | `application/rss+xml` |
| `jsonFeed({ site, limit = 50 })` | JSON Feed 1.1 as an object (pass it to `JSON.stringify`), with `authors` from `author` and `tags` from the keywords | `application/feed+json` |
| `sitemap({ site })` | The sitemap as a string: the home page, every album and facet page, every photo page with its image | `application/xml` |
| `robotsTxt({ site })` | `robots.txt` allowing everything, with a `Sitemap:` line when the site is known | `text/plain` |

Capture times have no zone, so the feeds give them as UTC; a feed reader that shows times in its own zone shifts them by its offset.

## Theme

`@minimalgallery/astro/theme/ViewerPage.astro` is the one template: the viewer on top and, below it, the panel with the context’s photos as a grid and as a list.

```astro
<ViewerPage photo={photo} context={context} start="grid" />
```

### Layouts

Imported from `@minimalgallery/astro/theme/<name>`. `Photo` and `Context` are the types from `@minimalgallery/astro/gallery`.

| Layout | Props | Slots | Renders |
| --- | --- | --- | --- |
| `ViewerPage.astro` | `photo: Photo`, `context: Context`, `start?: 'view' \| 'grid'` (default `view`) | `head` | A whole page: the viewer, the panel (grid, list, info pane, keyboard shortcuts pane, credit) and the filter palette, with the head tags under [Routes](#routes) |
| `GalleryLayout.astro` | `title: string`, `description: string`, `style?: string` (custom properties on `<body>`), `class?: string` (on `<body>`), `start?: 'view' \| 'grid'` (`grid` sets `data-start` on `<html>`) | `head`, default (the body) | The document shell: `restore.js` inline, the fonts, the token contract, `mg.css`, `custom.css`, the theme script |
| `RandomPage.astro` | none | none | A whole document for `/random/`: it picks a random photo (of the `?in=` context when given, skipping the photo the visitor came from) and replaces itself in the history; without script, a meta refresh to one photo chosen at build time |
| `LegacyRedirect.astro` | none | none | An inline script for the home page’s `head` slot: it sends v0.8 `/?id=` links to the photo’s page through `/legacy-ids.json` |

### Components

Under `theme/components/`, imported from `@minimalgallery/astro/theme/components/<name>`. Only `ToggleOption` has a slot: its default slot is the glyph when there is no `icon`.

| Component | Props | Renders |
| --- | --- | --- |
| `Hud` | `photo`, `context` | The bar over the viewer: breadcrumb, then Filter, Info, Filmstrip, Fill window or Fit photo, Keyboard shortcuts |
| `Stage` | `photo`, `context`, `prev: Photo \| null`, `next: Photo \| null`, `hero: boolean` (the photo is the page’s main image) | The viewer: the photo, the next and previous zones, the zoom checkbox, the strip, the handle down to the photos |
| `Strip` | `context`, `current: Photo` | The filmstrip container; its frames are built from the context JSON |
| `PanelHead` | `context`, `list?: boolean` (the list rows are in the HTML) | The panel header: breadcrumb, count, crop pair, size triple, grid or list pair, Filter |
| `Thumbs` | `context`, `current: Photo` | The grid |
| `Ledger` | `context`, `current: Photo`, `rows?: boolean` (render the rows) | The list, a table sortable by column |
| `Rail` | `context` | The date rail, one tick per year, hidden under two years |
| `Credit` | `version?: boolean` (the short line with the version), `class?: string` | The credit line; nothing when `credit` is false |
| `InfoPane` | `photo` | The info pane: the photo’s record, every value a link to its context |
| `KeysPane` | none | The keyboard shortcuts pane, with the credit’s version line as its footer |
| `Palette` | `context` | The filter dialog: one chip per album and facet value |
| `ToggleOption` | `type: 'checkbox' \| 'radio'`, `name`, `value?`, `label` (may hold `<b>`), `icon?`, `checked?`, `shortcut?`, `off?` (the value stored when unchecked), `id?`, `aria?` | One icon option: a hidden input, an icon and a tooltip |
| `FilterButton` | none | The Filter icon button; it opens the palette through the command invoker |
| `Tip` | `label`, `shortcut?`, `class?` | A toggle’s tooltip |
| `Icon` | `name: IconName` (from `icons.ts`) | One icon |

### CSS

The CSS is mCSS (the framework is vendored under `src/theme/styles/framework`, never edited). `GalleryLayout` imports `theme.mg.tokens.css` (the token contract) on its own, so the integration can write the viewer defaults into it, then `src/theme/styles/mg.css`: the framework, `theme.mg.ui.css` (semantic tokens and element rules), then one file per block in the order listed there. Every `::view-transition` rule is in `global.transitions.css`. The cascade order is under [Customizing with `custom.css`](#customizing-with-customcss).

### Script

`restore.js` (1.4 KB) is inlined in the head and runs before first paint in every engine: it copies the visitor’s settings from `localStorage` to `data-*` on `<html>`, carries hidden controls over from the last page, sets `data-script` and `data-panel`, keeps an early `pagereveal` event for the theme script, and defines `mgStrip()`, which builds the filmstrip while the page parses when the context JSON is cached.

The theme script (`src/theme/scripts/mg.js`, about 33 KB unminified) is loaded with `defer blocking="render"` (render-blocking in Chrome only); every page works without it. It steps between photos inside the page (a CSS opacity crossfade and `pushState`), applies `?in=`, builds the strip, the list and another context’s grid from the context JSON, runs the slideshow and the random step, names elements for cross-document view transitions where the browser has them, and carries keys, touch, drag, sort and the palette.

### Keyboard

| Key | Viewing mode |
| --- | --- |
| `←` `→` | Previous or next photo; nothing past either end |
| `Space` | Slideshow: starts and stops a timed step every `--mg-slideshow`. Pointer movement, an open dialog or zoom pauses it; it stops at the last photo, on `Esc` and when the panel opens |
| `r` | A random photo of the current context, inside the page (`/random/` when the context JSON cannot load) |
| `↑` | Open browsing mode (the panel) |
| `z` | Zoom to 1:1 and back |
| `i` | Photo information |
| `f` | Fill window or fit photo |
| `s` | Filmstrip |
| `/`, `⌘K` or `Ctrl+K` | Filter |
| `?` | Keyboard shortcuts |

| Key             | Browsing mode                    |
| --------------- | -------------------------------- |
| `←` `→` `↑` `↓` | Select a photo; `Enter` opens it |
| `Home` `End`    | Select the first or last photo   |
| `Esc`           | Back to viewing mode             |
| `1` `2` `3`     | Thumbnail size                   |
| `t`             | Square or original thumbnails    |
| `v`             | Grid or list view                |
| `/`             | Filter                           |

## Token contract

Every token an owner may change is registered with `@property` in `src/theme/styles/site/theme.mg.tokens.css`, with a typed `syntax`, an `initial-value` and a comment giving its label, group and a line of help (`label: …; group: …; note: …`). A settings UI can be generated from that file later without changing the theme. The tables below follow the file, one per group.

### Color

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-ground` | Background | `<color>` | `oklch(0.14 0 0)` | the near-black behind every page |
| `--mg-accent` | Highlight color | `<color>` | `oklch(0.97 0 0)` | marks the current frame and the chosen options, and draws focus rings |

### Viewer

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-fit` | Photo fit | `cover \| contain` | config `defaults.fit`, else `cover` | cover fills the window and crops the edges, contain shows the whole photo; visitors can switch, this is the default |
| `--mg-backdrop` | Backdrop | `neutral \| photo \| light` | config `defaults.backdrop`, else `neutral` | neutral is the background color, photo adds a hint of each photo’s own color, light is a pale gray |
| `--mg-backdrop-tint` | Backdrop tint | `<percentage>` | `10%` | how much of the photo’s color reaches the backdrop in photo mode |
| `--mg-view-inset` | Space around the photo | `<length>` | `16px` (`0px` under 768px) | 0 lets the photo meet the edge of the window |
| `--mg-strip` | Filmstrip | `on \| off` | config `defaults.strip`, else `off` | the row of frames along the bottom of the viewer; off by default, visitors can turn it on, this is the default |
| `--mg-slideshow` | Slideshow interval | `<time>` | `5s` | how long each photo stays in a slideshow (Space starts and stops it) |

### Overlays

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-hud-idle` | Hide controls after | `<time>` | `2s` | idle time before the controls fade; only pointer movement brings them back |
| `--mg-hud-density` | Control density | `<number>` | `1` | 0.85 is compact, 1 is regular, 1.2 is roomy |
| `--mg-hud-blur` | Overlay blur | `<length>` | `20px` | how much the photo behind a panel is blurred, 0 for none |
| `--mg-hud-opacity` | Overlay fill | `<percentage>` | `82%` | below about 80% white text can lose contrast over bright photos |

### Grid

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-grid-crop` | Grid thumbnails | `square \| original` | config `defaults.crop`, else `square` | square crops or each photo’s own shape; visitors can switch, this is the default |
| `--mg-grid-view` | Photos view | `grid \| list` | config `defaults.view`, else `grid` | a grid of thumbnails or a list with every value; visitors can switch, this is the default |
| `--mg-grid-size` | Thumbnail size step | `small \| medium \| large` | config `defaults.size`, else `medium` | small, medium or large thumbnails; visitors can switch, this is the default |
| `--mg-row-height` | Thumbnail size | `<length>` | `180px` (`112px` under 768px) | the medium step, as a square’s side or a row’s height |
| `--mg-grid-gap` | Grid gap | `<length>` | `3px` | space between thumbnails |

### Motion

| Token | Label | Syntax | Default | Note |
| --- | --- | --- | --- | --- |
| `--mg-motion` | Motion | `<number>` | `1` | scales every duration; 0 turns movement off |

The six viewer defaults (`DEFAULT_TOKENS` in `src/config.ts`) are written into their token’s `initial-value` at build time from `config.defaults` by `applyDefaultsToTokens()`: `fit: 'fill' | 'fit'` becomes `cover | contain`, `strip` a boolean becomes `on | off`, `size: 1 | 2 | 3` becomes `small | medium | large`, and `crop`, `view` and `backdrop` keep their values. The matching controls are rendered checked, so the page is right before the script runs. A visitor’s own choice, stored in `localStorage`, wins over the default; `--mg-backdrop` has no visitor control.

## Customizing with `custom.css`

Put a `custom.css` beside the config file (in `galleryDir`). `GalleryLayout` imports it as `virtual:minimalgallery/custom.css` after the theme’s CSS, and the integration resolves that to the file (or to an empty module when there is none), so it is the last stylesheet on every page. It goes through the same PostCSS chain as the theme, so the mCSS custom media (`--md-n-below`, `--motionNotOK`, …) work in it.

The theme declares the mCSS layer order: `base, elements, global, components, theme.default, theme.user, external, helpers`. A later layer wins over an earlier one, unlayered rules win over every layer, and `helpers` wins over everything because each of its declarations is `!important`.

| Order | Layer | Holds |
| --- | --- | --- |
| 1 | `base` | The mCSS reset |
| 2 | `elements` | mCSS element styles |
| 3 | `global` | mCSS global classes (accessibility, layout, prose) |
| 4 | `components` | Nothing: the theme does not import mCSS’s components |
| 5 | `theme.default` | mCSS’s default theme tokens |
| 6 | `theme.user` | This theme’s tokens: the contract’s values under 768px, the raw palette, type, radius and assets (`theme.mg.tokens.css`), then the semantic tokens and element rules (`theme.mg.ui.css`). An owner’s token overrides go here too |
| 7 | `external` | Nothing: a slot for third-party CSS |
| 8 | `helpers` | mCSS helpers |
| unlayered | The theme’s blocks | In the order of `mg.css`: `global.surface`, `global.transitions`, `component.toggle`, … `component.credit`, `page.viewer` |
| unlayered, last | `custom.css` | The owner’s rules |

Change tokens first, inside `@layer theme.user`:

```css
@layer theme.user {
  :root {
    --mg-ground: oklch(0.1 0 0);
    --mg-row-height: 220px;
    --mg-hud-idle: 4s;
  }
}
```

That block comes after the theme’s own `theme.user` rules, so with the same selector (`:root`) it wins. A plain override replaces the theme’s value at every window size, including the values under 768px of `--mg-view-inset` and `--mg-row-height`; repeat the media query to keep a phone value:

```css
@layer theme.user {
  :root {
    --mg-row-height: 220px;

    @media (--md-n-below) {
      --mg-row-height: 140px;
    }
  }
}
```

Each token is registered with `@property`, so a value that does not match its `syntax` (`--mg-hud-idle: soon`) does not break the page: the token falls back to its default.

Then, only for what no token covers, write unlayered rules for the theme’s classes (the block names are the files listed in `mg.css`; [Theme contract](#theme-contract) lists the ones the script uses). Unlayered rules win over every layer. The theme’s blocks are unlayered too, but `custom.css` comes after them, so a rule with the same selector wins on source order and no `!important` is needed. The theme’s state rules (under `:root[data-fit='contain']`, for example) are more specific: match their selector to override them.

## Theme contract

A second theme replaces the templates and the CSS. What it has to provide so the routes, `custom.css` and a future settings UI keep working:

- **The templates.** A `ViewerPage` with the props `photo`, `context` and `start` (`view` or `grid`) and a `head` slot (the home route puts `<LegacyRedirect>` there), and a `RandomPage` with no props for `/random/`. A site then changes themes by changing its imports. The data comes from `@minimalgallery/astro/gallery` and from `virtual:minimalgallery/config`: `title`, `description`, `author`, `site`, `credit`, `version`, and `defaults` as token values (`fit`, `strip`, `crop`, `view`, `size`, `backdrop`).
- **The token contract.** The same `@property` names and syntaxes, with the label, group and note comments, so an owner’s `custom.css` carries over. The integration writes the six viewer defaults only into a file whose path ends in `/theme/styles/site/theme.mg.tokens.css`, and fails the build when one of their `@property` rules is missing from it.
- **The context JSON**, `/<context id>.json` from `contextJson()`, read by any script that steps inside the page or applies `?in=`. A context id is slugs joined by `/` (`grid`, `colors`, `aperture/1.4`); the theme script and the random page ignore any other `?in=` value.

```ts
type ContextJson = {
  title: string | null; // null for the archive
  href: string; // the context page
  photos: Array<{
    slug: string;
    href: string; // the photo page, base included
    thumb: string; // the grid image
    preview: string; // the list's hover print
    src: string; // the viewer image (heroOf)
    srcset: string; // '' with a single image
    w: number;
    h: number;
    zoom: number; // the 1:1 width
    title: string;
    caption: string | null; // HTML
    info: Array<{ term: string; html: string; exposure?: boolean }>;
    ar: number; // width / height
    color: string;
    year: string; // 'undated' without a date
    tip: string; // the tooltip's second line
    cells: Array<Array<[string] | [string, string]>>; // list cells: [text, href?]
    sort: Array<string | number>; // sort keys, title first
  }>;
};
```

A theme that ships its own script may drop everything below. A theme that keeps `restore.js` and `mg.js` keeps this markup, because the scripts query it and build parts of it from the context JSON with these class names:

| Part | Hooks |
| --- | --- |
| Head | `<meta name="mg-root">` with the base path (for `<id>.json` and `/random/`); `restore.js` inline before the body; on a step the script updates `<title>`, `meta[name="description"]` and `link[rel="canonical"]` and replaces `link[rel="next"]`, `link[rel="prev"]` and `link[data-near]` |
| Viewer | `.stage` (the script adds the slideshow clock, `.stage_play`), `.stage_frame` (touch, focus), `.stage_scroller` (panning while zoomed), `.stage_next` (the next link, which holds the `.stage_photo` images; `.is-hidden` fades one out), `.stage_prev`, `.stage_zoom` (checkbox) |
| Strip | `.strip` with `data-context` (context id), `data-in` (the `?in=` its links take, none for an album) and `data-photo` (the page path); its first child is the list (`.strip_list`), followed by an inline `mgStrip(document.currentScript.previousElementSibling)`; frames are `.strip_item > .strip_link > .strip_image` |
| HUD | `.hud_crumbs a` (the first is the gallery name), `.hud_context`, `.hud_title`, `.hud` (hovered, the controls stay) |
| Panel | `#grid` (the section, `.table-start` when the page opens on it), `.table_scroller`, `.table_head`, `.table_count`, `.table_context`, `.table_rail` |
| Grid | `.thumbs` (gets `--x` and `--y`), `.thumbs_item` (`id="y-<year>"` on a year’s first photo), `.thumbs_link`, `.thumbs_image`, `.thumbs_tip.surface` |
| Rail | `.rail_list`, `.rail_link` (`href="#y-<year>"`), `.rail_year.surface` |
| List | `.ledger`: headers with `.ledger_sort` and `data-type="num"` for numbers (the script sets `aria-sort`), rows `tr[data-i]`, cells `td[data-sort]`; the second cell’s link is a row’s selectable item; built rows add `.ledger_thumb`, `.ledger_image`, `.ledger_preview.surface` (`--preview`) and `.ledger_previewImage` |
| Settings | `input[name]` for `info`, `keys`, `fit`, `strip`, `crop`, `view` (`grid`, `list`) and `size` (`small`, `medium`, `large`); a checkbox stores its `value` (default `on`) when checked and its `data-off` (default `off`) when not |
| Panes | `.pane#info` and `.pane#keys`, dragged by `.pane_head` (the script sets `--pane-x`, `--pane-y`, `data-moved` and `.is-dragging`); `#info-title`, `.info_caption`, `.info_list` with built `.info_row`, `.info_term`, `.info_value` and `.info_value-exposure` |
| Palette | `dialog.palette`, `.palette_search`, `.palette_group` (its first child is the heading), `li`, `.chip` |
| Properties | On a step the script sets `--photo`, `--photo-ratio` and `--photo-zoom-width` on `<body>` and removes `--photo-placeholder`; built items carry `--ar` and `--photo` |

The script reads `--mg-fit`, `--mg-strip`, `--mg-grid-crop`, `--mg-grid-view`, `--mg-grid-size` and `--mg-hud-idle` from `:root`. The slideshow advances on the `animationend` of `.stage_play`, so the CSS has to animate it over `--mg-slideshow` while `data-play` is set.

The scripts set these attributes on `<html>`; the theme CSS reads each setting from its attribute and, without script, from the checked input:

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-fit`, `data-strip`, `data-crop`, `data-view`, `data-size` | the token values | The visitor’s setting, else the token’s default |
| `data-info`, `data-keys` | `on`, `off` | The info pane or the keyboard shortcuts pane is open |
| `data-idle` | empty, `key` | The controls are hidden: empty after the idle time or a tap, `key` at once after a key or a swipe, or carried over from the last page |
| `data-panel` | empty | The panel is up |
| `data-script` | empty | The theme script will run |
| `data-start` | `grid` | The page opens on the panel (rendered by `GalleryLayout`) |
| `data-play` | empty | A slideshow is running |
| `data-pointer` | empty | A mouse is over the grid (tooltips follow it); a keyboard move removes it |

And these storage keys:

| Storage | Key | Holds |
| --- | --- | --- |
| `localStorage` | `mg-fit`, `mg-strip`, `mg-crop`, `mg-view`, `mg-size`, `mg-info`, `mg-keys` | The visitor’s settings |
| `localStorage` | `mgPane-info`, `mgPane-keys` | A moved pane’s position, `x,y` |
| `sessionStorage` | `mgCtx-<context id>` | The context JSON as text |
| `sessionStorage` | `mgIdle` | `1` while the controls are hidden, so the next page opens with them hidden |
| `sessionStorage` | `mgVia` | `thumb` or `other`: how the last page was left, for the view transition |

A theme with its own script can keep the `mg-<name>` keys so visitors keep their settings across a theme change.
