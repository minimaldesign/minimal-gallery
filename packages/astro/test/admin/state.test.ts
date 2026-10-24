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
      storage: { mode: 'repo' },
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
    expect(byId.colors__undated.attention).toEqual(['date-from-mtime']);
    expect(byId.colors__bare.attention).toEqual(['date-from-mtime', 'no-exif']);
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
      join(dir, 'photos/colors/Red.md'),
      '---\ntitle: From the sidecar\n---\nA caption.\n'
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
    expect(body.overrides).toEqual({
      title: 'From the sidecar',
      caption: 'A caption.',
    });
    expect(body.overridesFile).toBe('photos/colors/Red.md');
    expect(body.preview).toMatch(/^\/_mg\/colors__red\//);
    expect(body.variants.every((v: any) => v.url.startsWith('/_mg/'))).toBe(
      true
    );
    expect((await server.call('GET', '/photos/nope__none')).status).toBe(404);
  });
});

describe('PUT /photos/:id/overrides', () => {
  it('writes only the overridden fields, keeps the rest, never touches the photo', async () => {
    const dir = await gallery();
    const photo = join(dir, 'photos/colors/Red.jpg');
    const before = await sha256(photo);
    const md = join(dir, 'photos/colors/Red.md');
    await write(
      md,
      '---\n# written by hand\nlightroom: keep me\ntitle: Old\n---\nOld caption\n'
    );
    server = await startServer({ galleryDir: dir });

    const put = await server.call('PUT', '/photos/colors__red/overrides', {
      title: 'Red door',
      date: '2005-03-01',
      keywords: ['door', 'red', 'door'],
      place: { city: 'Kyoto', country: 'Japan' },
    });
    expect(put.status).toBe(200);
    expect(put.body.overridesFile).toBe('photos/colors/Red.md');
    let text = await readFile(md, 'utf8');
    expect(text).toContain('# written by hand');
    expect(text).toContain('lightroom: keep me');
    expect(text).toContain('title: Red door');
    expect(text).toContain('Old caption');
    expect(text).not.toMatch(/hidden|copyright|author/);
    expect(put.body.overrides).toMatchObject({
      lightroom: 'keep me',
      title: 'Red door',
      date: '2005-03-01',
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
      title: 'Red door',
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
    text = await readFile(md, 'utf8');
    expect(text).not.toContain('Old caption');
    expect(text).not.toContain('city');
    expect(text).toContain('country: Japan');

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

    // Only the hand-written key is left: the file stays.
    const cleared = await server.call('PUT', '/photos/colors__red/overrides', {
      title: null,
      keywords: null,
      place: null,
    });
    expect(cleared.body.overrides).toEqual({ lightroom: 'keep me' });
    // Nothing at all: the file goes.
    await write(md, '---\ntitle: Only this\n---\n');
    const gone = await server.call('PUT', '/photos/colors__red/overrides', {
      title: null,
    });
    expect(gone.body).toEqual({ overrides: {}, overridesFile: null });
    await expect(stat(md)).rejects.toThrow();

    expect(await sha256(photo)).toBe(before);
    expect(
      (await server.call('PUT', '/photos/colors__none/overrides', {})).status
    ).toBe(404);
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
