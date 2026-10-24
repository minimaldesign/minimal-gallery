/**
 * Bucket mode with the real pipeline, against the mock S3 server and, when
 * the `MG_TEST_S3_*` variables are set, a real one (see `s3-targets.ts`).
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig, type GalleryConfigInput } from '../src/config.ts';
import { doctor } from '../src/doctor.ts';
import { processGallery } from '../src/process.ts';
import { MANIFEST_DIR, type PhotoManifest } from '../src/schema.ts';
import { BUCKET_INDEX_FILE } from '../src/storage/bucket.ts';
import { checkBucket } from '../src/storage/check.ts';
import { CACHE_CONTROL } from '../src/storage/s3.ts';
import {
  pendingUploads,
  planBucketSync,
  pruneBucket,
  stagedFiles,
  uploadToBucket,
  type UploadProgress,
} from '../src/storage/sync.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';
import { targets, type TestBucket } from './s3-targets.ts';

const manifest = async (dir: string, id: string): Promise<PhotoManifest> =>
  JSON.parse(await readFile(join(dir, MANIFEST_DIR, `${id}.json`), 'utf8'));

describe.each(targets)('bucket mode end to end against $name', (target) => {
  let b: TestBucket;
  let dir: string;
  let input: GalleryConfigInput;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    b = await target.setup();
    dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/trips/a.jpg'), { color: '#c33' });
    await writeJpeg(join(dir, 'photos/trips/b.jpg'), { color: '#33c' });
    await writeJpeg(join(dir, 'photos/trips/c.jpg'), { color: '#cc3' });
    input = {
      storage: {
        mode: 's3',
        bucket: b.bucket,
        endpoint: b.endpoint,
        region: b.region,
        publicUrl: b.publicUrl,
      },
    };
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await b.close();
    await rm(dir, { recursive: true, force: true });
  });
  const addCredentials = () =>
    write(
      join(dir, '.env'),
      `MG_S3_ACCESS_KEY_ID=${b.accessKeyId}\nMG_S3_SECRET_ACCESS_KEY="${b.secretAccessKey}"\n`
    );

  it('stages offline, uploads, skips, then prunes locally and in the bucket', async () => {
    const config = resolveConfig(input);

    // Without credentials: everything lands in the stage, nothing is sent.
    const first = await processGallery(dir, { config });
    expect(first.encoded).toBe(3);
    expect(first.errors).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    const staged = await stagedFiles(dir);
    expect(staged.size).toBe(6); // grid and jpeg1600 for each photo
    const a = await manifest(dir, 'trips__a');
    for (const v of a.variants) {
      expect(v.url).toBe(`${b.publicUrl}/${v.key}`);
      expect(staged.has(v.key)).toBe(true);
    }
    expect((await b.objects()).size).toBe(0);
    const pending = await pendingUploads(dir, { config });
    expect(pending.files).toBe(6);
    const report = await doctor(dir, { config });
    expect(report.bucket).toEqual({
      staged: 6,
      stagedBytes: pending.bytes,
      credentials: false,
    });
    expect(report.pages.mediaFiles).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(uploadToBucket(dir, { config })).rejects.toMatchObject({
      name: 'BucketError',
      code: 'missing-credentials',
    });

    // With credentials in .env: upload moves the stage to the bucket.
    await addCredentials();
    const progress: UploadProgress[] = [];
    const up = await uploadToBucket(dir, {
      config,
      onProgress: (p) => progress.push(p),
    });
    expect(up.uploaded).toEqual([...staged.keys()].sort());
    expect(up.bytes).toBe(pending.bytes);
    expect(progress).toHaveLength(6);
    expect(progress.at(-1)).toMatchObject({
      done: 6,
      total: 6,
      doneBytes: pending.bytes,
      totalBytes: pending.bytes,
    });
    const objects = await b.objects();
    expect([...objects.keys()].sort()).toEqual([...staged.keys()].sort());
    for (const [key, o] of objects) {
      expect(o.size).toBe(staged.get(key));
      expect(o.cacheControl).toBe(CACHE_CONTROL);
      expect(o.contentType).toBe(
        key.endsWith('.avif') ? 'image/avif' : 'image/jpeg'
      );
    }
    expect((await stagedFiles(dir)).size).toBe(0);
    expect((await pendingUploads(dir, { config })).files).toBe(0);

    // A second run skips everything, from the local record, offline.
    fetchSpy.mockClear();
    const second = await processGallery(dir, { config });
    expect(second.skipped).toBe(3);
    expect(second.encoded + second.metadataOnly).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    // A fresh clone has neither stage nor record: one listing, still skipped.
    await rm(join(dir, BUCKET_INDEX_FILE));
    const third = await processGallery(dir, { config });
    expect(third.skipped).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Delete an uploaded photo and a staged one, run with prune: the stage
    // and the manifests are cleaned, the bucket is untouched.
    await writeJpeg(join(dir, 'photos/trips/d.jpg'), { color: '#3c3' });
    await processGallery(dir, { config });
    expect([...(await stagedFiles(dir)).keys()]).toHaveLength(2);
    await rm(join(dir, 'photos/trips/a.jpg'));
    await rm(join(dir, 'photos/trips/d.jpg'));
    fetchSpy.mockClear();
    const pruned = await processGallery(dir, { config, prune: true });
    expect(pruned.pruned.ids).toEqual(['trips__a', 'trips__d']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await stagedFiles(dir)).size).toBe(0);
    expect([...(await b.objects()).keys()].sort()).toEqual(
      [...objects.keys()].sort()
    );

    // The bucket keys of the deleted photo are orphans; pruneBucket removes them.
    const plan = await planBucketSync(dir, { config });
    const aKeys = a.variants.map((v) => v.key).sort();
    expect(plan.orphans).toEqual(aKeys);
    expect(plan.upload).toEqual([]);
    expect(plan.missing).toEqual([]);
    expect(plan.inBucket).toHaveLength(4);
    const dry = await pruneBucket(dir, { config, dryRun: true });
    expect(dry).toMatchObject({ removed: aKeys, dryRun: true });
    expect((await b.objects()).size).toBe(6);
    const done = await pruneBucket(dir, { config });
    expect(done.removed).toEqual(aKeys);
    const left = [...(await b.objects()).keys()];
    expect(left).toHaveLength(4);
    expect(left.some((k) => k.startsWith('trips__a/'))).toBe(false);
    expect((await planBucketSync(dir, { config })).orphans).toEqual([]);
  });

  it('uploads originals, and a new publicUrl rewrites URLs without encoding', async () => {
    await addCredentials();
    await processGallery(dir, { config: resolveConfig(input) });
    await uploadToBucket(dir, { config: resolveConfig(input) });

    const withOriginals = resolveConfig({ ...input, originals: 'bucket' });
    const r = await processGallery(dir, { config: withOriginals });
    expect(r.encoded).toBe(0);
    expect(r.metadataOnly).toBe(3);
    const staged = [...(await stagedFiles(dir)).keys()].sort();
    expect(staged).toHaveLength(3);
    for (const k of staged)
      expect(k).toMatch(/^trips__[abc]\/[0-9a-f]{8}-original\.jpg$/);
    const up = await uploadToBucket(dir, { config: withOriginals });
    expect(up.uploaded).toEqual(staged);
    const objects = await b.objects();
    const a = await manifest(dir, 'trips__a');
    const source = await readFile(join(dir, 'photos/trips/a.jpg'));
    expect(a.original.url).toBe(`${b.publicUrl}/${a.original.key}`);
    expect(objects.get(a.original.key!)).toEqual({
      size: source.byteLength,
      contentType: 'image/jpeg',
      cacheControl: CACHE_CONTROL,
    });

    const moved = resolveConfig({
      ...input,
      originals: 'bucket',
      storage: {
        ...(input.storage as object),
        publicUrl: 'https://media.example.org/photos/',
      } as GalleryConfigInput['storage'],
    });
    fetchSpy.mockClear();
    const r2 = await processGallery(dir, { config: moved });
    expect(r2.metadataOnly).toBe(3);
    expect(r2.encoded).toBe(0);
    expect(r2.filesWritten).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const a2 = await manifest(dir, 'trips__a');
    for (const v of a2.variants)
      expect(v.url).toBe(`https://media.example.org/photos/${v.key}`);
    expect(a2.original.url).toBe(
      `https://media.example.org/photos/${a2.original.key}`
    );
    expect((await stagedFiles(dir)).size).toBe(0);
  });

  it('checks the bucket with a probe, through publicUrl', async () => {
    await addCredentials();
    const check = await checkBucket(dir, { config: resolveConfig(input) });
    expect(check.steps.map((s) => [s.step, s.ok])).toEqual([
      ['credentials', true],
      ['put', true],
      ['list', true],
      ['has', true],
      ['public', true],
      ['remove', true],
    ]);
    expect(check.ok).toBe(true);
    expect(check.public).toMatchObject({ status: 200 });
    expect(check.public?.cacheControl).toContain('immutable');
    expect((await b.objects()).size).toBe(0);
  });
});
