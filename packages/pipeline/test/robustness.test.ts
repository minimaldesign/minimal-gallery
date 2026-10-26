import { describe, expect, it } from 'vitest';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { doctor, formatDoctorReport } from '../src/doctor.ts';
import { isHeic } from '../src/formats.ts';
import { processGallery } from '../src/process.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';

/** The first bytes of an HEIC file: an ftyp box with the given brands. */
const heicBytes = (major = 'heic', compatible = ['mif1', 'heic']) => {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const head = new Uint8Array(size + 16);
  new DataView(head.buffer).setUint32(0, size);
  head.set(new TextEncoder().encode(`ftyp${brands}`), 4);
  return head;
};

describe('unsupported inputs', () => {
  it('recognises HEIC by its signature, and not AVIF', () => {
    expect(isHeic(heicBytes())).toBe(true);
    expect(isHeic(heicBytes('mif1', ['heic']))).toBe(true);
    expect(isHeic(heicBytes('mif1', ['avif', 'miaf']))).toBe(false);
    expect(isHeic(heicBytes('avif', ['mif1']))).toBe(false);
    expect(isHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });

  it('reports RAW files with the fix and keeps going', async () => {
    const dir = await tempGallery();
    const p = (f: string) => join(dir, 'photos/trip', f);
    await writeJpeg(p('good.jpg'));
    await mkdir(join(dir, 'photos/trip'), { recursive: true });
    await writeFile(p('DSC_0001.NEF'), 'raw');
    // A RAW + JPEG pair: the JPEG is used, the RAW file is ignored quietly.
    await writeFile(p('pair.NEF'), 'raw');
    await writeJpeg(p('pair.jpg'));
    // An HEIC + JPEG pair too.
    await writeFile(p('IMG_0001.HEIC'), heicBytes());
    await writeJpeg(p('IMG_0001.JPG'));
    // HEIC content is decoded as HEIC under any name, so a truncated one
    // fails to decode, whatever its extension.
    await writeFile(p('IMG_0002.HEIC'), heicBytes());
    await writeFile(p('renamed.jpg'), heicBytes());
    const s = await processGallery(dir, { concurrency: 2 });
    expect(s.encoded).toBe(3);
    expect(s.errors.map((e) => [e.path, e.kind])).toEqual([
      ['photos/trip/DSC_0001.NEF', 'raw'],
      ['photos/trip/IMG_0002.HEIC', 'decode'],
      ['photos/trip/renamed.jpg', 'decode'],
    ]);
    expect(s.errors[0].message).toMatch(/Export a JPEG/);
    expect(s.warnings.join()).toMatch(/2 RAW or HEIC file\(s\) ignored/);
    const albums = JSON.parse(
      await (
        await import('node:fs/promises')
      ).readFile(join(dir, '.minimalgallery/manifest/_albums.json'), 'utf8')
    );
    expect(albums.albums[0].title).toBe('Trip');
  });

  it('reports a file that cannot be decoded without stopping the run', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/good.jpg'));
    await write(join(dir, 'photos/a/broken.jpg'), 'not a jpeg');
    const s = await processGallery(dir, { concurrency: 2 });
    expect(s.encoded).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatchObject({
      path: 'photos/a/broken.jpg',
      kind: 'decode',
    });
  });
});

describe('prune', () => {
  it('removes orphaned folders, empty folders and interrupted writes', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/one.jpg'));
    await writeJpeg(join(dir, 'photos/a/gone.jpg'), { color: '#3c3' });
    await processGallery(dir, { concurrency: 1 });
    const mg = join(dir, 'public/_mg');
    const goneFiles = (await readdir(join(mg, 'a__gone'))).length;
    await rm(join(dir, 'photos/a/gone.jpg'));
    // Derivatives that no manifest names go too.
    await write(join(mg, 'a__stray/1234abcd-grid.avif'), 'x');
    await mkdir(join(mg, 'empty_folder'), { recursive: true });
    await write(join(mg, 'a__one/partial.avif.123.tmp'), 'x');
    const s = await processGallery(dir, { concurrency: 1, prune: true });
    expect(s.pruned.ids).toEqual(['a__gone', 'a__stray']);
    expect(s.pruned).toMatchObject({ manifests: 1, files: goneFiles + 1 });
    expect(s.pruned.swept.sort()).toEqual([
      'a__one/partial.avif.123.tmp',
      'empty_folder/',
    ]);
    expect((await readdir(mg)).sort()).toEqual(['a__one']);
  });
});

describe('doctor', () => {
  it('counts files and recommends a storage mode', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/one.jpg'));
    await writeJpeg(join(dir, 'photos/a/two.jpg'), { date: null });
    await processGallery(dir, { concurrency: 2 });
    await writeJpeg(join(dir, 'photos/a/three.jpg'));
    const r = await doctor(dir);
    expect(r).toMatchObject({
      photos: 3,
      albums: 1,
      undated: 1,
      missingManifests: ['photos/a/three.jpg'],
      derivatives: { files: 4 },
      recommendation: 'site-ok',
    });
    // Archive + album + year, month, day, camera, aperture for the dated photo.
    expect(r.contexts.total).toBe(7);
    expect(r.pages.total).toBe(2 + 7 * 2 + r.pages.fixedFiles + 4);
    expect(r.issues.join()).toMatch(/no manifest/);
    expect(r.publish).toBeNull();

    // Publishing to Cloudflare: the file limit applies.
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ minimalgallery: { publish: 'deploy' } })
    );
    expect((await doctor(dir)).publish).toBe('deploy');
    expect(formatDoctorReport(await doctor(dir))).toMatch(
      /more photos before the file limit/
    );

    // Building for the owner’s host: no Cloudflare limit.
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ minimalgallery: { publish: 'build' } })
    );
    const own = await doctor(dir);
    expect(own.message).toMatch(/does not apply/);
    expect(formatDoctorReport(own)).not.toMatch(/headroom/);
  });
});

describe('config in processing', () => {
  it('publishes originals and encodes Display P3 when configured', async () => {
    const { resolveConfig } = await import('../src/config.ts');
    const { iccDescription } = await import('../src/encode.ts');
    const sharp = (await import('sharp')).default;
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/one.jpg'));
    const config = resolveConfig({ originals: 'site', color: 'p3' });
    const s = await processGallery(dir, { concurrency: 1, config });
    expect(s.encoded).toBe(1);
    const { readFile } = await import('node:fs/promises');
    const m = JSON.parse(
      await readFile(join(dir, '.minimalgallery/manifest/a__one.json'), 'utf8')
    );
    expect(m.original.key).toMatch(/^a__one\/[0-9a-f]{8}-original\.jpg$/);
    expect(m.original.url).toBe(`/_mg/${m.original.key}`);
    const grid = join(dir, 'public/_mg', m.variants[0].key);
    const meta = await sharp(grid).metadata();
    expect(iccDescription(meta.icc)).toMatch(/P3/);
    // Turning originals off removes the published original on the next run.
    const again = await processGallery(dir, {
      concurrency: 1,
      config: resolveConfig({ color: 'p3' }),
    });
    expect(again.metadataOnly).toBe(1);
    expect(await readdir(join(dir, 'public/_mg/a__one'))).toHaveLength(2);
  });
});
