/**
 * Manifest adapter: turns one manifest written by `@minimalgallery/pipeline`
 * into the photo record the theme renders. Facet slugs and labels come from
 * the manifest's `facets` (built by the pipeline's `photoFacets`); this file
 * only adds display formatting and each value's palette order.
 */
import {
  apertureKey,
  apertureLabel,
  isDated,
  shutterKey,
} from '@minimalgallery/pipeline/facets';
import type { PhotoManifest } from '@minimalgallery/pipeline/schema';
import {
  dayLabel,
  FOCAL_LABELS,
  FOCAL_ORDER,
  lensLabel,
  monthLabel,
  trimNumber,
  type FacetKey,
  type FacetValue,
} from './facets.ts';

/** Bump when the derivation below changes, so cached entries are rebuilt. */
export const ADAPTER_VERSION = '3';

export interface Variant {
  name: string;
  width: number;
  height: number;
  format: string;
  url: string;
  /** File size, for feed enclosures. */
  bytes: number;
}

export interface PhotoRecord {
  id: string;
  album: string;
  slug: string;
  file: string;
  title: string;
  /** Raw markdown caption. */
  caption: string | null;
  /** Wall-clock capture time, `YYYY-MM-DDTHH:MM:SS`; null when undated. */
  date: string | null;
  dateSource: PhotoManifest['dateSource'];
  camera: string | null;
  lens: string | null;
  shutter: string | null;
  aperture: string | null;
  focal: string | null;
  iso: string | null;
  /** The place facet's label (`Kyoto, Japan`). */
  place: string | null;
  /** Detail shown before the place in the info pane (the sublocation). */
  placeDetail: string | null;
  keywords: string[];
  width: number;
  height: number;
  /** Dominant color as a CSS oklch() string. */
  color: string;
  placeholder: string | null;
  variants: Variant[];
  /** Path of the original inside the gallery, for the info pane's File row. */
  source: string;
  hidden: boolean;
  facets: Partial<Record<FacetKey, FacetValue[]>>;
  /** List sort keys: title, date, place, camera, lens, shutter, aperture, focal, iso. */
  sortKeys: Array<string | number>;
  digest: string;
}

const colorOf = ({ l, c, h }: PhotoManifest['color']) =>
  `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${(h || 0).toFixed(1)})`;

export function adaptPhoto(m: PhotoManifest): PhotoRecord {
  const f = m.facets;
  const e = m.exposure;
  const date = isDated(m) ? m.date.slice(0, 19) : null;
  const lens = f.lens ? lensLabel(f.lens.label) : null;
  const shutter = f.shutter ? `${f.shutter.label} s` : null;
  const aperture = f.aperture != null ? apertureLabel(f.aperture) : null;
  const focal = e.focal ? `${trimNumber(e.focal)} mm` : null;
  const iso = f.iso != null ? String(f.iso) : null;
  const place = f.place?.label ?? null;
  const detail = m.place?.location ?? null;

  const one = (
    slug: string | null | undefined,
    label: string | null | undefined,
    order: number | string
  ): FacetValue[] | undefined =>
    slug && label ? [{ slug, label, order }] : undefined;
  const facets: PhotoRecord['facets'] = {
    year: one(f.year, f.year, Number(f.year)),
    month: one(f.month, f.month && monthLabel(f.month), Number(f.month)),
    day: one(f.day, f.day && dayLabel(f.day), f.day ?? ''),
    place: one(f.place?.slug, place, place?.toLowerCase() ?? ''),
    camera: one(
      f.camera?.slug,
      f.camera?.label,
      f.camera?.label.toLowerCase() ?? ''
    ),
    lens: one(f.lens?.slug, lens, lensOrder(e.focal, lens)),
    focal: one(
      f.focalBucket,
      f.focalBucket && FOCAL_LABELS[f.focalBucket],
      f.focalBucket ? FOCAL_ORDER.indexOf(f.focalBucket) : 0
    ),
    aperture: one(
      f.aperture != null ? apertureKey(f.aperture) : null,
      aperture,
      f.aperture ?? 0
    ),
    shutter: one(
      f.shutter && shutterKey(f.shutter.label),
      shutter,
      f.shutter?.seconds ?? 0
    ),
    iso: one(iso, iso && `ISO ${iso}`, f.iso ?? 0),
    keyword: f.keywords.length
      ? f.keywords.map((k) => ({ ...k, order: k.label.toLowerCase() }))
      : undefined,
  };
  for (const k of Object.keys(facets) as FacetKey[])
    if (!facets[k]) delete facets[k];

  return {
    id: m.id,
    album: m.album,
    slug: m.slug,
    file: m.file,
    title: m.title,
    caption: m.caption,
    date,
    dateSource: m.dateSource,
    camera: f.camera?.label ?? null,
    lens,
    shutter,
    aperture,
    focal,
    iso,
    place,
    placeDetail: place && detail && !place.startsWith(detail) ? detail : null,
    keywords: f.keywords.map((k) => k.label),
    width: m.width,
    height: m.height,
    color: colorOf(m.color),
    placeholder: m.placeholder || null,
    variants: m.variants.map(({ name, width, height, format, url, bytes }) => ({
      name,
      width,
      height,
      format,
      url,
      bytes,
    })),
    source: m.source,
    hidden: m.hidden,
    facets,
    sortKeys: [
      m.title.toLowerCase(),
      date ?? '',
      place?.toLowerCase() ?? '',
      f.camera?.label.toLowerCase() ?? '',
      lens?.toLowerCase() ?? '',
      f.shutter ? +f.shutter.seconds.toPrecision(6) : '',
      f.aperture ?? '',
      e.focal ?? '',
      f.iso ?? '',
    ],
    digest: `${m.digest}.${ADAPTER_VERSION}`,
  };
}

/** Lenses sort by focal length, then by name. */
function lensOrder(focal: number | null, lens: string | null) {
  const mm = lens?.match(/\d+(\.\d+)?/)?.[0] ?? focal ?? 9999;
  return `${String(Math.round(+mm)).padStart(5, '0')} ${lens?.toLowerCase() ?? ''}`;
}
