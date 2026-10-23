/**
 * Facet keys and sorting, shared by the pipeline (which stores the keys in
 * each manifest) and the Astro side (which builds facet pages from them).
 *
 * Facet slugs use `-` (`/camera/nikon-d70/`), unlike photo ids, which keep the
 * v0.8 `_` convention from `./slug`.
 */
import type {
  AlbumSort,
  FacetRef,
  FocalBucket,
  PhotoFacets,
  PhotoManifest,
  Place,
} from './schema.ts';

/** Letters that Unicode decomposition does not reduce to ASCII. */
const FOLD: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/**
 * Slug for a facet value in a URL: lowercase; Latin accents removed
 * (`Café` to `cafe`); every run of characters that are not letters or digits
 * becomes one `-`; no leading or trailing `-`. Letters outside the Latin
 * alphabet are kept as they are (`東京` stays `東京`), so a keyword never
 * slugs to an empty string unless it has no letters or digits at all.
 *
 * `facetSlug('NIKON D70')` is `nikon-d70`; `facetSlug('Kyoto, Japan')` is
 * `kyoto-japan`; `facetSlug('1/60')` is `1-60`.
 */
export function facetSlug(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFC').toLowerCase()) {
    if (FOLD[ch]) {
      out += FOLD[ch];
      continue;
    }
    const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
    // Only fold when the result is ASCII, so kana with voicing marks and
    // other scripts keep their own characters.
    out += /^[\x20-\x7e]+$/.test(base) ? base : ch;
  }
  return out.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/** A facet value with its slug, or null when the label is empty or slugs to nothing. */
export function facetRef(label: string | null | undefined): FacetRef | null {
  const l = label?.trim();
  if (!l) return null;
  const slug = facetSlug(l);
  return slug ? { slug, label: l } : null;
}

/** URL key of an aperture: `1.4`, `8`, `5.6`. One decimal at most. */
export function apertureKey(aperture: number): string {
  return String(Math.round(aperture * 10) / 10);
}

/** Display label of an aperture: `f/1.4`. */
export function apertureLabel(aperture: number): string {
  return `f/${apertureKey(aperture)}`;
}

/** URL key of a focal length in mm: `50`. */
export function focalKey(focal: number): string {
  return String(Math.round(focal));
}

/** URL key of a shutter speed in seconds: `1-60`, `2-5`. */
export function shutterKey(label: string): string {
  return facetSlug(label);
}

export const FOCAL_BUCKETS: ReadonlyArray<{
  key: FocalBucket;
  label: string;
  /** Inclusive upper bound in 35 mm equivalent mm; the last bucket has none. */
  max: number;
}> = [
  { key: 'wide', label: 'Wide', max: 24 },
  { key: 'normal', label: 'Normal', max: 50 },
  { key: 'short-tele', label: 'Short telephoto', max: 105 },
  { key: 'tele', label: 'Telephoto', max: Infinity },
];

/**
 * Focal bucket on the 35 mm equivalent when known, else on the recorded
 * focal length: `wide` up to 24, `normal` 25 to 50, `short-tele` 51 to 105,
 * `tele` over 105. Lengths are rounded to the nearest mm first.
 */
export function focalBucket(
  focal: number | null | undefined,
  focal35?: number | null
): FocalBucket | null {
  const f = focal35 && focal35 > 0 ? focal35 : focal;
  if (!f || !(f > 0)) return null;
  const mm = Math.round(f);
  return FOCAL_BUCKETS.find((b) => mm <= b.max)!.key;
}

/**
 * Display string for a place: the most specific of city, state and
 * sub-location, then the country. `{ city: 'Kyoto', country: 'Japan' }` gives
 * “Kyoto, Japan”.
 */
export function placeLabel(place: Place | null | undefined): string | null {
  if (!place) return null;
  const local = place.city ?? place.state ?? place.location;
  const parts = [local, place.country].filter(
    (p): p is string => !!p && p.trim() !== ''
  );
  if (parts.length === 2 && parts[0] === parts[1]) parts.pop();
  return parts.length ? parts.join(', ') : null;
}

/** True when the photo has a real capture date (not the file’s mtime). */
export function isDated(photo: Pick<PhotoManifest, 'dateSource'>): boolean {
  return photo.dateSource !== 'mtime';
}

type FacetInput = Pick<
  PhotoManifest,
  | 'date'
  | 'dateSource'
  | 'camera'
  | 'lens'
  | 'exposure'
  | 'keywords'
  | 'placeLabel'
>;

/** Facet keys for one photo. Date keys are null when the photo is undated. */
export function photoFacets(p: FacetInput): PhotoFacets {
  const dated = isDated(p);
  const [y, m, d] = p.date.slice(0, 10).split('-');
  const e = p.exposure;
  const keywords: FacetRef[] = [];
  const seen = new Set<string>();
  for (const k of p.keywords) {
    const ref = facetRef(k);
    if (ref && !seen.has(ref.slug)) {
      seen.add(ref.slug);
      keywords.push(ref);
    }
  }
  return {
    year: dated ? y : null,
    month: dated ? m : null,
    day: dated ? `${m}-${d}` : null,
    camera: facetRef(p.camera),
    lens: facetRef(p.lens),
    aperture:
      e.aperture && e.aperture > 0 ? Number(apertureKey(e.aperture)) : null,
    shutter:
      e.shutterSeconds && e.shutter
        ? { seconds: e.shutterSeconds, label: e.shutter }
        : null,
    iso: e.iso && e.iso > 0 ? e.iso : null,
    focal: e.focal && e.focal > 0 ? Math.round(e.focal * 10) / 10 : null,
    focalBucket: focalBucket(e.focal, e.focal35),
    keywords,
    place: facetRef(p.placeLabel),
  };
}

/** The fields `sortPhotos` reads. */
export type SortablePhoto = Pick<
  PhotoManifest,
  'id' | 'date' | 'dateSource' | 'file' | 'slug'
>;

const byName = (a: SortablePhoto, b: SortablePhoto) =>
  a.file.localeCompare(b.file, undefined, { numeric: true }) ||
  a.id.localeCompare(b.id);

/**
 * Newest first, undated photos last. Photos taken in the same second keep
 * file-name order reversed (so `DSC_0413` comes before `DSC_0412`, like the
 * rest of the list); undated photos are in file-name order.
 */
export function compareNewestFirst(a: SortablePhoto, b: SortablePhoto): number {
  const da = isDated(a);
  const db = isDated(b);
  if (da !== db) return da ? -1 : 1;
  if (!da) return byName(a, b);
  return b.date.localeCompare(a.date) || byName(b, a);
}

/**
 * Sort photos for an album or any other context. Returns a new array.
 *
 * - `date`: newest first, undated photos (`dateSource: 'mtime'`) last.
 * - `name`: by file name, numbers compared as numbers (`2` before `10`).
 * - `manual`: photos named in `order` first, in that order (an entry matches
 *   the file name, the file name without extension, or the slug); the rest
 *   follow by date as above.
 */
export function sortPhotos<T extends SortablePhoto>(
  photos: readonly T[],
  mode: AlbumSort = 'date',
  order: readonly string[] = []
): T[] {
  const list = [...photos];
  if (mode === 'name') return list.sort(byName);
  if (mode === 'manual') {
    const rank = new Map<string, number>();
    order.forEach((o, i) => {
      if (!rank.has(o)) rank.set(o, i);
    });
    const rankOf = (p: T) => {
      const noExt = p.file.replace(/\.[^.]+$/, '');
      return (
        rank.get(p.file) ?? rank.get(noExt) ?? rank.get(p.slug) ?? Infinity
      );
    };
    return list.sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra < rb ? -1 : 1;
      return compareNewestFirst(a, b);
    });
  }
  return list.sort(compareNewestFirst);
}
