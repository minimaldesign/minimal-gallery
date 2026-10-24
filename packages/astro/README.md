# @minimalgallery/astro

The Astro 7.4 side of minimalgallery: an integration, a Content Layer loader over the manifests written by `@minimalgallery/pipeline`, the context model (the archive, albums and facets) with its page helpers, and the one theme v2 ships.

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
  defaults: { fit: 'fill', strip: false, crop: 'square', view: 'grid', size: 2, backdrop: 'neutral' },
});
```

Options passed to `minimalgallery({ ... })` override the same keys of that file. `galleryDir` (default: the Astro root) is where `photos/`, `.minimalgallery/manifest/`, the config file and `custom.css` live.

The integration sets Vite’s PostCSS chain for the theme (`@csstools/postcss-global-data` with the mCSS custom media, `postcss-mixins`, `postcss-preset-env` on Baseline 2024 with native cascade layers kept). An inline PostCSS config replaces a project’s `postcss.config.*`; add your own plugins there if you need them.

## Routes

The theme is a set of components; the site owns its routes, so each can be replaced. The demo in `examples/demo/src/pages` is the reference, and every file is a few lines:

| File | URLs | Renders |
| --- | --- | --- |
| `index.astro` | `/` | The archive context (`grid`), opened on the viewer with the newest photo, plus `<LegacyRedirect>` for v0.8 `/?id=` links |
| `[...context]/index.astro` | `/colors/`, `/year/2005/`, `/month/02/`, `/on/02-27/`, `/camera/nikon-d70/`, `/lens/<l>/`, `/aperture/5.6/`, `/shutter/1-60/`, `/iso/200/`, `/focal/<bucket>/`, `/keyword/<k>/`, `/place/<p>/` | Every album and facet context, opened on its photos (`start="grid"`) |
| `[...album]/[photo].astro` | `/<album>/<slug>/` | One page per photo, in its album’s context |
| `[...context].json.ts` | `/grid.json`, `/colors.json`, `/camera/nikon-d70.json`, … | The context JSON the theme script reads for `?in=` |
| `legacy-ids.json.ts` | `/legacy-ids.json` | v0.8 photo id to page URL |

Facet slugs and labels come from each manifest’s `facets` (the pipeline’s `photoFacets()`). An album whose first folder segment is a facet route (`year`, `camera`, …), `grid` or `legacy-ids` fails the build with a message naming it.

A thumbnail inside a context links to the photo page with `?in=<context id>`; albums need none, they are the default. The photo page ships its album statically; the theme script fetches `<context id>.json` (cached in `sessionStorage`) and keeps previous and next, the strip, the grid, the list, the breadcrumb and the prerender list inside that context. Navigation stops at both ends of a context. Without script the page stays in its album.

## Helpers

From `@minimalgallery/astro/gallery` (inside Astro only, they read the collections):

- `getPhotos()` (newest first, undated last), `getPhoto(id)`, `getAlbums()`.
- `getContexts()`, `getContext(id)` (with `photos`, its ordered list), `albumContextOf(photo)`, `getPalette()`.
- `neighbors(contextId, photoId)`: `{ prev, next }`, null past either end (no wrapping).
- `photoHref(photo, context)`, `contextHref(context)`, `facetHref(key, slug)`.
- `contextJson(context)`: the JSON for `?in=`, `{ title, href, photos: [{ slug, href, thumb, preview, title, ar, color, year, tip, cells, sort }] }`.
- `pageCacheKey(photo, context)` and `contextDigest(context)`: incremental-build keys from the manifest digests. A page’s key covers the photo it shows, the context it lists, the palette and the config, so a changed caption re-renders only the pages that show that photo.

## Theme

`@minimalgallery/astro/theme/ViewerPage.astro` is the one template: the viewer on top and, below it, the panel with the context’s photos as a grid and as a list.

```astro
<ViewerPage photo={photo} context={context} start="grid" />
```

Props: `photo`, `context`, `start` (`view`, the default, or `grid`). A `head` slot adds to the document head. `GalleryLayout.astro` is the document shell on its own; the blocks (`Hud`, `Stage`, `Strip`, `PanelHead`, `Thumbs`, `Ledger`, `Rail`, `InfoPane`, `KeysPane`, `Palette`, `ToggleOption`) are under `theme/components/`.

The CSS is mCSS (the framework is vendored under `src/theme/styles/framework`, never edited): `theme.mg.tokens.css` (the token contract), `theme.mg.ui.css` (semantic tokens and element rules), then one file per block, in the order listed in `src/theme/styles/mg.css`. Every `::view-transition` rule is in `global.transitions.css`.

The theme script (`src/theme/scripts/mg.js`, about 23 KB unminified) is loaded with `defer blocking="render"`; every page works without it. It restores the visitor’s settings before first paint, applies `?in=`, names elements for cross-document view transitions, and carries keys, touch, drag, sort and the palette.

## Token contract

Every token an owner may change is registered with `@property` in `src/theme/styles/site/theme.mg.tokens.css`, with a typed `syntax`, an `initial-value` and a comment giving its label, group and a line of help. A settings UI can be generated from that file later without changing the theme.

| Token | Syntax | Default | Label |
| --- | --- | --- | --- |
| `--mg-ground` | `<color>` | `oklch(0.14 0 0)` | Background |
| `--mg-accent` | `<color>` | `oklch(0.97 0 0)` | Highlight color |
| `--mg-fit` | `cover \| contain` | config `defaults.fit` | Photo fit |
| `--mg-backdrop` | `neutral \| photo \| light` | config `defaults.backdrop` | Backdrop |
| `--mg-backdrop-tint` | `<percentage>` | `10%` | Backdrop tint |
| `--mg-view-inset` | `<length>` | `16px` (0 on a phone) | Space around the photo |
| `--mg-strip` | `on \| off` | config `defaults.strip` | Filmstrip |
| `--mg-hud-idle` | `<time>` | `2s` | Hide controls after |
| `--mg-hud-density` | `<number>` | `1` | Control density |
| `--mg-hud-blur` | `<length>` | `20px` | Overlay blur |
| `--mg-hud-opacity` | `<percentage>` | `82%` | Overlay fill |
| `--mg-grid-crop` | `square \| original` | config `defaults.crop` | Grid thumbnails |
| `--mg-grid-view` | `grid \| list` | config `defaults.view` | Photos view |
| `--mg-grid-size` | `small \| medium \| large` | config `defaults.size` | Thumbnail size step |
| `--mg-row-height` | `<length>` | `180px` (112 on a phone) | Thumbnail size |
| `--mg-grid-gap` | `<length>` | `3px` | Grid gap |
| `--mg-motion` | `<number>` | `1` | Motion |

The six viewer defaults are written into their token’s `initial-value` at build time from `config.defaults` (`fit: 'fill' | 'fit'` becomes `cover | contain`, `strip` a boolean becomes `on | off`, `size: 1 | 2 | 3` becomes `small | medium | large`), and the matching controls are rendered checked, so the page is right before the script runs. A visitor’s own choice, stored in `localStorage`, wins over the default.

## Customizing with `custom.css`

Put a `custom.css` beside the config file. The integration links it after the theme, unlayered, so it is the last word over every theme layer. Change tokens first:

```css
@layer theme.user {
  :root {
    --mg-ground: oklch(0.1 0 0);
    --mg-row-height: 220px;
    --mg-hud-idle: 4s;
  }
}
```

Then, only for what no token covers, style the theme’s classes directly (the block names in the table of contents of `mg.css`). Unlayered rules in `custom.css` beat the theme at any specificity; no `!important` is needed.

## The browser admin

Under `astro dev` (and `minimalgallery admin`, which starts it), the integration adds the admin at `/_mg/admin/`: drop photos or folders to add them (dedupe by content, processed as they land, thumbnails as each finishes), fix what needs attention (dates from the file’s time, no camera data, duplicates), edit a photo’s title, caption, date, place, keywords and visibility (written to `<name>.md`, only the fields you change; originals are never touched), edit and reorder albums (`_album.md`), change the settings and `custom.css`, and publish. Files copied into `photos/` in Finder show up too.

It answers only this computer (a loopback address, a `localhost` host name and a per-process token) and is never part of a build: `astro build` loads none of it. In bucket mode the dev server serves photos from the local stage until they are uploaded, so the preview works before the first publish. The local HTTP API it uses, for a future desktop shell or anything else, is described in [`src/admin/README.md`](src/admin/README.md).
