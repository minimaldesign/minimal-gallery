import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
  copyFile,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPhotos } from '../src/add.ts';
import { albumSlug } from '../src/album.ts';
import { choosePublishMethod } from '../src/commands/publish.ts';
import { upgradeCommands } from '../src/commands/upgrade.ts';
import { detectPackageManager } from '../src/exec.ts';
import { findGalleryRoot } from '../src/root.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mg-cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const jpeg = (r: number, g: number, b: number) =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r, g, b } },
  })
    .jpeg()
    .toBuffer();

describe('albumSlug', () => {
  it('slugs like the pipeline', () => {
    expect(albumSlug('Japan 2025')).toBe('japan_2025');
    expect(albumSlug('japan-2025')).toBe('japan_2025');
    expect(albumSlug('Café, Montréal!')).toBe('cafe_montreal');
  });
  it('keeps nesting and drops empty segments', () => {
    expect(albumSlug('Travel/Japan 2025/')).toBe('travel/japan_2025');
    expect(albumSlug('***')).toBe('');
  });
});

describe('findGalleryRoot', () => {
  it('finds the folder with photos/ from deep inside it', async () => {
    await mkdir(join(dir, 'photos', 'japan'), { recursive: true });
    expect(await findGalleryRoot(join(dir, 'photos', 'japan'))).toBe(dir);
  });
  it('prefers the nearest config file', async () => {
    await mkdir(join(dir, 'photos'), { recursive: true });
    await mkdir(join(dir, 'site', 'src'), { recursive: true });
    await writeFile(
      join(dir, 'site', 'minimalgallery.config.ts'),
      'export default {};'
    );
    expect(await findGalleryRoot(join(dir, 'site', 'src'))).toBe(
      join(dir, 'site')
    );
  });
  it('returns null outside a gallery', async () => {
    expect(await findGalleryRoot(join(dir, 'a'), { stopAt: dir })).toBeNull();
  });
});

describe('addPhotos', () => {
  it('copies, keeps mtimes and sidecars, and skips duplicates by content', async () => {
    const src = join(dir, 'Export', 'Japan 2025');
    await mkdir(src, { recursive: true });
    await mkdir(join(dir, 'gallery', 'photos'), { recursive: true });
    const root = join(dir, 'gallery');
    await writeFile(join(src, 'a.jpg'), await jpeg(200, 30, 30));
    await writeFile(join(src, 'b.jpg'), await jpeg(30, 30, 200));
    await writeFile(join(src, 'a.xmp'), '<x:xmpmeta/>');
    await writeFile(join(src, 'notes.txt'), 'hello');
    const old = new Date('2005-02-27T12:00:00Z');
    await utimes(join(src, 'a.jpg'), old, old);

    const first = await addPhotos(root, [src]);
    expect(first.album).toBe('japan_2025');
    expect(first.added.map((a) => a.to).sort()).toEqual([
      join('photos', 'japan_2025', 'a.jpg'),
      join('photos', 'japan_2025', 'b.jpg'),
    ]);
    expect(first.added.find((a) => a.to.endsWith('a.jpg'))?.sidecars).toEqual([
      join('photos', 'japan_2025', 'a.xmp'),
    ]);
    expect(first.skipped.map((s) => s.reason)).toEqual([
      'not a supported photo format',
    ]);
    const copied = await stat(join(root, 'photos', 'japan_2025', 'a.jpg'));
    expect(copied.mtime.getTime()).toBe(old.getTime());

    // The same folder again: everything is already there.
    const again = await addPhotos(root, [src]);
    expect(again.added).toEqual([]);
    expect(again.duplicates).toHaveLength(2);

    // A copy under another name, into another album, is still a duplicate.
    await copyFile(join(src, 'b.jpg'), join(dir, 'renamed.jpg'));
    const copy = await addPhotos(root, [join(dir, 'renamed.jpg')], {
      album: 'Other',
    });
    expect(copy.duplicates).toEqual([
      {
        from: join(dir, 'renamed.jpg'),
        sameAs: join('photos', 'japan_2025', 'b.jpg'),
      },
    ]);
  });

  it('renames a different photo whose name or photo id is taken', async () => {
    const root = join(dir, 'gallery');
    await mkdir(join(root, 'photos', 'trip'), { recursive: true });
    await writeFile(
      join(root, 'photos', 'trip', 'a.jpg'),
      await jpeg(10, 200, 10)
    );
    const incoming = join(dir, 'in');
    await mkdir(incoming);
    await writeFile(join(incoming, 'a.jpg'), await jpeg(250, 250, 10));
    await writeFile(join(incoming, 'A.JPEG'), await jpeg(10, 250, 250));

    const result = await addPhotos(root, [incoming], { album: 'trip' });
    expect(result.duplicates).toEqual([]);
    expect(result.added.every((a) => a.renamed)).toBe(true);
    expect((await readdir(join(root, 'photos', 'trip'))).sort()).toEqual([
      'A-2.JPEG',
      'a-3.jpg',
      'a.jpg',
    ]);
  });
});

describe('publish and upgrade helpers', () => {
  it('reads the publish method from flags, then package.json, then wrangler.jsonc', async () => {
    expect(await choosePublishMethod(dir, {})).toBe('build');
    await writeFile(join(dir, 'wrangler.jsonc'), '{ "name": "x" }');
    expect(await choosePublishMethod(dir, {})).toBe('deploy');
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ minimalgallery: { publish: 'build' } })
    );
    expect(await choosePublishMethod(dir, {})).toBe('build');
    expect(await choosePublishMethod(dir, { deploy: true })).toBe('deploy');
    await expect(
      choosePublishMethod(dir, { build: true, deploy: true })
    ).rejects.toThrow();
  });

  it('explains that publishing with git is gone', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ minimalgallery: { publish: 'git' } })
    );
    await expect(choosePublishMethod(dir, {})).rejects.toThrow(
      /publishing with git is gone/
    );
  });

  it('detects the package manager and builds upgrade commands', async () => {
    expect(detectPackageManager(dir, 'pnpm/10.20.0 node/v24')).toBe('pnpm');
    await writeFile(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir, 'pnpm/10.20.0')).toBe('npm');
    expect(
      upgradeCommands('pnpm', ['minimalgallery'], ['@minimalgallery/astro'])
    ).toEqual([
      ['pnpm', 'add', 'minimalgallery@latest'],
      ['pnpm', 'add', '-D', '@minimalgallery/astro@latest'],
    ]);
  });
});
