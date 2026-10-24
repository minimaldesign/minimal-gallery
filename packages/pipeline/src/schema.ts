import { z } from 'zod';

/** Where manifests live, relative to the gallery directory. */
export const MANIFEST_DIR = '.minimalgallery/manifest';
export const ALBUMS_FILE = '_albums.json';
/**
 * Bucket mode keeps derivatives here, relative to the gallery directory,
 * until they are uploaded. Ignored by git; the dev server serves it.
 */
export const STAGE_DIR = '.minimalgallery/cache/media';

/**
 * A capture date as the camera’s clock showed it: local wall-clock time, no
 * offset (`2005-02-27T18:16:10`). Facets read it as written, so a photo taken
 * at 23:00 in New York stays on that day wherever the site is built.
 */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

/** A UTC offset such as `+09:00`. Only ever taken from EXIF OffsetTimeOriginal. */
export const UtcOffset = z.string().regex(/^[+-]\d{2}:\d{2}$/);

/**
 * Where the date came from. `mtime` means no layer had a capture date and the
 * file’s modification time was used: such photos stay in their albums, but
 * are left out of date facets and sorted after dated photos.
 */
export const DateSource = z.enum([
  'sidecar',
  'album',
  'xmp',
  'iptc',
  'exif',
  'mtime',
]);

export const Exposure = z.object({
  /** Display string: `1/60`, `2.5`. */
  shutter: z.string().nullable(),
  /** Exposure time in seconds. */
  shutterSeconds: z.number().nullable(),
  aperture: z.number().nullable(),
  /** Focal length in mm, as recorded. */
  focal: z.number().nullable(),
  /** 35 mm equivalent focal length, when the camera records it. */
  focal35: z.number().nullable(),
  iso: z.number().nullable(),
  ev: z.number().nullable(),
  metering: z.string().nullable(),
  flash: z.boolean().nullable(),
});

export const Gps = z.object({
  lat: z.number(),
  lon: z.number(),
  alt: z.number().optional(),
});

/**
 * Place names from IPTC and XMP. `location` is the IPTC Sub-location
 * (`Iptc4xmpCore:Location` in XMP): a neighbourhood, a park, a building.
 */
export const Place = z.object({
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  location: z.string().nullable(),
});

export const Oklch = z.object({ l: z.number(), c: z.number(), h: z.number() });

export const VariantFormat = z.enum(['avif', 'jpeg', 'webp']);

export const Variant = z.object({
  name: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  format: VariantFormat,
  url: z.string(),
  key: z.string(),
});

/** A facet value: `slug` for the URL, `label` for display. */
export const FacetRef = z.object({ slug: z.string(), label: z.string() });

export const FocalBucket = z.enum(['wide', 'normal', 'short-tele', 'tele']);

/**
 * Facet keys precomputed per photo. Date keys are null for undated photos
 * (`dateSource: 'mtime'`). Slugs come from `facetSlug()` in `./facets`.
 */
export const PhotoFacets = z.object({
  year: z.string().nullable(),
  /** `02`: that month in every year. */
  month: z.string().nullable(),
  /** `02-27`: that calendar day in every year. */
  day: z.string().nullable(),
  camera: FacetRef.nullable(),
  lens: FacetRef.nullable(),
  aperture: z.number().nullable(),
  shutter: z.object({ seconds: z.number(), label: z.string() }).nullable(),
  iso: z.number().nullable(),
  focal: z.number().nullable(),
  /** From the 35 mm equivalent when known, else the recorded focal length. */
  focalBucket: FocalBucket.nullable(),
  keywords: z.array(FacetRef),
  place: FacetRef.nullable(),
});

export const PhotoManifest = z.object({
  id: z.string(),
  album: z.string(),
  file: z.string(),
  /** Path relative to the gallery’s `photos/` folder, e.g. `feelings/Greenport.jpg`. */
  source: z.string(),
  /** Last segment of the photo URL inside its album. */
  slug: z.string(),
  /**
   * When the photo first entered the gallery, in UTC (`2026-10-23T19:30:00Z`):
   * the first run that wrote its manifest. Kept when the photo is encoded
   * again, its sidecar changes, or the same file comes back under another
   * name. Optional only so manifests from older pipelines still load.
   */
  added: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    .optional(),
  title: z.string(),
  /** Raw markdown. */
  caption: z.string().nullable(),
  date: LocalDate,
  /** UTC offset of `date`, present only when EXIF OffsetTimeOriginal records it. */
  tz: UtcOffset.optional(),
  dateSource: DateSource,
  camera: z.string().nullable(),
  lens: z.string().nullable(),
  exposure: Exposure,
  gps: Gps.nullable(),
  place: Place.nullable(),
  /** Display string such as “Kyoto, Japan”, or null. */
  placeLabel: z.string().nullable(),
  keywords: z.array(z.string()),
  /** 1 to 5 stars; null when unrated (XMP Rating 0) or rejected. */
  rating: z.number().int().min(1).max(5).nullable(),
  copyright: z.string().nullable(),
  author: z.string().nullable(),
  hidden: z.boolean(),
  /** Display dimensions, after orientation is applied. */
  width: z.number().int(),
  height: z.number().int(),
  color: Oklch,
  thumbhash: z.string(),
  placeholder: z.string(),
  variants: z.array(Variant),
  original: z.object({
    bytes: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
    /** Relative to the gallery directory, e.g. `photos/feelings/Greenport.jpg`. */
    relativePath: z.string(),
    /** ICC profile description of the source, or null when untagged. */
    icc: z.string().nullable(),
    /** Present when the config publishes originals (`originals: 'repo' | 'bucket'`). */
    key: z.string().optional(),
    url: z.string().optional(),
  }),
  facets: PhotoFacets,
  sourceHash: z.string(),
  sourceSize: z.number().int(),
  sourceMtime: z.number(),
  /** Hash of the sidecar inputs (.md/.json/.xmp and the album’s per-photo entry). */
  inputsHash: z.string(),
  pipelineVersion: z.string(),
  /** Hash of everything that shapes the derivatives: ladder, colour space, encoder version. */
  ladderHash: z.string(),
  /** Hash of every other field. Used as the Astro entry digest and page cacheKey. */
  digest: z.string(),
});
export type PhotoManifest = z.infer<typeof PhotoManifest>;
export type PhotoFacets = z.infer<typeof PhotoFacets>;
export type Place = z.infer<typeof Place>;
export type FacetRef = z.infer<typeof FacetRef>;
export type FocalBucket = z.infer<typeof FocalBucket>;

/** `date`: newest first, undated last. `name`: file name. `manual`: `order[]`, then by date. */
export const AlbumSort = z.enum(['date', 'name', 'manual']);
export type AlbumSort = z.infer<typeof AlbumSort>;

export const AlbumManifest = z.object({
  id: z.string(),
  /** Folder path relative to `photos/`, with `/` separators. */
  path: z.string(),
  parent: z.string().nullable(),
  title: z.string(),
  /** Raw markdown, from the `_album.md` body. */
  description: z.string().nullable(),
  /** Photo id of the cover. */
  cover: z.string().nullable(),
  sort: AlbumSort,
  order: z.array(z.string()),
  hidden: z.boolean(),
  date: LocalDate.nullable(),
  /** Oldest and newest capture date, over dated photos only. */
  dateRange: z.tuple([LocalDate, LocalDate]).nullable(),
  /** Photo ids in display order. */
  photoIds: z.array(z.string()),
  children: z.array(z.string()),
  digest: z.string(),
});
export type AlbumManifest = z.infer<typeof AlbumManifest>;

export const AlbumsFile = z.object({
  pipelineVersion: z.string(),
  albums: z.array(AlbumManifest),
});
export type AlbumsFile = z.infer<typeof AlbumsFile>;

/** Fields a sidecar, `_album.md` per-photo map or XMP layer may set. */
export const PhotoOverrides = z
  .object({
    title: z.string(),
    caption: z.string(),
    date: z.union([z.string(), z.date()]),
    camera: z.string(),
    lens: z.string(),
    keywords: z.union([z.array(z.string()), z.string()]),
    /** 0 means unrated. */
    rating: z.number(),
    copyright: z.string(),
    author: z.string(),
    hidden: z.boolean(),
    place: Place.partial(),
    gps: Gps,
  })
  .partial();
export type PhotoOverrides = z.infer<typeof PhotoOverrides>;

export const AlbumFrontmatter = z
  .object({
    title: z.string(),
    cover: z.string(),
    sort: AlbumSort,
    order: z.array(z.string()),
    hidden: z.boolean(),
    date: z.union([z.string(), z.date()]),
    photos: z.record(z.string(), PhotoOverrides),
  })
  .partial();
export type AlbumFrontmatter = z.infer<typeof AlbumFrontmatter>;
