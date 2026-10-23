import { describe, expect, it } from 'vitest';
import { readdir, readFile, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveConfig } from '../src/config.ts';
import { processGallery } from '../src/process.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';

describe('incremental processing', () => {
  it('skips, re-reads metadata, re-encodes and prunes as needed', async () => {
    const dir = await tempGallery();
    const photo = join(dir, 'photos/album/one.jpg');
    await writeJpeg(photo);
    await writeJpeg(join(dir, 'photos/album/two.jpg'));
    const opts = { concurrency: 2 };

    const first = await processGallery(dir, opts);
    expect(first.encoded).toBe(2);
    expect(first.filesWritten).toBe(4);

    const second = await processGallery(dir, opts);
    expect(second.skipped).toBe(2);
    expect(second.filesWritten).toBe(0);
    expect(second.manifestsWritten).toBe(0);

    // Sidecar edit: manifest rewritten, nothing encoded.
    await write(
      join(dir, 'photos/album/one.md'),
      '---\ntitle: New title\n---\n'
    );
    const third = await processGallery(dir, opts);
    expect(third.metadataOnly).toBe(1);
    expect(third.encoded).toBe(0);
    expect(third.filesWritten).toBe(0);
    const m = JSON.parse(
      await readFile(
        join(dir, '.minimalgallery/manifest/album__one.json'),
        'utf8'
      )
    );
    expect(m.title).toBe('New title');

    // Touched but identical file: content hash matches, no encode.
    await utimes(photo, new Date(), new Date(Date.now() + 5000));
    const fourth = await processGallery(dir, opts);
    expect(fourth.metadataOnly).toBe(1);
    expect(fourth.encoded).toBe(0);

    // New pixels: re-encoded, old derivatives removed.
    await writeJpeg(photo, { color: '#3c3' });
    const fifth = await processGallery(dir, opts);
    expect(fifth.encoded).toBe(1);
    const files = await readdir(join(dir, 'public/_mg/album__one'));
    expect(files).toHaveLength(2);
    expect(new Set(files.map((f) => f.slice(0, 8))).size).toBe(1);

    // Deleted photo: reported as orphan, removed with prune.
    await rm(join(dir, 'photos/album/two.jpg'));
    const sixth = await processGallery(dir, opts);
    expect(sixth.orphans).toEqual(['album__two']);
    const seventh = await processGallery(dir, { ...opts, prune: true });
    expect(seventh.pruned).toMatchObject({
      ids: ['album__two'],
      manifests: 1,
      files: 2,
    });
    await expect(readdir(join(dir, 'public/_mg/album__two'))).rejects.toThrow();
  });

  it('gives new keys when the ladder changes, so cached copies are never stale', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/album/one.jpg'));
    const keys = async () =>
      JSON.parse(
        await readFile(
          join(dir, '.minimalgallery/manifest/album__one.json'),
          'utf8'
        )
      ).variants.map((v: { key: string }) => v.key);

    await processGallery(dir);
    const before = await keys();
    const p3 = await processGallery(dir, {
      config: resolveConfig({ color: 'p3' }),
    });
    expect(p3.encoded).toBe(1);
    const after = await keys();
    expect(after).toHaveLength(before.length);
    for (const key of after) expect(before).not.toContain(key);
    expect(await readdir(join(dir, 'public/_mg/album__one'))).toHaveLength(
      after.length
    );
  });
});
