/**
 * Facets: every metadata value is a context with its own page. This file
 * defines them (route segment, palette heading, value order) and the display
 * formatting of their labels. Slugs come from the pipeline (each manifest's
 * `facets`, built with `@minimalgallery/pipeline/facets`). Pure functions,
 * no Astro imports, so the loader and the pages can both use it.
 */
import { FOCAL_BUCKETS } from '@minimalgallery/pipeline/facets';

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type FacetKey =
  | 'year'
  | 'month'
  | 'day'
  | 'place'
  | 'camera'
  | 'lens'
  | 'focal'
  | 'aperture'
  | 'shutter'
  | 'iso'
  | 'keyword';

/** One value of a facet on one photo. `order` sorts the facet's values. */
export interface FacetValue {
  slug: string;
  label: string;
  order: number | string;
}

export interface FacetDef {
  key: FacetKey;
  /** First URL segment: `/camera/nikon-d70/`. */
  route: string;
  /** Heading of the facet's group in the filter palette. */
  heading: string;
  /** Newest or largest first instead of ascending. */
  descending?: boolean;
  /** Shown as a chip group in the palette. */
  palette: boolean;
}

/**
 * Palette order follows the prototype: years, months, places, then the
 * gear and exposure values, then keywords. Days across years have pages
 * (linked from the info pane's date) but no palette group: minimalgallery.net has 88.
 */
export const FACETS: FacetDef[] = [
  {
    key: 'year',
    route: 'year',
    heading: 'Years',
    descending: true,
    palette: true,
  },
  { key: 'month', route: 'month', heading: 'Months, any year', palette: true },
  { key: 'day', route: 'on', heading: 'Days, any year', palette: false },
  { key: 'place', route: 'place', heading: 'Places', palette: true },
  { key: 'camera', route: 'camera', heading: 'Cameras', palette: true },
  { key: 'lens', route: 'lens', heading: 'Lenses', palette: true },
  { key: 'focal', route: 'focal', heading: 'Focal length', palette: true },
  { key: 'aperture', route: 'aperture', heading: 'Aperture', palette: true },
  {
    key: 'shutter',
    route: 'shutter',
    heading: 'Shutter speed',
    palette: true,
  },
  { key: 'iso', route: 'iso', heading: 'ISO', palette: true },
  { key: 'keyword', route: 'keyword', heading: 'Keywords', palette: true },
];

export const FACET_BY_KEY = new Map(FACETS.map((f) => [f.key, f]));

/** First URL segments a top-level album may not use. */
export const RESERVED_SEGMENTS = new Set([
  ...FACETS.map((f) => f.route),
  'grid',
  'legacy-ids',
  // /feed.json is the JSON feed and /random/ the random page
  'feed',
  'random',
  '_astro',
  '_mg',
]);

export type FocalBucket = (typeof FOCAL_BUCKETS)[number]['key'];
/** Bucket keys in palette order, from the pipeline's buckets. */
export const FOCAL_ORDER: FocalBucket[] = FOCAL_BUCKETS.map((b) => b.key);
/** `Wide, up to 24 mm`: the pipeline's label with its range. */
export const FOCAL_LABELS = Object.fromEntries(
  FOCAL_BUCKETS.map((b, i) => {
    const min = i ? FOCAL_BUCKETS[i - 1].max + 1 : 0;
    const range =
      b.max === Infinity
        ? `over ${min - 1} mm`
        : min
          ? `${min} to ${b.max} mm`
          : `up to ${b.max} mm`;
    return [b.key, `${b.label}, ${range}`];
  })
) as Record<FocalBucket, string>;

/** Trim a number for display: 4.0 is `4`, 2.80 is `2.8`. */
export const trimNumber = (n: number) => String(+n.toFixed(1));

/** `80.0-200.0 mm f/2.8` to `80–200 mm f/2.8`, as the prototype wrote lenses. */
export const lensLabel = (lens: string) =>
  lens
    .replace(/(\d)\.0\b/g, '$1')
    .replace(/(\d)\s*-\s*(\d)/g, '$1–$2')
    .replace(/(\d)mm\b/g, '$1 mm')
    .replace(/\s+/g, ' ')
    .trim();

export const monthLabel = (mm: string) => MONTHS[Number(mm) - 1];
/** `02-27` to `February 27`. */
export const dayLabel = (mmdd: string) =>
  `${monthLabel(mmdd.slice(0, 2))} ${Number(mmdd.slice(3, 5))}`;

/** Facet values in palette order. */
export function compareValues(def: FacetDef, a: FacetValue, b: FacetValue) {
  const d =
    typeof a.order === 'number' && typeof b.order === 'number'
      ? a.order - b.order
      : String(a.order).localeCompare(String(b.order));
  return def.descending ? -d : d;
}
