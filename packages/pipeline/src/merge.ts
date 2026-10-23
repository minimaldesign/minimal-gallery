import { placeLabel } from './facets.ts';
import type { Layer, LayerName } from './layers.ts';
import type { PhotoManifest } from './schema.ts';

export interface MergeInput {
  /** Highest precedence first. */
  layers: Array<[LayerName, Layer]>;
  /** Extra date candidates used after every layer, before mtime. */
  dateFallbacks: Array<[PhotoManifest['dateSource'], string | undefined]>;
  mtimeDate: string;
  /**
   * EXIF DateTimeOriginal with its OffsetTimeOriginal. The offset is stored
   * as `tz` only when the merged date is that same wall-clock time, so an
   * edited date never inherits the camera’s offset.
   */
  exifOffset?: { date: string; offset: string };
}

export type MergedMetadata = Pick<
  PhotoManifest,
  | 'title'
  | 'caption'
  | 'date'
  | 'tz'
  | 'dateSource'
  | 'camera'
  | 'lens'
  | 'exposure'
  | 'gps'
  | 'place'
  | 'placeLabel'
  | 'keywords'
  | 'rating'
  | 'copyright'
  | 'author'
  | 'hidden'
>;

const DATE_SOURCE: Record<LayerName, PhotoManifest['dateSource']> = {
  sidecar: 'sidecar',
  album: 'album',
  'xmp-sidecar': 'xmp',
  xmp: 'xmp',
  iptc: 'iptc',
  exif: 'exif',
  filename: 'mtime',
};

const isSet = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  !(typeof v === 'string' && v.trim() === '') &&
  !(Array.isArray(v) && v.length === 0);

/**
 * Field-by-field merge: for each field, the first layer that sets it wins.
 * `place` and `exposure` merge per sub-field, so a sidecar can set only the
 * city and keep the country from IPTC. A rating of 0 (unrated) in the first
 * layer that sets one is stored as null.
 */
export function mergeLayers({
  layers,
  dateFallbacks,
  mtimeDate,
  exifOffset,
}: MergeInput): MergedMetadata {
  const first = <K extends keyof Layer>(k: K): Layer[K] | undefined => {
    for (const [, l] of layers) if (isSet(l[k])) return l[k];
    return undefined;
  };
  let date: string | undefined;
  let dateSource: PhotoManifest['dateSource'] = 'mtime';
  for (const [name, l] of layers) {
    if (isSet(l.date)) {
      date = l.date;
      dateSource = DATE_SOURCE[name];
      break;
    }
  }
  if (!date) {
    for (const [src, d] of dateFallbacks) {
      if (d) {
        date = d;
        dateSource = src;
        break;
      }
    }
  }
  if (!date) {
    date = mtimeDate;
    dateSource = 'mtime';
  }
  const sub = <T extends 'place' | 'exposure'>(k: T, key: string) => {
    for (const [, l] of layers) {
      const v = (l[k] as Record<string, unknown> | undefined)?.[key];
      if (isSet(v)) return v;
    }
    return null;
  };
  const placeRaw = {
    city: sub('place', 'city') as string | null,
    state: sub('place', 'state') as string | null,
    country: sub('place', 'country') as string | null,
    location: sub('place', 'location') as string | null,
  };
  const place = Object.values(placeRaw).some((v) => v !== null)
    ? placeRaw
    : null;
  const rating = first('rating');
  const tz =
    exifOffset && dateSource !== 'mtime' && exifOffset.date === date
      ? exifOffset.offset
      : undefined;
  return {
    title: (first('title') as string) ?? '',
    caption: (first('caption') as string) ?? null,
    date,
    ...(tz ? { tz } : {}),
    dateSource,
    camera: (first('camera') as string) ?? null,
    lens: (first('lens') as string) ?? null,
    exposure: {
      shutter: sub('exposure', 'shutter') as string | null,
      shutterSeconds: sub('exposure', 'shutterSeconds') as number | null,
      aperture: sub('exposure', 'aperture') as number | null,
      focal: sub('exposure', 'focal') as number | null,
      focal35: sub('exposure', 'focal35') as number | null,
      iso: sub('exposure', 'iso') as number | null,
      ev: sub('exposure', 'ev') as number | null,
      metering: sub('exposure', 'metering') as string | null,
      flash: sub('exposure', 'flash') as boolean | null,
    },
    gps: first('gps') ?? null,
    place,
    placeLabel: placeLabel(place),
    keywords: first('keywords') ?? [],
    rating: rating && rating >= 1 ? Math.min(5, Math.round(rating)) : null,
    copyright: first('copyright') ?? null,
    author: first('author') ?? null,
    hidden: first('hidden') ?? false,
  };
}
