import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { processGallery } from '@minimalgallery/pipeline';
import { galleryLoader } from '../../src/loader.ts';
import {
  settled,
  startServer,
  tempGallery,
  writeJpeg,
  type TestServer,
} from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const BUCKET_CONFIG = `import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  storage: {
    mode: 's3',
    bucket: 'photos',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    publicUrl: 'https://media.example.com',
  },
});
`;

describe('bucket mode in dev', () => {
  it('serves staged media, redirects the rest, counts what waits', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/One.jpg'), { color: '#c33' });
    await writeJpeg(join(dir, 'photos/a/Two.jpg'), { color: '#3c3' });
    await processGallery(dir);
    const one = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/a__one.json'), 'utf8')
    );
    const two = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/a__two.json'), 'utf8')
    );
    // Stage One’s derivatives, as the bucket storage would; Two’s are
    // "uploaded" (not staged). Files in public/_mg go away.
    for (const v of one.variants) {
      const to = join(dir, '.minimalgallery/cache/media', v.key);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(dir, 'public/_mg', v.key), to);
    }
    await rm(join(dir, 'public'), { recursive: true });
    await writeFile(join(dir, 'minimalgallery.config.ts'), BUCKET_CONFIG);
    server = await startServer({ galleryDir: dir });

    const key = one.variants[0].key;
    const staged = await server.raw('GET', `/_mg/${key}`);
    expect(staged.status).toBe(200);
    expect(staged.headers['content-type']).toMatch(/^image\//);
    const missing = two.variants[0].key;
    const redirect = await server.raw('GET', `/_mg/${missing}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(
      `https://media.example.com/${missing}`
    );
    expect((await server.raw('GET', '/_mg/../secret')).text).toBe('not admin');

    const state = await server.call('GET', '/state');
    expect(state.body.gallery.storage).toEqual({
      mode: 's3',
      bucket: 'photos',
      publicUrl: 'https://media.example.com',
      credentials: false,
    });
    expect(state.body.bucket).toEqual({ pending: one.variants.length });

    await writeFile(
      join(dir, '.env'),
      'MG_S3_ACCESS_KEY_ID=abc\nMG_S3_SECRET_ACCESS_KEY="def"\n'
    );
    expect(
      (await server.call('GET', '/state')).body.gallery.storage.credentials
    ).toBe(true);
  });

  it('serves public/_mg itself in site mode and leaves the rest to Vite', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/One.jpg'));
    await processGallery(dir);
    const one = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/a__one.json'), 'utf8')
    );
    server = await startServer({ galleryDir: dir });
    // A derivative written a moment ago is served at once, before Vite’s
    // list of public files knows about it.
    const fresh = await server.raw('GET', `/_mg/${one.variants[0].key}`);
    expect(fresh.status).toBe(200);
    expect(fresh.headers['content-type']).toMatch(/^image\//);
    expect((await server.raw('GET', '/_mg/a__one/x-grid.avif')).text).toBe(
      'not admin'
    );
  });
});

describe('the loader in dev', () => {
  it('points bucket URLs at the dev server and marks the digest', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/One.jpg'));
    await processGallery(dir);
    const file = join(dir, '.minimalgallery/manifest/a__one.json');
    const m = JSON.parse(await readFile(file, 'utf8'));
    m.variants = m.variants.map((v: any) => ({
      ...v,
      url: `https://media.example.com/${v.key}`,
    }));
    await writeFile(file, JSON.stringify(m));

    const load = async (watcher: EventEmitter | undefined) => {
      const entries = new Map<string, any>();
      await galleryLoader('photos', { galleryDir: dir }).load({
        config: { root: pathToFileURL(`${dir}/`), base: '/repo' },
        watcher: watcher && Object.assign(watcher, { add() {} }),
        store: {
          get: (id: string) => entries.get(id),
          set: (e: any) => entries.set(e.id, e),
          keys: () => entries.keys(),
          delete: (id: string) => entries.delete(id),
        },
        logger: { info() {}, error() {} },
        parseData: async ({ data }: any) => data,
        renderMarkdown: async () => ({ html: '' }),
      } as any);
      return entries.get('a__one');
    };

    const dev = await load(new EventEmitter());
    expect(dev.digest.startsWith(`${m.digest}.dev`)).toBe(true);
    expect(dev.data.variants[0].url).toBe(`/repo/_mg/${m.variants[0].key}`);
    const build = await load(undefined);
    expect(build.digest).not.toContain('.dev');
    expect(build.digest.startsWith(m.digest)).toBe(true);
    expect(build.data.variants[0].url).toBe(
      `https://media.example.com/${m.variants[0].key}`
    );
  });
});

describe('the watcher bridge', () => {
  it('turns files copied into photos/ into runs, and deletions into prunes', async () => {
    const dir = await tempGallery();
    const watcher = new EventEmitter();
    server = await startServer({ galleryDir: dir, watcher: watcher as any });
    const events = await server.events();
    const photo = join(dir, 'photos/finder/Dropped.jpg');
    await writeJpeg(photo);
    watcher.emit('addDir', dirname(photo));
    watcher.emit('add', photo);
    await events.waitFor(
      (e) => e.event === 'photo' && e.data.id === 'finder__dropped'
    );
    // Files outside photos/ and dotfiles are ignored.
    await settled(dir);
    const queued = events.events.filter((e) => e.event === 'queue').length;
    watcher.emit('add', join(dir, 'public/_mg/x.avif'));
    watcher.emit('add', join(dir, 'photos/finder/.DS_Store'));
    await new Promise((r) => setTimeout(r, 150));
    expect(events.events.filter((e) => e.event === 'queue').length).toBe(
      queued
    );

    // A HEIC copied in is reported once, with the fix.
    const heic = join(dir, 'photos/finder/IMG_0001.HEIC');
    await writeFile(heic, 'not really');
    watcher.emit('add', heic);
    const error = await events.waitFor((e) => e.event === 'error');
    expect(error.data.path).toBe('photos/finder/IMG_0001.HEIC');
    expect(error.data.message).toMatch(/Export the photo as JPEG/);

    await rm(photo);
    watcher.emit('unlink', photo);
    await events.waitFor(
      (e) => e.event === 'photo-removed' && e.data.id === 'finder__dropped'
    );
  });
});
