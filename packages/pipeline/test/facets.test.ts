import { describe, expect, it } from 'vitest';
import {
  apertureKey,
  facetSlug,
  focalBucket,
  photoFacets,
  placeLabel,
  sortPhotos,
  type SortablePhoto,
} from '../src/facets.ts';
import { workerPlan } from '../src/process.ts';

describe('facetSlug', () => {
  it('lowercases, folds Latin accents and joins words with -', () => {
    expect(facetSlug('NIKON D70')).toBe('nikon-d70');
    expect(facetSlug('Nikon D200')).toBe('nikon-d200');
    expect(facetSlug('Kyoto, Japan')).toBe('kyoto-japan');
    expect(facetSlug('Café au lait!')).toBe('cafe-au-lait');
    expect(facetSlug('Straße')).toBe('strasse');
    expect(facetSlug('18-70mm f/3.5-4.5')).toBe('18-70mm-f-3-5-4-5');
    expect(facetSlug('1/60')).toBe('1-60');
    expect(facetSlug('  --  ')).toBe('');
  });

  it('keeps letters outside the Latin alphabet', () => {
    expect(facetSlug('東京')).toBe('東京');
    expect(facetSlug('がっこう')).toBe('がっこう');
    expect(facetSlug('Москва 2024')).toBe('москва-2024');
  });

  it('formats aperture keys with one decimal at most', () => {
    expect(apertureKey(1.4)).toBe('1.4');
    expect(apertureKey(8)).toBe('8');
    expect(apertureKey(5.6000001)).toBe('5.6');
  });
});

describe('focal buckets', () => {
  it('uses the stated boundaries', () => {
    expect(focalBucket(10)).toBe('wide');
    expect(focalBucket(24)).toBe('wide');
    expect(focalBucket(25)).toBe('normal');
    expect(focalBucket(50)).toBe('normal');
    expect(focalBucket(51)).toBe('short-tele');
    expect(focalBucket(105)).toBe('short-tele');
    expect(focalBucket(106)).toBe('tele');
    expect(focalBucket(null)).toBe(null);
    expect(focalBucket(0)).toBe(null);
  });

  it('prefers the 35 mm equivalent', () => {
    // 50 mm on a Nikon D70 (1.5x crop) is 75 mm equivalent.
    expect(focalBucket(50, 75)).toBe('short-tele');
    expect(focalBucket(18, 27)).toBe('normal');
    expect(focalBucket(18, null)).toBe('wide');
  });
});

describe('placeLabel', () => {
  it('uses the most specific name, then the country', () => {
    const p = { city: null, state: null, country: null, location: null };
    expect(placeLabel({ ...p, city: 'Kyoto', country: 'Japan' })).toBe(
      'Kyoto, Japan'
    );
    expect(placeLabel({ ...p, state: 'Hokkaido', country: 'Japan' })).toBe(
      'Hokkaido, Japan'
    );
    expect(placeLabel({ ...p, country: 'Japan' })).toBe('Japan');
    expect(placeLabel({ ...p, city: 'Singapore', country: 'Singapore' })).toBe(
      'Singapore'
    );
    expect(placeLabel(p)).toBe(null);
  });
});

describe('photoFacets', () => {
  const base = {
    date: '2005-02-27T18:16:10',
    dateSource: 'exif' as const,
    camera: 'Nikon D70',
    lens: '18-70mm f/3.5-4.5',
    exposure: {
      shutter: '1/60',
      shutterSeconds: 1 / 60,
      aperture: 5.6,
      focal: 50,
      focal35: 75,
      iso: 200,
      ev: null,
      metering: null,
      flash: null,
    },
    keywords: ['Bamboo', 'bamboo!', 'Forest'],
    placeLabel: 'Kyoto, Japan',
  };

  it('precomputes every facet key', () => {
    expect(photoFacets(base)).toEqual({
      year: '2005',
      month: '02',
      day: '02-27',
      camera: { slug: 'nikon-d70', label: 'Nikon D70' },
      lens: { slug: '18-70mm-f-3-5-4-5', label: '18-70mm f/3.5-4.5' },
      aperture: 5.6,
      shutter: { seconds: 1 / 60, label: '1/60' },
      iso: 200,
      focal: 50,
      focalBucket: 'short-tele',
      keywords: [
        { slug: 'bamboo', label: 'Bamboo' },
        { slug: 'forest', label: 'Forest' },
      ],
      place: { slug: 'kyoto-japan', label: 'Kyoto, Japan' },
    });
  });

  it('leaves date keys empty for undated photos', () => {
    expect(photoFacets({ ...base, dateSource: 'mtime' })).toMatchObject({
      year: null,
      month: null,
      day: null,
    });
  });
});

describe('sortPhotos', () => {
  const p = (
    file: string,
    date: string,
    dateSource: SortablePhoto['dateSource'] = 'exif'
  ): SortablePhoto => ({
    id: `a__${file}`,
    file: `${file}.jpg`,
    slug: file,
    date,
    dateSource,
  });
  const photos = [
    p('old', '2001-01-01T00:00:00'),
    p('undated_b', '2030-01-01T00:00:00', 'mtime'),
    p('new', '2020-06-01T00:00:00'),
    p('undated_a', '2029-01-01T00:00:00', 'mtime'),
    p('dsc_2', '2010-01-01T00:00:00'),
    p('dsc_10', '2010-01-01T00:00:00'),
  ];
  const ids = (list: SortablePhoto[]) => list.map((x) => x.slug);

  it('sorts newest first with undated photos last', () => {
    expect(ids(sortPhotos(photos, 'date'))).toEqual([
      'new',
      'dsc_10',
      'dsc_2',
      'old',
      'undated_a',
      'undated_b',
    ]);
  });

  it('sorts by name with numbers compared as numbers', () => {
    expect(ids(sortPhotos(photos, 'name'))).toEqual([
      'dsc_2',
      'dsc_10',
      'new',
      'old',
      'undated_a',
      'undated_b',
    ]);
  });

  it('puts manual order first, then the rest by date', () => {
    expect(ids(sortPhotos(photos, 'manual', ['undated_b.jpg', 'old']))).toEqual(
      ['undated_b', 'old', 'new', 'dsc_10', 'dsc_2', 'undated_a']
    );
  });

  it('does not change the input', () => {
    const copy = [...photos];
    sortPhotos(photos, 'date');
    expect(photos).toEqual(copy);
  });
});

describe('workerPlan', () => {
  it('sizes workers and threads to the batch', () => {
    expect(workerPlan(10, 241)).toEqual({ workers: 10, threadsPerWorker: 1 });
    expect(workerPlan(10, 3)).toEqual({ workers: 3, threadsPerWorker: 3 });
    expect(workerPlan(10, 1)).toEqual({ workers: 1, threadsPerWorker: 10 });
    expect(workerPlan(10, 0)).toEqual({ workers: 1, threadsPerWorker: 10 });
  });

  it('honours overrides', () => {
    expect(workerPlan(10, 241, { concurrency: 4 })).toEqual({
      workers: 4,
      threadsPerWorker: 2,
    });
    expect(workerPlan(10, 241, { threadsPerWorker: 3 })).toEqual({
      workers: 10,
      threadsPerWorker: 3,
    });
  });
});
