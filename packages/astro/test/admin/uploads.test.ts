import { afterEach, describe, expect, it } from 'vitest';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { processGallery } from '@minimalgallery/pipeline';
import {
  settled,
  startServer,
  tempGallery,
  upload,
  writeJpeg,
  type TestServer,
} from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('chunked uploads', () => {
  it('adds a photo in chunks, dedupes by content, renames a clash', async () => {
    const dir = await tempGallery();
    const existing = await writeJpeg(join(dir, 'photos/colors/Red.jpg'), {
      color: '#c33',
    });
    await processGallery(dir);
    server = await startServer({ galleryDir: dir });
    const events = await server.events();

    const blue = await writeJpeg(join(dir, 'incoming/Red.jpg'), {
      color: '#33c',
    });
    const lastModified = Date.parse('2004-06-01T12:00:00Z');
    const first = await upload(server, 'colors', 'Red.jpg', blue, {
      chunk: 300,
      lastModified,
    });
    // The name is taken in the album: -2.
    expect(first.result).toEqual({
      status: 'added',
      photoId: 'colors__red_2',
      path: 'photos/colors/Red-2.jpg',
    });
    const placed = join(dir, 'photos/colors/Red-2.jpg');
    expect(await readFile(placed)).toEqual(blue);
    expect((await stat(placed)).mtimeMs).toBe(lastModified);

    // The same content again, under another name, before any run: duplicate.
    const again = await upload(server, 'japan', 'Blue.jpg', blue);
    expect(again.result).toEqual({
      status: 'duplicate',
      sameAs: 'colors__red_2',
      path: 'photos/colors/Red-2.jpg',
    });
    // Content already in a manifest: duplicate.
    const old = await upload(server, 'colors', 'Other.jpg', existing);
    expect(old.result).toMatchObject({
      status: 'duplicate',
      sameAs: 'colors__red',
    });

    // The photo arrives as a `photo` event once its manifest is written.
    const photo = await events.waitFor(
      (e) => e.event === 'photo' && e.data.id === 'colors__red_2'
    );
    expect(photo.data).toMatchObject({
      album: 'colors',
      file: 'Red-2.jpg',
      thumb: expect.stringMatching(
        /^\/_mg\/colors__red_2\/[0-9a-f]{8}-grid\.avif$/
      ),
    });
    await events.waitFor(
      (e) =>
        e.event === 'albums' &&
        e.data.find((a: any) => a.id === 'colors')?.count === 2
    );
    expect(
      events.events.some((e) => e.event === 'queue' && e.data.running)
    ).toBe(true);
    // The chunk files are gone; nothing was written for the duplicates.
    expect(await readdir(join(dir, '.minimalgallery/cache/uploads'))).toEqual(
      []
    );
    expect((await readdir(join(dir, 'photos/colors'))).sort()).toEqual([
      'Red-2.jpg',
      'Red.jpg',
    ]);
  });

  it('skips RAW and other formats by name, and takes HEIC', async () => {
    const dir = await tempGallery();
    server = await startServer({ galleryDir: dir });
    for (const [name, reason] of [
      ['DSC_0412.NEF', 'RAW: export a JPEG instead'],
      ['notes.txt', 'not a supported photo format'],
    ]) {
      const r = await server.call('POST', '/uploads', {
        album: 'phone',
        name,
        size: 10,
        lastModified: 0,
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ status: 'skipped', reason });
    }
    const heic = await server.call('POST', '/uploads', {
      album: 'phone',
      name: 'IMG_0001.HEIC',
      size: 10,
      lastModified: 0,
    });
    expect(heic.status).toBe(201);
  });

  it('moves sidecars with their photo, under its final name', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/trip/DSC_1.jpg'), { color: '#123' });
    server = await startServer({ galleryDir: dir });
    const bytes = await writeJpeg(join(dir, 'incoming/DSC_1.jpg'), {
      color: '#456',
    });
    const created = await server.call('POST', '/uploads', {
      album: 'trip',
      name: 'DSC_1.jpg',
      size: bytes.length,
      lastModified: Date.now(),
    });
    const photoId = created.body.id;
    // The sidecar completes first: it waits for its photo.
    const xmp = Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>');
    const side = await upload(server, 'trip', 'DSC_1.XMP', xmp, {
      sidecarOf: photoId,
    });
    expect(side.result).toEqual({ status: 'waiting' });
    await server.call('PUT', `/uploads/${photoId}?offset=0`, bytes, {
      'content-type': 'application/octet-stream',
    });
    const done = await server.call('POST', `/uploads/${photoId}/complete`);
    expect(done.body).toMatchObject({
      status: 'added',
      path: 'photos/trip/DSC_1-2.jpg',
    });
    expect(await readFile(join(dir, 'photos/trip/DSC_1-2.xmp'), 'utf8')).toBe(
      xmp.toString()
    );
    // A sidecar after its photo is placed at once.
    const md = await upload(
      server,
      'trip',
      'DSC_1.md',
      Buffer.from('---\ntitle: Hi\n---\n'),
      {
        sidecarOf: photoId,
      }
    );
    expect(md.result).toEqual({
      status: 'added',
      path: 'photos/trip/DSC_1-2.md',
    });
    await settled(dir);
    const m = JSON.parse(
      await readFile(
        join(dir, '.minimalgallery/manifest/trip__dsc_1_2.json'),
        'utf8'
      )
    );
    expect(m.title).toBe('Hi');
  });

  it('resumes from the received offset and can be discarded', async () => {
    const dir = await tempGallery();
    server = await startServer({ galleryDir: dir });
    const created = await server.call('POST', '/uploads', {
      album: 'a',
      name: 'x.jpg',
      size: 10,
      lastModified: 0,
    });
    const id = created.body.id;
    const put = (offset: number, text: string) =>
      server!.call(
        'PUT',
        `/uploads/${id}?offset=${offset}`,
        Buffer.from(text),
        {
          'content-type': 'application/octet-stream',
        }
      );
    expect((await put(0, '12345')).body).toEqual({ received: 5 });
    const gap = await put(8, '9');
    expect(gap.status).toBe(409);
    expect(gap.body.received).toBe(5);
    // A retry of the last chunk rewrites it.
    expect((await put(0, 'abcde')).body).toEqual({ received: 5 });
    expect((await put(5, '123456')).status).toBe(400);
    const early = await server.call('POST', `/uploads/${id}/complete`);
    expect(early.status).toBe(409);
    expect(early.body.received).toBe(5);
    expect((await server.call('DELETE', `/uploads/${id}`)).status).toBe(204);
    expect((await put(5, 'x')).status).toBe(404);
    const big = await server.call(
      'PUT',
      `/uploads/${id}?offset=0`,
      Buffer.alloc(4 * 1024 * 1024 + 1),
      { 'content-type': 'application/octet-stream' }
    );
    expect([404, 413]).toContain(big.status);
  });
});
