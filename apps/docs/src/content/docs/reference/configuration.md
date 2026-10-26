---
title: Configuration
description: Every key of minimalgallery.config.ts, the options of the Astro integration, the storage modes and the derivative ladder.
---

This page lists every setting of a gallery: the keys of `minimalgallery.config.ts`, the options you can pass to the Astro integration, the two storage modes and the ladder of resized copies (derivatives) the pipeline writes for each photo.

## The config file

```ts title="minimalgallery.config.ts"
import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'Yann’s photos',
  author: 'Yann',
  storage: { mode: 'site' },
  originals: 'none',
  color: 'srgb',
  defaults: { fit: 'fill', backdrop: 'photo' },
  albums: { sort: 'date' },
});
```

The file sits in the gallery folder, next to `photos/`. It can be named `minimalgallery.config.ts`, `.mts`, `.js` or `.mjs`; the first one found in that order is used. Every key is optional, and a gallery without a config file uses every default.

`defineConfig()` only gives your editor the types. The values are checked when the file is loaded: a value that does not validate stops the command with the file name and the key at fault.

Two programs read the file:

- **The pipeline** (`minimalgallery add`, `sync`, `watch`, `admin`, `publish`, `doctor` and `mg-pipeline`) reads it on every run, so a change applies to the next run.
- **The Astro integration** reads it when the dev server or a build starts.

## Keys

| Key | Type | Default | Read by | Meaning |
| --- | --- | --- | --- | --- |
| `name` | `string` | `'Photos'` | site | The gallery’s name, shown in the header and in every page title. |
| `author` | `string` | none | site | The gallery’s author. Passed to the theme, which does not display it yet. |
| `description` | `string` | none | site | A description of the gallery. Passed to the theme, which does not display it yet. |
| `logo` | `string` | none | site | Path to an SVG file, relative to the gallery folder, shown before the name at the start of the header. Shapes without a fill of their own are drawn in the theme’s text color, so a one-color logo needs no fill at all. |
| `site` | URL | none | nothing yet | The public address of the gallery. It is validated but not read. Set `site` in `astro.config.mjs` for canonical links. |
| `storage` | object | `{ mode: 'site' }` | pipeline | Where the derivatives go. See [Storage modes](#storage-modes). |
| `ladder` | array | five variants | pipeline | The derivatives written for each photo. See [Derivative ladder](#derivative-ladder). |
| `originals` | `'none' \| 'site' \| 'bucket'` | `'none'` | pipeline | Whether the original files are published. See [Originals](#originals). |
| `color` | `'srgb' \| 'p3'` | `'srgb'` | pipeline | Color space of the derivatives. `'p3'` encodes them in Display P3 and keeps wide-gamut color. |
| `defaults` | object | see below | site | Starting values of the viewer’s settings. See [Viewer defaults](#viewer-defaults). |
| `albums.sort` | `'date' \| 'name' \| 'manual'` | `'date'` | pipeline | Photo order in albums whose `_album.md` does not set `sort`. See [Sidecars](/reference/sidecars/#_albummd). |

Changing `ladder` or `color` re-encodes every photo on the next run.

### Originals

| Value | What happens |
| --- | --- |
| `'none'` | The originals stay private. Only the derivatives are published. |
| `'site'` | Each original is copied to `public/_mg/<photo id>/<hash8>-original.<ext>` and deployed with the site, whatever the storage mode. |
| `'bucket'` | Each original is uploaded to the bucket. It needs `storage: { mode: 's3', ... }`; any other storage mode is a validation error. |

A published original’s URL is written to the photo’s manifest (`original.url`). The theme does not link to originals yet.

### Viewer defaults

The `defaults` object sets how the viewer looks on a visitor’s first visit. Visitors can change each setting, and their choice is kept in their browser and wins over the default.

| Key | Values | Default | Meaning |
| --- | --- | --- | --- |
| `defaults.fit` | `'fill' \| 'fit'` | `'fill'` | `'fill'` covers the window and crops the edges; `'fit'` shows the whole photo. |
| `defaults.strip` | `boolean` | `false` | Show the filmstrip under the viewer. |
| `defaults.crop` | `'square' \| 'original'` | `'square'` | Grid thumbnails as squares, or in each photo’s own shape. |
| `defaults.view` | `'grid' \| 'list'` | `'grid'` | Show a context’s photos as a grid or as a list. |
| `defaults.size` | `1 \| 2 \| 3` | `2` | Thumbnail size step: small, medium or large. |
| `defaults.backdrop` | `'neutral' \| 'photo' \| 'light'` | `'neutral'` | The background around the photo: the theme’s neutral background color, a tint of each photo’s own color, or a pale gray. |

At build time each default is written into the matching theme token (`--mg-fit`, `--mg-strip`, `--mg-grid-crop`, `--mg-grid-view`, `--mg-grid-size`, `--mg-backdrop`), so the page is right before any script runs. The tokens are listed in [Theme and tokens](/theme/).

## Astro integration options

```js title="astro.config.mjs"
import { defineConfig } from 'astro/config';
import minimalgallery from '@minimalgallery/astro';

export default defineConfig({
  site: 'https://photos.example.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [minimalgallery({ defaults: { backdrop: 'photo' } })],
  experimental: { incrementalBuild: true },
});
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `galleryDir` | `string` | the Astro project root | The folder that holds `photos/`, `.minimalgallery/manifest/`, the config file and `custom.css`. A relative path is resolved from the project root. |
| any config key | as above | from the config file | Overrides the same key of `minimalgallery.config.ts` for the site. `defaults` is merged key by key; other keys replace the file’s value. |

:::caution[Pipeline keys belong in the config file]

The integration’s overrides reach the site only. The pipeline reads `storage`, `ladder`, `originals`, `color` and `albums.sort` from `minimalgallery.config.ts` and never sees the integration’s options, so set those keys in the file.

:::

The content loader in `src/content.config.ts` reads the manifests from the integration’s `galleryDir`. To read one collection from another folder, pass the option to the loader:

```ts title="src/content.config.ts"
photos: defineCollection({
  loader: galleryLoader('photos', { galleryDir: '../archive' }),
}),
```

Besides reading the config, the integration:

- self-hosts the Geist and Geist Mono fonts;
- sets Vite’s PostCSS chain for the theme, which replaces a project’s own `postcss.config.*` (add your plugins to the integration’s chain if you need them);
- writes the viewer defaults into the theme tokens;
- links `custom.css` from the gallery folder after the theme, when the file exists;
- serves `astro dev` and `astro preview` on port 4800, so the admin and the preview keep one address you can bookmark (see [Changing the port](#changing-the-port));
- warns when `experimental.incrementalBuild` is on and `build.concurrency` is above 1, since Astro then renders every page.

### Changing the port

The admin and the preview use port 4800, so their address stays `http://localhost:4800/` and a bookmark keeps working. When something else on your computer already uses that port, the server stops with “Port 4800 is already in use” rather than moving to another port. Choose a different one with Astro’s own `server.port`:

```js title="astro.config.mjs"
export default defineConfig({
  server: { port: 4900 },
  // …
});
```

For a single start, pass it to the command: `npm run admin -- --port 4900`, or `npx astro preview --port 4900` for the preview of a build.

## Storage modes

| Mode | Derivatives are written to | Served from |
| --- | --- | --- |
| `repo` (default) | `public/_mg/<photo id>/<hash8>-<variant>.<ext>` | `/_mg/...` on the site |
| `s3`, photo storage | an S3-compatible bucket: Cloudflare R2, Backblaze B2, AWS S3, MinIO | `publicUrl` |

### Site mode

The derivatives live in the site’s `public/` folder and are published with every build. On Cloudflare this works up to [about 3,000 full-size photos](/hosting/#how-many-photos-fit). `minimalgallery doctor` projects the site’s file count against Cloudflare’s limit, and says when to add photo storage (past 16,000 files).

```ts title="minimalgallery.config.ts"
storage: { mode: 'site' },
```

### s3 mode

The derivatives go to a bucket and are served from `publicUrl`. The docs call this photo storage, and the command line calls it bucket mode. [Photo storage](/hosting/photo-storage/) sets it up step by step on Cloudflare R2.

```ts title="minimalgallery.config.ts"
storage: {
  mode: 's3',
  bucket: 'photos',
  endpoint: 'https://<account id>.r2.cloudflarestorage.com',
  region: 'auto',
  publicUrl: 'https://media.example.com',
},
```

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `bucket` | `string` | required | The bucket’s name. |
| `endpoint` | URL | required | The S3 API endpoint of the bucket. |
| `region` | `string` | `'auto'` | The bucket’s region. R2 uses `auto`. |
| `publicUrl` | URL | required | The public address that serves the bucket, usually a custom domain. Derivative URLs start with it. |

Credentials never go in the config. They come from two variables, read from the environment first, then from the gallery’s `.env` file:

| Variable | Value |
| --- | --- |
| `MG_S3_ACCESS_KEY_ID` | The access key id of an API token that can write to the bucket. |
| `MG_S3_SECRET_ACCESS_KEY` | Its secret access key. |

While encoding, the pipeline writes the derivatives to `.minimalgallery/cache/media` on this computer, never to the network. `minimalgallery sync` and `publish` upload them, with `Cache-Control: public, max-age=31536000, immutable`. `minimalgallery doctor --bucket` checks the bucket end to end.

### Keys and caching

Every stored file is named `<photo id>/<hash8>-<variant>.<ext>`, where `hash8` is the first eight characters of the source file’s xxhash64. A new version of a photo gets a new name, so a URL never changes for a given file and can be cached forever. The scaffold sets `Cache-Control: public, max-age=31536000, immutable` on `/_mg/*` for Cloudflare in `public/_headers`, and publish sets it on every file it uploads to photo storage. For your own host, see [Cache rules](/hosting/your-own-host/#cache-rules).

When a photo is re-encoded, its earlier derivatives are removed. When a photo is deleted, its derivatives stay until you run `minimalgallery sync --prune`; `watch` and `admin` prune them on their own.

## Derivative ladder

| Variant | Long edge | Format | Quality | Chroma | Always written |
| --- | --- | --- | --- | --- | --- |
| `grid` | 640 | AVIF | 55 | 4:2:0 | yes |
| `w1280` | 1280 | AVIF | 55 | 4:2:0 | no |
| `w2048` | 2048 | AVIF | 55 | 4:2:0 | no |
| `w3200` | 3200 | AVIF | 60 | 4:4:4 | no |
| `jpeg1600` | 1600 | JPEG (progressive, mozjpeg) | 80 | 4:2:0 | yes |

A variant whose long edge is larger than the source is skipped, so nothing is upscaled. A variant marked “always” is written anyway, at the source’s size. AVIF is encoded at effort 3.

For every variant, pixels are converted from the source’s embedded ICC profile (an untagged file is treated as sRGB) and tagged sRGB, or Display P3 with `color: 'p3'`. EXIF, XMP, IPTC and GPS data are not copied into derivatives.

The pipeline also stores, in each manifest, the photo’s dominant color (OKLCH), a ThumbHash and a 16-pixel-wide JPEG placeholder.

### A custom ladder

`ladder` replaces the whole list, so name every variant you want.

```ts title="minimalgallery.config.ts"
ladder: [
  { name: 'grid', longEdge: 640, format: 'avif', quality: 55, always: true },
  { name: 'w1280', longEdge: 1280, format: 'avif', quality: 55 },
  { name: 'w2560', longEdge: 2560, format: 'avif', quality: 58 },
  { name: 'jpeg1600', longEdge: 1600, format: 'jpeg', quality: 80, always: true },
],
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | required | Used in file names. Lowercase letters, digits and `-`, starting with a letter or digit. Names must be unique. |
| `longEdge` | integer, 16 to 16384 | required | Long edge in pixels. |
| `format` | `'avif' \| 'jpeg' \| 'webp'` | required | Output format. |
| `quality` | integer, 1 to 100 | required | Encoder quality. |
| `chroma` | `'4:2:0' \| '4:4:4'` | `'4:2:0'` | Chroma subsampling for AVIF and JPEG. Lossy WebP is always 4:2:0. |
| `always` | `boolean` | `false` | Write the variant even when the source is smaller, at the source’s size. |

The list needs at least one variant. The theme picks variants this way:

- grid thumbnails use the variant named `grid`, else the smallest AVIF;
- the list view’s preview uses `w1280`, else the largest variant up to 1600 pixels wide;
- the viewer’s `srcset` holds every AVIF variant, plus the first JPEG variant when it is wider than the largest AVIF.

A WebP variant is written and listed in the manifest, but the theme does not use it.
