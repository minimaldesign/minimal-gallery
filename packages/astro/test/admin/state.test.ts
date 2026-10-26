import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { processGallery } from '@minimalgallery/pipeline';
import {
  settled,
  sha256,
  startServer,
  tempGallery,
  write,
  writeJpeg,
  type TestServer,
} from './helpers.ts';

/** An XMP packet around `body`, with extra attributes on its description. */
const packet = (body: string, attributes = '') =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" ${attributes}>${body}</rdf:Description></rdf:RDF></x:xmpmeta>`;

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function gallery() {
  const dir = await tempGallery();
  await writeJpeg(join(dir, 'photos/colors/Red.jpg'), { color: '#c33' });
  await writeJpeg(join(dir, 'photos/colors/Undated.jpg'), {
    color: '#3c3',
    date: null,
  });
  await writeJpeg(join(dir, 'photos/colors/Bare.jpg'), {
    color: '#33c',
    exif: false,
  });
  // The same pixels as Red.jpg, in another album.
  await writeJpeg(join(dir, 'photos/japan/kyoto/Copy.jpg'), { color: '#c33' });
  await processGallery(dir, { concurrency: 2 });
  return dir;
}

describe('GET /state', () => {
  it('lists albums, photos, badges and the first-run state', async () => {
    const dir = await gallery();
    await mkdir(join(dir, 'photos/empty'));
    server = await startServer({ galleryDir: dir });
    const { status, body } = await server.call('GET', '/state');
    expect(status).toBe(200);
    expect(body.gallery).toMatchObject({
      name: 'Photos',
      storage: { mode: 'site' },
      originals: 'none',
      albumsSort: 'date',
      defaults: { fit: 'fill', size: 2 },
    });
    expect(body.albums.map((a: any) => a.id)).toEqual([
      'colors',
      'empty',
      'japan',
      'japan/kyoto',
    ]);
    const japan = body.albums.find((a: any) => a.id === 'japan');
    expect(japan.children).toEqual(['japan/kyoto']);
    expect(body.albums.find((a: any) => a.id === 'empty')).toMatchObject({
      count: 0,
      title: 'Empty',
    });
    expect(body.albums.find((a: any) => a.id === 'colors').count).toBe(3);

    const byId = Object.fromEntries(body.photos.map((p: any) => [p.id, p]));
    expect(body.photos.map((p: any) => p.album)).toEqual([
      'colors',
      'colors',
      'colors',
      'japan/kyoto',
    ]);
    expect(byId.colors__undated.attention).toEqual(['no-date']);
    expect(byId.colors__bare.attention).toEqual(['no-date', 'no-exif']);
    expect(byId.colors__red.attention).toEqual(['duplicate']);
    expect(byId.colors__red.duplicateOf).toEqual(['japan_kyoto__copy']);
    expect(byId.japan_kyoto__copy.duplicateOf).toEqual(['colors__red']);
    expect(byId.colors__red.thumb).toMatch(
      /^\/_mg\/colors__red\/[0-9a-f]{8}-grid\.avif$/
    );
    expect(byId.colors__red.color).toMatch(/^oklch\(/);
    expect(body.firstRun).toEqual({
      photos: true,
      named: false,
      previewed: false,
      published: false,
    });
    expect(body.queue).toMatchObject({ running: false, queued: false });
    expect(body.bucket).toBeNull();

    const previewed = await server.call('POST', '/first-run/previewed');
    expect(previewed.body.firstRun.previewed).toBe(true);
    const admin = JSON.parse(
      await readFile(join(dir, '.minimalgallery/cache/admin.json'), 'utf8')
    );
    expect(admin.previewed).toBe(true);
  });

  it('gives the inspector extracted values apart from the sidecar', async () => {
    const dir = await gallery();
    await write(
      join(dir, 'photos/colors/Red.jpg.xmp'),
      packet(
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">From the sidecar</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">A caption.</rdf:li></rdf:Alt></dc:description>'
      )
    );
    await write(
      join(dir, 'photos/colors/_album.md'),
      '---\nphotos:\n  Red.jpg: { hidden: true }\n---\n'
    );
    await processGallery(dir);
    server = await startServer({ galleryDir: dir });
    const { status, body } = await server.call('GET', '/photos/colors__red');
    expect(status).toBe(200);
    expect(body.title).toBe('From the sidecar');
    expect(body.caption).toBe('A caption.');
    expect(body.extracted.title).toBe('Red');
    expect(body.extracted.from.title).toBe('filename');
    expect(body.extracted.camera).toBe('Nikon D70');
    expect(body.extracted.from.camera).toBe('exif');
    expect(body.extracted.date).toBe('2005-02-27T18:16:10');
    expect(body.extracted.from.date).toBe('exif');
    expect(body.extracted.hidden).toBe(false);
    expect(body.overrides).toEqual({
      title: 'From the sidecar',
      caption: 'A caption.',
      hidden: true,
    });
    expect(body.overridesFile).toBe('photos/colors/Red.jpg.xmp');
    expect(body.preview).toMatch(/^\/_mg\/colors__red\//);
    expect(body.variants.every((v: any) => v.url.startsWith('/_mg/'))).toBe(
      true
    );
    expect((await server.call('GET', '/photos/nope__none')).status).toBe(404);
  });
});

describe('PUT /photos/:id/overrides', () => {
  it('writes only the overridden fields to <file>.xmp, keeps the rest, never touches the photo', async () => {
    const dir = await gallery();
    const photo = join(dir, 'photos/colors/Red.jpg');
    const before = await sha256(photo);
    const sidecar = join(dir, 'photos/colors/Red.jpg.xmp');
    // Another app’s field in the same sidecar.
    await write(
      sidecar,
      packet(
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Old caption</rdf:li></rdf:Alt></dc:description>',
        'xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Label="Blue"'
      )
    );
    server = await startServer({ galleryDir: dir });

    const put = await server.call('PUT', '/photos/colors__red/overrides', {
      title: 'Red “door”',
      date: '2005-03-01',
      keywords: ['door', 'red', 'door'],
      place: { city: 'Kyoto', country: 'Japan' },
    });
    expect(put.status).toBe(200);
    expect(put.body.savedTo).toBe('sidecar');
    expect(put.body.overridesFile).toBe('photos/colors/Red.jpg.xmp');
    let text = await readFile(sidecar, 'utf8');
    expect(text).toContain('Blue');
    expect(text).toContain('Red “door”');
    expect(text).toContain('Old caption');
    expect(text).not.toMatch(/Creator|Rights/);
    expect(put.body.overrides).toEqual({
      title: 'Red “door”',
      date: '2005-03-01T00:00:00',
      keywords: ['door', 'red'],
      place: { city: 'Kyoto', country: 'Japan' },
      caption: 'Old caption',
    });

    await settled(dir);
    const m = JSON.parse(
      await readFile(
        join(dir, '.minimalgallery/manifest/colors__red.json'),
        'utf8'
      )
    );
    expect(m).toMatchObject({
      title: 'Red “door”',
      date: '2005-03-01T00:00:00',
      dateSource: 'sidecar',
      keywords: ['door', 'red'],
      caption: 'Old caption',
      place: { city: 'Kyoto', country: 'Japan' },
    });

    // null removes, per field and per place sub-field.
    await server.call('PUT', '/photos/colors__red/overrides', {
      caption: null,
      place: { city: null },
      date: null,
    });
    text = await readFile(sidecar, 'utf8');
    expect(text).not.toContain('Old caption');
    expect(text).not.toContain('City');
    expect(text).toContain('Japan');

    // Bad values, and ratings (not kept), are refused before anything is written.
    for (const body of [
      { rating: 4 },
      { date: 'yesterday' },
      { keywords: 'a, b' },
      { color: 'red' },
      { place: { street: 'x' } },
    ])
      expect(
        (await server.call('PUT', '/photos/colors__red/overrides', body)).status
      ).toBe(400);

    // Only the other app’s field is left: the file stays.
    const cleared = await server.call('PUT', '/photos/colors__red/overrides', {
      title: null,
      keywords: null,
      place: null,
    });
    expect(cleared.body.overrides).toEqual({});
    expect(await readFile(sidecar, 'utf8')).toContain('Blue');
    // Nothing at all: the file goes.
    await write(
      sidecar,
      packet(
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Only this</rdf:li></rdf:Alt></dc:title>'
      )
    );
    const gone = await server.call('PUT', '/photos/colors__red/overrides', {
      title: null,
    });
    expect(gone.body).toMatchObject({ overrides: {}, overridesFile: null });
    await expect(stat(sidecar)).rejects.toThrow();

    expect(await sha256(photo)).toBe(before);
    expect(
      (await server.call('PUT', '/photos/colors__none/overrides', {})).status
    ).toBe(404);
  });

  it('writes map coordinates, hides through _album.md and shows the camera data', async () => {
    const dir = await gallery();
    server = await startServer({ galleryDir: dir });
    const bare = await server.call('GET', '/photos/colors__bare');
    expect(bare.body.cameraData).toEqual({
      camera: null,
      lens: null,
      focal: null,
      aperture: null,
      shutter: null,
      iso: null,
    });

    const red = await server.call('GET', '/photos/colors__red');
    expect(red.body.cameraData).toMatchObject({
      camera: expect.stringMatching(/D70/),
      aperture: 'f/5.6',
    });

    const put = await server.call('PUT', '/photos/colors__bare/overrides', {
      gps: { lat: -35.01160009, lon: 135.7681 },
      hidden: true,
    });
    expect(put.status).toBe(200);
    expect(put.body.overrides).toEqual({
      gps: { lat: -35.0116, lon: 135.7681 },
      hidden: true,
    });
    expect(await readFile(join(dir, 'photos/colors/_album.md'), 'utf8')).toBe(
      '---\nphotos:\n  Bare.jpg:\n    hidden: true\n---\n'
    );
    await settled(dir);
    const m = JSON.parse(
      await readFile(
        join(dir, '.minimalgallery/manifest/colors__bare.json'),
        'utf8'
      )
    );
    expect(m.gps).toEqual({ lat: -35.0116, lon: 135.7681 });
    expect(m.hidden).toBe(true);

    for (const gps of [
      { lat: 91, lon: 0 },
      { lat: 0, lon: 181 },
      { lat: '35', lon: 135 },
      { lat: 1, lon: 2, alt: 3 },
      '35.0116, 135.7681',
    ])
      expect(
        (await server.call('PUT', '/photos/colors__bare/overrides', { gps }))
          .status
      ).toBe(400);

    await server.call('PUT', '/photos/colors__bare/overrides', {
      gps: null,
      hidden: false,
    });
    await expect(
      stat(join(dir, 'photos/colors/Bare.jpg.xmp'))
    ).rejects.toThrow();
    await expect(stat(join(dir, 'photos/colors/_album.md'))).rejects.toThrow();
  });

  it('saves into the photo, and clears the copies that would hide it', async () => {
    const dir = await gallery();
    const photo = join(dir, 'photos/colors/Red.jpg');
    const before = await sha256(photo);
    const sidecar = join(dir, 'photos/colors/Red.jpg.xmp');
    await write(
      sidecar,
      packet(
        '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Sidecar title</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Sidecar caption</rdf:li></rdf:Alt></dc:description>'
      )
    );
    await write(
      join(dir, 'photos/colors/_album.md'),
      '---\nphotos:\n  Red.jpg: { title: Album title }\n---\n'
    );
    await processGallery(dir);
    const manifest = async () =>
      JSON.parse(
        await readFile(
          join(dir, '.minimalgallery/manifest/colors__red.json'),
          'utf8'
        )
      );
    const keys = (await manifest()).variants.map((v: any) => v.key);
    server = await startServer({ galleryDir: dir });
    expect((await server.call('GET', '/edits/sidecars')).body).toEqual({
      photos: 1,
    });
    await server.call('PUT', '/settings', { saveEdits: 'photo' });

    const put = await server.call('PUT', '/photos/colors__red/overrides', {
      title: 'In the photo',
      date: '2006-01-02T03:04',
      gps: { lat: 35.0116, lon: -135.7681 },
    });
    expect(put.status).toBe(200);
    expect(put.body.savedTo).toBe('photo');
    expect(await sha256(photo)).not.toBe(before);
    // The sidecar keeps the caption only; the album entry is gone.
    expect(put.body.overrides).toEqual({ caption: 'Sidecar caption' });
    expect(put.body.extracted).toMatchObject({
      title: 'In the photo',
      date: '2006-01-02T03:04:00',
      gps: { lat: 35.0116, lon: -135.7681 },
    });
    expect(put.body.extracted.from.title).toBe('xmp');
    await expect(stat(join(dir, 'photos/colors/_album.md'))).rejects.toThrow();

    // The rest of the sidecar moves into the photo; the sidecar goes.
    const moved = await server.call('POST', '/edits/sidecars/embed');
    expect(moved.body).toEqual({ moved: 1, failed: [] });
    await expect(stat(sidecar)).rejects.toThrow();
    expect((await server.call('GET', '/edits/sidecars')).body).toEqual({
      photos: 0,
    });

    await settled(dir);
    const m = await manifest();
    expect(m).toMatchObject({
      title: 'In the photo',
      caption: 'Sidecar caption',
      date: '2006-01-02T03:04:00',
      dateSource: 'xmp',
      gps: { lat: 35.0116, lon: -135.7681 },
    });
    // New metadata, same pixels: the derivatives are kept.
    expect(m.variants.map((v: any) => v.key)).toEqual(keys);
  });

  it('quotes values YAML would read as something else', async () => {
    const dir = await gallery();
    server = await startServer({ galleryDir: dir });
    await server.call('PUT', '/photos/colors__red/overrides', {
      title: 'yes',
      copyright: '12:30',
    });
    await settled(dir);
    const m = JSON.parse(
      await readFile(
        join(dir, '.minimalgallery/manifest/colors__red.json'),
        'utf8'
      )
    );
    expect(m.title).toBe('yes');
    expect(m.copyright).toBe('12:30');
  });
});

describe('albums', () => {
  it('creates, edits and orders albums through _album.md', async () => {
    const dir = await gallery();
    await write(
      join(dir, 'photos/colors/_album.md'),
      '---\n# album notes\nphotos:\n  Red.jpg:\n    title: Map title\n---\nOld description\n'
    );
    server = await startServer({ galleryDir: dir });

    const created = await server.call('POST', '/albums', {
      path: 'Japan 2025/Tokyo Night',
      title: 'Tokyo at night',
    });
    expect(created.status).toBe(201);
    expect(created.body.album).toMatchObject({
      id: 'japan_2025/tokyo_night',
      path: 'japan_2025/tokyo_night',
      parent: 'japan_2025',
      title: 'Tokyo at night',
      count: 0,
    });
    expect(
      await readFile(
        join(dir, 'photos/japan_2025/tokyo_night/_album.md'),
        'utf8'
      )
    ).toBe('---\ntitle: Tokyo at night\n---\n');
    expect(
      (await server.call('POST', '/albums', { path: 'japan_2025/tokyo_night' }))
        .status
    ).toBe(409);
    expect((await server.call('POST', '/albums', { path: '///' })).status).toBe(
      400
    );

    // A child of a folder made in Finder, whose name is not a slug, goes
    // inside that folder rather than into a new japan_trip/ beside it.
    await mkdir(join(dir, 'photos/Japan Trip'));
    const child = await server.call('POST', '/albums', {
      path: 'japan_trip/Kyoto',
    });
    expect(child.status).toBe(201);
    expect(child.body.album).toMatchObject({
      id: 'japan_trip/kyoto',
      parent: 'japan_trip',
    });
    expect(await readdir(join(dir, 'photos/Japan Trip'))).toEqual(['kyoto']);
    await expect(readdir(join(dir, 'photos/japan_trip'))).rejects.toThrow();

    const edited = await server.call('PUT', '/albums/colors', {
      title: 'Colours',
      description: 'New *description*',
      hidden: true,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.album).toMatchObject({
      title: 'Colours',
      description: 'New *description*',
      hidden: true,
    });
    let text = await readFile(join(dir, 'photos/colors/_album.md'), 'utf8');
    expect(text).toContain('# album notes');
    expect(text).toContain('title: Map title');
    expect(text).toContain('New *description*');
    expect(text).not.toContain('Old description');

    await server.call('PUT', '/albums/colors', { hidden: null });
    text = await readFile(join(dir, 'photos/colors/_album.md'), 'utf8');
    expect(text).not.toContain('hidden');
    expect(
      (await server.call('PUT', '/albums/colors', { sort: 'random' })).status
    ).toBe(400);
    expect(
      (await server.call('PUT', '/albums/colors', { cover: 'Red.jpg' })).status
    ).toBe(400);
    expect((await server.call('PUT', '/albums/nope', {})).status).toBe(404);

    const order = ['Bare.jpg', 'Red.jpg', 'Undated.jpg'];
    const ordered = await server.call('PUT', '/albums/colors/order', {
      order,
    });
    expect(ordered.body.album).toMatchObject({ sort: 'manual', order });
    expect(
      (
        await server.call('PUT', '/albums/colors/order', {
          order: ['Missing.jpg'],
        })
      ).status
    ).toBe(400);

    // Nested ids travel as one encoded segment.
    const nested = await server.call(
      'PUT',
      `/albums/${encodeURIComponent('japan/kyoto')}`,
      { title: 'Kyoto' }
    );
    expect(nested.body.album.title).toBe('Kyoto');

    await settled(dir);
    const { body } = await server.call('GET', '/state');
    expect(
      body.photos
        .filter((p: any) => p.album === 'colors')
        .map((p: any) => p.file)
    ).toEqual(order);
    const albumsFile = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/_albums.json'), 'utf8')
    );
    expect(
      albumsFile.albums.find((a: any) => a.id === 'japan_2025/tokyo_night')
    ).toBeTruthy();
    // The photos: map in _album.md still applies.
    expect(body.photos.find((p: any) => p.id === 'colors__red').title).toBe(
      'Map title'
    );
    await rm(join(dir, 'photos/japan_2025'), { recursive: true });
  });
});
