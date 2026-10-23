# @minimalgallery/pipeline

Local processing for a minimalgallery site. It reads the photos in `photos/`, writes resized copies (derivatives) and one JSON manifest per photo, and leaves the build with nothing to do but read the manifests. Pure Node, no Astro dependency. Processing runs on your machine before the build, never in CI.

For each photo it:

- reads metadata from sidecars, XMP, IPTC and EXIF, field by field, in a fixed order of precedence;
- encodes the derivative ladder (AVIF and JPEG by default) in a worker pool, converting colour to sRGB (or Display P3) from the embedded ICC profile;
- computes the dominant colour (OKLCH), a ThumbHash and a tiny JPEG placeholder;
- precomputes the facet keys the site needs (year, month, day, camera, lens, aperture, shutter, ISO, focal length and bucket, keywords, place);
- writes `.minimalgallery/manifest/<photoId>.json`, plus `_albums.json` for the albums.

Runs are incremental: unchanged photos are skipped, sidecar edits rewrite the manifest without re-encoding.

## Commands

```sh
mg-pipeline <galleryDir> [--prune] [--force] [--concurrency N] [--threads N] [--quiet] [--json summary.json]
mg-pipeline doctor <galleryDir> [--json report.json]
```

- `--prune` removes the manifests and derivatives of photos that no longer exist, then empty folders and interrupted writes. Each removed photo id is printed.
- `--force` re-encodes every photo.
- `--concurrency` sets the number of encoding workers; `--threads` sets libvips threads per worker. By default they follow the batch: workers = min(CPUs, photos to encode), threads = max(1, floor(CPUs / workers)). A full gallery gets one thread per worker; a single new photo gets every core.
- The exit code is 1 when any photo failed (an unsupported format, a file that cannot be decoded). The other photos are still processed.

`doctor` reads the manifests and the photos folder without encoding anything, and prints:

- photo, album and undated counts, derivative files and bytes;
- the projected Cloudflare Pages deploy: one HTML page per visible photo, one HTML page and one `<context>.json` per context (the archive, each album, each facet value), the derivatives in repo mode, and about 20 other files;
- that count against Pages’ 20,000 file limit, and the media bytes in the repository against 1 GB, with the number of photos left before each;
- a recommendation: repo mode is fine; plan bucket mode (past 500 photos or 500 MB); or move to bucket mode (over a limit);
- issues: photos with no manifest, orphaned manifests, HEIC or RAW files without a JPEG.

## Configuration

`minimalgallery.config.ts` (or `.mts`, `.js`, `.mjs`) in the gallery directory. Every key is optional; without a file, every default applies.

```ts
import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'Yann’s photos',
  author: 'Yann',
  site: 'https://photos.example.com',
  storage: { mode: 'repo' },
  originals: 'none',
  color: 'srgb',
  defaults: { fit: 'fill', backdrop: 'photo' },
  albums: { sort: 'date' },
});
```

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `'Photos'` | Site name. |
| `author` | none | Site author. |
| `description` | none | Site description. |
| `site` | none | Public URL, for canonical links, the feed and `og:image`. |
| `storage` | `{ mode: 'repo' }` | Where derivatives go; see below. |
| `ladder` | the five variants below | Array of `{ name, longEdge, format: 'avif' \| 'jpeg' \| 'webp', quality, chroma?: '4:2:0' \| '4:4:4', always?: boolean }`. `always` writes the variant even when the source is smaller, at source size. |
| `originals` | `'none'` | `'repo'` copies originals to `public/_mg`; `'bucket'` uploads them to the s3 storage (needs `storage.mode: 's3'`). |
| `color` | `'srgb'` | `'p3'` encodes derivatives in Display P3, keeping wide-gamut colour. |
| `defaults.fit` | `'fill'` | Viewer: `'fill'` covers the window, `'fit'` shows the whole photo. |
| `defaults.strip` | `false` | Viewer: filmstrip on. |
| `defaults.crop` | `'square'` | Grid thumbnails: `'square'` or `'original'`. |
| `defaults.view` | `'grid'` | `'grid'` or `'list'`. |
| `defaults.size` | `2` | Thumbnail size step, `1`, `2` or `3`. |
| `defaults.backdrop` | `'neutral'` | `'neutral'`, `'photo'` or `'light'`. |
| `albums.sort` | `'date'` | Sort for albums whose `_album.md` does not set one. |

The pipeline reads `storage`, `ladder`, `originals` and `color`; the rest is for the site. Changing the ladder or `color` re-encodes every photo.

`loadConfig(dir)` returns the resolved config with every default filled in. It caches nothing, so a dev server can call it after each edit. A value that does not validate stops with the file name and the key.

## Storage modes

- **repo** (default): derivatives are written to `public/_mg/<photoId>/<hash8>-<variant>.<ext>` and served from `/_mg/...`. They are committed and deployed with the site. Fine up to a few hundred photos; `doctor` says when to move.
- **s3**: an S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3), served from `publicUrl`.

  ```ts
  storage: {
    mode: 's3',
    bucket: 'photos',
    endpoint: 'https://<account>.r2.cloudflarestorage.com',
    region: 'auto',
    publicUrl: 'https://media.example.com',
  }
  ```

  Credentials never go in the config: they come from `MG_S3_ACCESS_KEY_ID` and `MG_S3_SECRET_ACCESS_KEY`. The s3 adapter is not implemented yet (it rejects writes); URLs are already computed from `publicUrl`.

Keys are content-addressed (`hash8` comes from the source file’s hash), so a URL never changes for a given file and can be cached forever.

## Folders

```
photos/
  japan-2025/          album = folder; nesting allowed
    _album.md          frontmatter: title, cover, sort, order[], hidden, date, photos{}
    DSC_0412.jpg       original, never modified
    DSC_0412.md        per-photo override: frontmatter + markdown caption
    DSC_0412.xmp       Lightroom sidecar, read only
```

Album id: slugged folder path joined by `/`. Photo id: `<album slug>__<file slug>`, where a nested album’s segments are joined by `_`. Slug: lowercase, every run of non-alphanumeric characters replaced by `_` (the v0.8 convention). Two files or folders that give the same id stop the run with an error.

Supported inputs: JPEG, PNG, WebP, AVIF, TIFF. HEIC and RAW files (`.heic`, `.nef`, `.cr3`, `.dng` and the like) are reported with the fix: export a JPEG. HEIC saved under a `.jpg` name is recognised from its content. A RAW or HEIC file with a JPEG of the same name next to it is ignored, and the JPEG is used.

## Manifest

The shape is defined, with comments on each field, by the Zod schemas in [`src/schema.ts`](src/schema.ts): `PhotoManifest`, `AlbumManifest`, `AlbumsFile`. The fields most pages need:

- `id`, `album`, `slug`, `file`, and `source`: the path relative to `photos/` (`feelings/Greenport.jpg`), shown as “File” in the viewer.
- `title`, `caption` (raw markdown), `keywords`, `rating` (1 to 5, or null when unrated), `copyright`, `author`, `hidden`.
- `date`, `tz`, `dateSource`: see Dates.
- `camera`, `lens`, `exposure` (`shutter` as a display string and `shutterSeconds`, `aperture`, `focal`, `focal35`, `iso`, `ev`, `metering`, `flash`), `gps`.
- `place` (`{ city, state, country, location }`, where `location` is the IPTC Sub-location) and `placeLabel` (“Kyoto, Japan”).
- `width`, `height` (after orientation), `color` (dominant, OKLCH), `thumbhash`, `placeholder` (data URL), `variants[]` (`name`, `width`, `height`, `bytes`, `format`, `url`, `key`), `original` (with `url` when originals are published).
- `facets`: precomputed facet keys; see Facets.
- `digest`: a hash of everything above, for Astro’s entry digest and incremental build `cacheKey`.

## Metadata precedence

Highest first, field by field: `<name>.md` or `<name>.json` sidecar, the `photos:` map in the album’s `_album.md`, `<name>.xmp` sidecar, embedded XMP, IPTC, EXIF, the file name. The `.md` body is the caption. `place` and `exposure` merge per sub-field, so a sidecar can set only the city and keep the country from IPTC.

A rating of 0 (Lightroom’s “unrated”) or -1 (rejected) in the first layer that sets a rating is stored as `null`.

## Dates

`date` is the camera’s wall-clock time, `YYYY-MM-DDTHH:MM:SS`, with no offset. Offsets written in XMP or IPTC are dropped: they belong to the computer that edited the file, not to the place the photo was taken. The only offset kept is EXIF OffsetTimeOriginal, stored as `tz` (`+09:00`), and only when `date` is the camera’s own DateTimeOriginal. Most cameras made before 2016 do not record it.

When no layer has a capture date, the pipeline tries EXIF CreateDate, then IPTC DateCreated, then the file’s modification time with `dateSource: 'mtime'`. Undated photos stay in their albums, but have no date facets and sort after dated photos.

## Sorting

`sortPhotos(photos, mode, order?)` from `@minimalgallery/pipeline/facets`:

- `date` (the default for albums and the archive): newest first, undated photos last in file-name order. Photos taken in the same second keep file-name order reversed, consistent with the rest of the list.
- `name`: by file name, numbers compared as numbers.
- `manual`: the photos named in `order` (file name, name without extension, or slug) first, in that order; the rest by date.

Album manifests store `photoIds` in this order.

## Facets

`facets` in each manifest holds:

| Key | Example | Notes |
| --- | --- | --- |
| `year`, `month`, `day` | `'2005'`, `'02'`, `'02-27'` | Null when undated. `month` and `day` match across years. |
| `camera`, `lens` | `{ slug: 'nikon-d70', label: 'Nikon D70' }` |  |
| `aperture` | `5.6` | URL key: `apertureKey(5.6)` is `'5.6'`. |
| `shutter` | `{ seconds: 0.0167, label: '1/60' }` | URL key: `shutterKey('1/60')` is `'1-60'`. |
| `iso`, `focal` | `200`, `50` | `focal` in mm as recorded. |
| `focalBucket` | `'short-tele'` | `wide` up to 24 mm, `normal` 25 to 50, `short-tele` 51 to 105, `tele` over 105, on the 35 mm equivalent when the camera records it, else on the recorded focal length (which reads short on compacts and phones that omit it). |
| `keywords` | `[{ slug: 'bamboo', label: 'Bamboo' }]` | Deduplicated by slug. |
| `place` | `{ slug: 'kyoto-japan', label: 'Kyoto, Japan' }` | From `placeLabel`. |

Facet slugs come from one function, `facetSlug()`: lowercase, Latin accents removed, every run of characters that are not letters or digits replaced by `-`, no `-` at either end. Letters of other scripts are kept (`東京` stays `東京`). Facet slugs use `-`; photo ids keep the v0.8 `_`.

## Incremental runs

1. Same file size and mtime, same sidecars, same pipeline version, ladder and colour, derivatives present: skipped.
2. Otherwise the file is hashed (xxhash64). Same hash and same ladder: metadata is read again and the manifest rewritten, nothing is encoded. Sidecar edits and pipeline upgrades that only change the manifest land here.
3. Otherwise the photo is encoded, and derivatives from its earlier version are removed.

## Derivatives

| Variant    | Long edge | Format                                         |
| ---------- | --------- | ---------------------------------------------- |
| `grid`     | 640       | AVIF q55 4:2:0, always written                 |
| `w1280`    | 1280      | AVIF q55 4:2:0                                 |
| `w2048`    | 2048      | AVIF q55 4:2:0                                 |
| `w3200`    | 3200      | AVIF q60 4:4:4                                 |
| `jpeg1600` | 1600      | JPEG q80, progressive, mozjpeg, always written |

A variant larger than the source is skipped unless it is marked `always`, in which case it is written at source size. AVIF effort is 3. Pixels are converted from the embedded ICC profile (untagged means sRGB) and tagged sRGB or Display P3; EXIF, XMP, IPTC and GPS are not copied into derivatives.

## API

Everything is exported from `@minimalgallery/pipeline`. Subpaths for code that needs only part of it:

- `@minimalgallery/pipeline/schema`: the Zod schemas and types.
- `@minimalgallery/pipeline/facets`: `facetSlug`, `facetRef`, `apertureKey`, `apertureLabel`, `focalKey`, `shutterKey`, `focalBucket`, `FOCAL_BUCKETS`, `placeLabel`, `isDated`, `photoFacets`, `sortPhotos`, `compareNewestFirst`. No Node dependencies.
- `@minimalgallery/pipeline/config`: `defineConfig`, `loadConfig`, `findConfigFile`, `resolveConfig`, `defaultConfig`, `ladderFromConfig`, `GalleryConfigSchema`, types `GalleryConfig`, `GalleryConfigInput`, `ViewerDefaults`.
- `@minimalgallery/pipeline/doctor`: `doctor`, `formatDoctorReport` and the limits.
- `@minimalgallery/pipeline/slug`: photo and album ids (`slugify`, `photoIdFor`, `albumIdFromPath`).
