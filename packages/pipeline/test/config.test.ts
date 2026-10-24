import { describe, expect, it } from 'vitest';
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultConfig,
  defineConfig,
  ladderFromConfig,
  loadConfig,
  resolveConfig,
} from '../src/config.ts';
import { defaultLadder, ladderHash } from '../src/ladder.ts';
import { tempGallery, write } from './helpers.ts';

describe('config', () => {
  it('falls back to defaults when there is no config file', async () => {
    const dir = await tempGallery();
    const config = await loadConfig(dir);
    expect(config).toEqual(defaultConfig);
    expect(config).toMatchObject({
      name: 'Photos',
      storage: { mode: 'repo' },
      originals: 'none',
      color: 'srgb',
      defaults: {
        fit: 'fill',
        strip: false,
        crop: 'square',
        view: 'grid',
        size: 2,
        backdrop: 'neutral',
      },
      albums: { sort: 'date' },
    });
    expect(config.ladder.map((v) => v.name)).toEqual([
      'grid',
      'w1280',
      'w2048',
      'w3200',
      'jpeg1600',
    ]);
    // The default config gives the default ladder, so hashes agree.
    expect(await ladderHash(ladderFromConfig(config))).toBe(
      await ladderHash(defaultLadder)
    );
  });

  it('loads a TypeScript config file', async () => {
    const dir = await tempGallery();
    await write(
      join(dir, 'minimalgallery.config.ts'),
      `type Sort = 'date' | 'name' | 'manual';
const sort: Sort = 'name';
export default {
  name: 'Seagull',
  site: 'https://photos.example.com',
  storage: {
    mode: 's3',
    bucket: 'mg',
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    publicUrl: 'https://media.example.com',
  },
  originals: 'bucket',
  color: 'p3',
  ladder: [{ name: 'small', longEdge: 800, format: 'webp', quality: 70 }],
  defaults: { backdrop: 'photo', size: 3 },
  albums: { sort },
} satisfies Record<string, unknown>;
`
    );
    const config = await loadConfig(dir);
    expect(config).toMatchObject({
      name: 'Seagull',
      storage: { mode: 's3', bucket: 'mg', region: 'auto' },
      originals: 'bucket',
      color: 'p3',
      defaults: { backdrop: 'photo', size: 3, fit: 'fill' },
      albums: { sort: 'name' },
    });
    expect(ladderFromConfig(config).variants).toEqual([
      {
        name: 'small',
        longEdge: 800,
        format: 'webp',
        quality: 70,
        chroma: '4:2:0',
      },
    ]);
  });

  it('sees edits to the config file on the next load', async () => {
    const dir = await tempGallery();
    const path = join(dir, 'minimalgallery.config.mjs');
    await write(path, `export default { name: 'One' };`);
    expect((await loadConfig(dir)).name).toBe('One');
    await write(path, `export default { name: 'Two' };`);
    // A distinct mtime, as an editor save would give.
    await utimes(path, new Date(), new Date(Date.now() + 2000));
    expect((await loadConfig(dir)).name).toBe('Two');
  });

  it('reports invalid values with the file and key', async () => {
    const dir = await tempGallery();
    await write(
      join(dir, 'minimalgallery.config.ts'),
      `export default { color: 'cmyk', site: 'not a url' };`
    );
    const error = await loadConfig(dir).catch((e: Error) => e.message);
    expect(error).toMatch(/minimalgallery\.config\.ts:/);
    expect(error).toMatch(/at color/);
    expect(error).toMatch(/at site/);
    expect(() => resolveConfig({ originals: 'bucket' })).toThrow(
      /originals: 'bucket' needs storage/
    );
    expect(() =>
      resolveConfig({
        ladder: [
          { name: 'a', longEdge: 100, format: 'avif', quality: 50 },
          { name: 'a', longEdge: 200, format: 'avif', quality: 50 },
        ],
      })
    ).toThrow(/unique/);
  });

  it('keeps the credit on unless the config turns it off', () => {
    expect(resolveConfig({}).credit).toBe(true);
    expect(resolveConfig({ credit: false }).credit).toBe(false);
  });

  it('defineConfig returns its input', () => {
    const c = { name: 'x' };
    expect(defineConfig(c)).toBe(c);
  });
});
