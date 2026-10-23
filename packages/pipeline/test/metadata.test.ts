import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Layer, LayerName } from '../src/layers.ts';
import { mergeLayers } from '../src/merge.ts';
import {
  parseExifDate,
  parseIptcDate,
  parseIsoLikeDate,
  parseOffset,
  parseUserDate,
} from '../src/normalize.ts';
import { processGallery } from '../src/process.ts';
import { xmpToLayer } from '../src/xmp.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';

const merge = (
  layers: Array<[LayerName, Layer]>,
  extra: Partial<Parameters<typeof mergeLayers>[0]> = {}
) =>
  mergeLayers({
    layers,
    dateFallbacks: [],
    mtimeDate: '2026-10-22T12:00:00',
    ...extra,
  });

const xmp = (attrs: string, body = '') => `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xap="http://ns.adobe.com/xap/1.0/"
    xmlns:ps="http://ns.adobe.com/photoshop/1.0/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    ${attrs}>${body}</rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

describe('rating', () => {
  it('stores XMP Rating 0 (unrated) and -1 (rejected) as null', () => {
    expect(xmpToLayer(xmp('xap:Rating="0"')).rating).toBe(0);
    expect(merge([['xmp', xmpToLayer(xmp('xap:Rating="0"'))]]).rating).toBe(
      null
    );
    expect(merge([['xmp', xmpToLayer(xmp('xap:Rating="-1"'))]]).rating).toBe(
      null
    );
    expect(merge([['xmp', xmpToLayer(xmp('xap:Rating="3"'))]]).rating).toBe(3);
  });

  it('lets an unrated sidecar override a stale embedded rating', () => {
    expect(
      merge([
        ['xmp-sidecar', { rating: 0 }],
        ['xmp', { rating: 4 }],
      ]).rating
    ).toBe(null);
  });
});

describe('dates and offsets', () => {
  it('keeps the wall-clock time and drops offsets when parsing', () => {
    expect(parseExifDate('2005:02:27 18:16:10')).toBe('2005-02-27T18:16:10');
    expect(parseExifDate('0000:00:00 00:00:00')).toBe(undefined);
    expect(parseIsoLikeDate('2005-02-27T18:16:10.25-05:00')).toBe(
      '2005-02-27T18:16:10'
    );
    expect(parseIsoLikeDate('2005-02-27T18:16Z')).toBe('2005-02-27T18:16:00');
    expect(parseIptcDate('20050201', '163846-0500')).toBe(
      '2005-02-01T16:38:46'
    );
    expect(parseUserDate('2020-01-02 10:00+02:00')).toBe('2020-01-02T10:00:00');
    expect(parseOffset('+09:00')).toBe('+09:00');
    expect(parseOffset('-0530')).toBe('-05:30');
    expect(parseOffset('Z')).toBe('+00:00');
    expect(parseOffset('nonsense')).toBe(undefined);
  });

  it('ignores the offset in an XMP date written by the editing computer', () => {
    const layer = xmpToLayer(
      xmp('exif:DateTimeOriginal="2024-04-05T10:11:12+02:00"')
    );
    expect(layer.date).toBe('2024-04-05T10:11:12');
    const m = merge([['xmp', layer]]);
    expect(m.date).toBe('2024-04-05T10:11:12');
    expect(m.tz).toBeUndefined();
  });

  it('keeps EXIF OffsetTimeOriginal only for the camera’s own timestamp', () => {
    const exifOffset = { date: '2024-04-05T10:11:12', offset: '+09:00' };
    const same = merge(
      [
        ['xmp', { date: '2024-04-05T10:11:12' }],
        ['exif', { date: '2024-04-05T10:11:12' }],
      ],
      { exifOffset }
    );
    expect(same).toMatchObject({ date: '2024-04-05T10:11:12', tz: '+09:00' });
    const edited = merge(
      [
        ['sidecar', { date: '2024-04-06T08:00:00' }],
        ['exif', { date: '2024-04-05T10:11:12' }],
      ],
      { exifOffset }
    );
    expect(edited.date).toBe('2024-04-06T08:00:00');
    expect(edited.tz).toBeUndefined();
  });

  it('writes tz end to end and marks mtime dates', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/tokyo.jpg'), {
      date: '2024:04:05 10:11:12',
      exif: { OffsetTimeOriginal: '+09:00' },
    });
    await writeJpeg(join(dir, 'photos/a/nodate.jpg'), { date: null });
    await processGallery(dir, { concurrency: 2 });
    const read = async (id: string) =>
      JSON.parse(
        await readFile(
          join(dir, '.minimalgallery/manifest', `${id}.json`),
          'utf8'
        )
      );
    const tokyo = await read('a__tokyo');
    expect(tokyo.date).toBe('2024-04-05T10:11:12');
    expect(tokyo.tz).toBe('+09:00');
    expect(tokyo.facets).toMatchObject({
      year: '2024',
      month: '04',
      day: '04-05',
    });
    const nodate = await read('a__nodate');
    expect(nodate.dateSource).toBe('mtime');
    expect(nodate.tz).toBeUndefined();
    expect(nodate.facets).toMatchObject({ year: null, month: null, day: null });
    expect(nodate).not.toHaveProperty('histogram');
    const albums = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/_albums.json'), 'utf8')
    );
    expect(albums.albums[0].photoIds).toEqual(['a__tokyo', 'a__nodate']);
    expect(albums.albums[0].dateRange).toEqual([
      '2024-04-05T10:11:12',
      '2024-04-05T10:11:12',
    ]);
  });
});

describe('place', () => {
  it('reads city, state, country and sub-location from XMP', () => {
    const layer = xmpToLayer(
      xmp(
        'ps:City="Kyoto" ps:State="Kyoto Prefecture"',
        `<ps:Country>Japan</ps:Country><Iptc4xmpCore:Location>Arashiyama</Iptc4xmpCore:Location>`
      )
    );
    expect(layer.place).toEqual({
      city: 'Kyoto',
      state: 'Kyoto Prefecture',
      country: 'Japan',
      location: 'Arashiyama',
    });
    const m = merge([['xmp', layer]]);
    expect(m.place).toEqual(layer.place);
    expect(m.placeLabel).toBe('Kyoto, Japan');
  });

  it('merges place per field across layers', () => {
    const m = merge([
      ['sidecar', { place: { city: 'Greenport' } }],
      ['iptc', { place: { state: 'New York', country: 'United States' } }],
    ]);
    expect(m.place).toEqual({
      city: 'Greenport',
      state: 'New York',
      country: 'United States',
      location: null,
    });
    expect(m.placeLabel).toBe('Greenport, United States');
    expect(merge([['iptc', {}]]).place).toBe(null);
  });
});
