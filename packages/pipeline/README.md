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
- in bucket mode, the staged files waiting for upload and whether credentials are set, read from the disk without the network;
- issues: photos with no manifest, orphaned manifests, HEIC or RAW files without a JPEG, missing bucket credentials.

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
- **s3** (bucket mode): an S3-compatible bucket (Cloudflare R2, Backblaze B2, MinIO, AWS S3), served from `publicUrl`. See Bucket mode.

  ```ts
  storage: {
    mode: 's3',
    bucket: 'photos',
    endpoint: 'https://<account>.r2.cloudflarestorage.com',
    region: 'auto',
    publicUrl: 'https://media.example.com',
  }
  ```

  `region` defaults to `auto`, which R2 expects and MinIO accepts. Requests are path-style, `${endpoint}/${bucket}/${key}`.

Keys are content-addressed (`hash8` comes from the source file’s hash), so a URL never changes for a given file and can be cached forever.

## Bucket mode

The pipeline never writes to the network. In bucket mode it writes derivatives (and originals, with `originals: 'bucket'`) to a local stage, `.minimalgallery/cache/media/<key>`, and the manifests point at `${publicUrl}/<key>` from the start. Encoding works offline, and nothing is public before a publish. `sync` and `publish` then call `uploadToBucket`, which moves each staged file to the bucket, so the stage holds only the files waiting for upload. With `originals: 'repo'`, originals still go to `public/_mg`.

### Credentials

`MG_S3_ACCESS_KEY_ID` and `MG_S3_SECRET_ACCESS_KEY`, from the environment or from the gallery’s `.env` file (git ignores it). The environment wins, variable by variable. They never go in the config. For R2, create an API token with Object Read & Write on the bucket.

```sh
# .env, next to minimalgallery.config.ts
MG_S3_ACCESS_KEY_ID=...
MG_S3_SECRET_ACCESS_KEY=...
```

Without credentials the pipeline works on the stage alone, and the remote operations throw a `BucketError` whose message is `MISSING_CREDENTIALS`, written to be printed as is.

### What the pipeline asks the bucket

`has(key)`, which decides whether a photo is skipped, answers from the stage, then from a local record of the bucket’s keys, `.minimalgallery/cache/bucket.json`, rewritten by every upload, prune and full listing. Only when there is no record (a fresh clone) and credentials exist does it list the bucket, once per run, and save the listing as the record. If the bucket cannot be reached then, it counts as empty: the photos are encoded again into the stage instead of failing, and the next upload finds identical copies in the bucket and skips them. Wrong credentials fail every photo that needed the listing, with the S3 error.

`list`, `remove` and `sweep` act on the stage only, so `--prune` never deletes from the bucket: it removes the manifests and staged files of deleted photos. Their uploaded files become orphans, which `pruneBucket` deletes.

### Remote operations

Each takes the gallery directory and `{ config?, env?, fetch? }`: `config` defaults to `loadConfig(galleryDir)`, `env` (where credentials are read first) to `process.env`, `fetch` to the global one. They throw a `BucketError` when they cannot start (`code`: `not-bucket-mode`, `missing-credentials`, `no-manifests`, `unreadable-manifests`, `upload-failed`) and an `S3Error` when the bucket refuses or cannot be reached (`status`, 0 for a network error; `code`, such as `AccessDenied` or `NoSuchBucket`; `operation`; `credentials`, true for 401 and 403). Every message says what to check: a credential error names both variables, `NoSuchBucket` names `storage.bucket` and `storage.endpoint`, a wrong region names `storage.region`.

- `pendingUploads(galleryDir, { config? })` returns `{ files, bytes, keys }`: the staged files the manifests reference. Reads the disk only, never the network, so `doctor`, `watch` and the admin can call it at any time.
- `planBucketSync(galleryDir, options?)` lists the bucket once, saves the listing as the record, and compares it with the manifests and the stage. It returns `staged`, `inBucket`, `upload` and `uploadBytes`, `alreadyUploaded` (staged files identical to the bucket’s copy), `missing` (neither staged nor in the bucket; the next pipeline run encodes them again), `orphans` and `orphanBytes`, `unreadable` manifests, and the `manifests` and `referenced` counts.
- `uploadToBucket(galleryDir, { ...options, concurrency = 8, onProgress? })` returns `{ uploaded, bytes, alreadyUploaded, missing, seconds }`. It uploads every staged file the bucket lacks or holds a different version of (compared by size, then by MD5 against the ETag), with `Content-Type` from the extension and `Cache-Control: public, max-age=31536000, immutable`. `onProgress({ done, total, key, bytes, doneBytes, totalBytes })` runs after each file. Uploaded files are added to the record, then removed from the stage, in batches. It never deletes from the bucket. On the first failed upload it starts no new one, lets those in flight finish and records them, then throws `BucketError` `upload-failed` with the `S3Error` as `cause`; running it again continues where it stopped.
- `pruneBucket(galleryDir, { ...options, dryRun?, concurrency = 8 })` returns `{ removed, bytes, dryRun }`. It deletes the bucket keys no manifest references. Only keys of the pipeline’s shape (`<photo id>/<hash8>-<name>.<ext>`) and leftover check probes qualify, so other files in a shared bucket stay. It refuses when a manifest cannot be read or there are none, since every key would then look unreferenced. A live site may still use old keys until its next build, so only `sync --prune` calls it.
- `checkBucket(galleryDir, options?)` returns a `BucketCheck` (`ok`, `steps`, `public`, `probe`), and `formatBucketCheck(check)` prints it. It writes a probe under `_minimalgallery-check/`, finds it in a listing, HEADs it, fetches it through `publicUrl` (reporting the status and `Cache-Control`), and deletes it. Each step reports `ok`, `ms` and a message; a failed step never throws. Used by `doctor --bucket`.

Lower level:

- `s3Storage(options)`: a `Storage` on a bucket. Signs with SigV4 through `aws4fetch`, encodes keys per path segment, retries network errors, 429 and 5xx with exponential backoff (4 retries from 250 ms, honoring `Retry-After`), and answers `has` and `list` from one listing of the bucket, loaded on first use and kept current by `put` and `remove`. Adds `index()`, `refresh()`, `listObjects(prefix)` and `head(key)`. Accepts `fetch`, `retries`, `retryDelay` and `pageSize` for tests.
- `bucketStorage(options)`: the staged storage. `storageFromConfig(config, galleryDir, env?)` returns it in s3 mode.
- `bucketFromConfig(config, galleryDir, { env?, fetch? })`: the `s3Storage` of the config’s bucket, with credentials.
- `bucketCredentials(galleryDir, env?)`: the credentials, or null.

### Testing against a real server

The default test run uses an in-process mock S3 server that verifies every SigV4 signature. To run the same tests against MinIO as well (the tests create and delete their own public buckets):

```sh
docker run -d --name mg-minio -p 4430:9000 -e MINIO_ROOT_USER=mgtest -e MINIO_ROOT_PASSWORD=mgtest-secret-123 cgr.dev/chainguard/minio server /data
MG_TEST_S3_ENDPOINT=http://localhost:4430 MG_TEST_S3_ACCESS_KEY_ID=mgtest MG_TEST_S3_SECRET_ACCESS_KEY=mgtest-secret-123 pnpm --filter @minimalgallery/pipeline test
```

The `minio/minio` image is no longer published on Docker Hub; the Chainguard build above is the same server.

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
