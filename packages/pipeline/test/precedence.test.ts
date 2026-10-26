import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processGallery } from '../src/process.ts';
import { xmpToLayer } from '../src/xmp.ts';
import { tempGallery, write, writeJpeg, xmp } from './helpers.ts';

const OTHER_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmp:Rating="4"
    photoshop:City="Kyoto"
    photoshop:Country="Japan"
    Iptc4xmpCore:Location="Arashiyama">
   <dc:title><rdf:Alt><rdf:li xml:lang="fr">Titre</rdf:li><rdf:li xml:lang="x-default">XMP title</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">XMP caption</rdf:li></rdf:Alt></dc:description>
   <dc:subject><rdf:Bag><rdf:li>bamboo</rdf:li><rdf:li>forest</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

describe('XMP sidecars', () => {
  it('reads the attribute and element forms', () => {
    expect(xmpToLayer(OTHER_XMP)).toEqual({
      title: 'XMP title',
      caption: 'XMP caption',
      keywords: ['bamboo', 'forest'],
      place: {
        city: 'Kyoto',
        state: undefined,
        country: 'Japan',
        location: 'Arashiyama',
      },
    });
  });
});

describe('override precedence', () => {
  it('<file>.xmp > _album.md map > <name>.xmp > EXIF > file name', async () => {
    const dir = await tempGallery();
    const p = (f: string) => join(dir, 'photos/kyoto', f);
    await writeJpeg(p('a.jpg'));
    await writeJpeg(p('b.jpg'));
    await writeJpeg(p('c.jpg'));
    await writeJpeg(p('d_e-f.jpg'));
    // a: every layer sets a title; the photo’s own sidecar wins.
    await write(
      p('a.jpg.xmp'),
      xmp({
        title: 'From sidecar',
        caption: 'Markdown *caption*.',
        date: '2020-01-02T00:00:00',
      })
    );
    await write(p('a.xmp'), OTHER_XMP);
    // b: album map beats <name>.xmp, which still fills the fields the map leaves out.
    await write(p('b.xmp'), OTHER_XMP);
    await write(
      p('_album.md'),
      '---\ntitle: Kyoto\nsort: name\nphotos:\n  a.jpg: { title: From album }\n  b.jpg: { title: From album }\n---\nAlbum text.\n'
    );
    // c: only <name>.xmp.
    await write(p('c.xmp'), OTHER_XMP);
    await processGallery(dir, { concurrency: 2 });
    const read = async (id: string) =>
      JSON.parse(
        await readFile(
          join(dir, '.minimalgallery/manifest', `${id}.json`),
          'utf8'
        )
      );
    const a = await read('kyoto__a');
    expect(a.title).toBe('From sidecar');
    expect(a.caption).toBe('Markdown *caption*.');
    expect(a.date).toBe('2020-01-02T00:00:00');
    expect(a.dateSource).toBe('sidecar');
    expect(a.keywords).toEqual(['bamboo', 'forest']);
    const b = await read('kyoto__b');
    expect(b.title).toBe('From album');
    expect(b.caption).toBe('XMP caption');
    expect(b.place.city).toBe('Kyoto');
    expect(b.placeLabel).toBe('Kyoto, Japan');
    expect(b.facets.place).toEqual({
      slug: 'kyoto-japan',
      label: 'Kyoto, Japan',
    });
    expect(b.source).toBe('kyoto/b.jpg');
    const c = await read('kyoto__c');
    expect(c.title).toBe('XMP title');
    expect(c.date).toBe('2005-02-27T18:16:10');
    expect(c.dateSource).toBe('exif');
    expect(c.camera).toBe('Nikon D70');
    expect(c.exposure.shutter).toBe('1/60');
    expect(c.exposure.aperture).toBe(5.6);
    const d = await read('kyoto__d_e_f');
    expect(d.title).toBe('D e f');
    const albums = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/_albums.json'), 'utf8')
    );
    expect(albums.albums[0]).toMatchObject({
      id: 'kyoto',
      title: 'Kyoto',
      description: 'Album text.',
      sort: 'name',
    });
    expect(albums.albums[0].photoIds).toEqual([
      'kyoto__a',
      'kyoto__b',
      'kyoto__c',
      'kyoto__d_e_f',
    ]);
  });
});
