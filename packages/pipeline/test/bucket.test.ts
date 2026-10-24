import { createHash } from 'node:crypto';
import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveConfig, type GalleryConfig } from '../src/config.ts';
import { processGallery } from '../src/process.ts';
import { MANIFEST_DIR, STAGE_DIR } from '../src/schema.ts';
import {
  BUCKET_INDEX_FILE,
  type BucketStorage,
} from '../src/storage/bucket.ts';
import { checkBucket, formatBucketCheck } from '../src/storage/check.ts';
import { bucketCredentials, MISSING_CREDENTIALS } from '../src/storage/env.ts';
import { storageFromConfig } from '../src/storage/from-config.ts';
import { S3Error } from '../src/storage/s3.ts';
import {
  pendingUploads,
  planBucketSync,
  pruneBucket,
  stagedFiles,
  uploadToBucket,
} from '../src/storage/sync.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';
import { startMockS3, type MockS3 } from './mock-s3.ts';

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false
  );

describe('bucket credentials', () => {
  it('reads the gallery’s .env, and the environment wins', async () => {
    const dir = await tempGallery();
    expect(bucketCredentials(dir, {})).toBeNull();
    await write(
      join(dir, '.env'),
      '# R2 token\nMG_S3_ACCESS_KEY_ID=from-file\nMG_S3_SECRET_ACCESS_KEY="secret # not a comment"\n'
    );
    expect(bucketCredentials(dir, {})).toEqual({
      accessKeyId: 'from-file',
      secretAccessKey: 'secret # not a comment',
    });
    expect(bucketCredentials(dir, { MG_S3_ACCESS_KEY_ID: 'from-env' })).toEqual(
      {
        accessKeyId: 'from-env',
        secretAccessKey: 'secret # not a comment',
      }
    );
    expect(
      bucketCredentials(dir, { MG_S3_ACCESS_KEY_ID: '' })?.accessKeyId
    ).toBe('from-file');
    await write(join(dir, '.env'), 'MG_S3_ACCESS_KEY_ID=only-one\n');
    expect(bucketCredentials(dir, {})).toBeNull();
    expect(MISSING_CREDENTIALS).toContain('MG_S3_SECRET_ACCESS_KEY');
  });
});

describe('bucket mode with the mock', () => {
  let mock: MockS3;
  let dir: string;
  let config: GalleryConfig;
  const env = () => ({
    MG_S3_ACCESS_KEY_ID: mock.accessKeyId,
    MG_S3_SECRET_ACCESS_KEY: mock.secretAccessKey,
  });
  const configFor = (extra: object = {}, endpoint = mock.endpoint) =>
    resolveConfig({
      storage: {
        mode: 's3',
        bucket: mock.bucket,
        endpoint,
        publicUrl: mock.publicUrl,
      },
      ...extra,
    });

  beforeEach(async () => {
    mock = await startMockS3();
    dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/trips/a.jpg'), { color: '#c33' });
    await writeJpeg(join(dir, 'photos/trips/b.jpg'), { color: '#33c' });
    config = configFor();
  });
  afterEach(async () => {
    await mock.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('stages writes and answers has from the stage, the record, then the bucket', async () => {
    const offlineStorage = storageFromConfig(config, dir, {}) as BucketStorage;
    expect(offlineStorage.remote).toBeNull();
    await offlineStorage.put(
      'x__y/0123abcd-grid.avif',
      new Uint8Array([1]),
      'image/avif'
    );
    expect(await exists(join(dir, STAGE_DIR, 'x__y/0123abcd-grid.avif'))).toBe(
      true
    );
    expect(offlineStorage.url('x__y/0123abcd-grid.avif')).toBe(
      `${mock.publicUrl}/x__y/0123abcd-grid.avif`
    );
    expect(await offlineStorage.has('x__y/0123abcd-grid.avif')).toBe(true);
    expect(await offlineStorage.has('in__bucket/0123abcd-grid.avif')).toBe(
      false
    );
    expect(mock.requests).toHaveLength(0);

    mock.objects.set('in__bucket/0123abcd-grid.avif', {
      body: Buffer.from('x'),
      contentType: 'image/avif',
      cacheControl: null,
      etag: 'x',
    });
    const online = storageFromConfig(config, dir, env()) as BucketStorage;
    expect(await online.has('in__bucket/0123abcd-grid.avif')).toBe(true);
    expect(await online.has('other__key/0123abcd-grid.avif')).toBe(false);
    expect(mock.requests).toHaveLength(1);
    expect(await exists(join(dir, BUCKET_INDEX_FILE))).toBe(true);
    // The saved record answers the next instance, even without credentials.
    const later = storageFromConfig(config, dir, {}) as BucketStorage;
    expect(await later.has('in__bucket/0123abcd-grid.avif')).toBe(true);
    expect(mock.requests).toHaveLength(1);
    // list and remove touch the stage only.
    expect(await online.list('')).toEqual(['x__y/0123abcd-grid.avif']);
    await online.remove('in__bucket/0123abcd-grid.avif');
    expect(mock.objects.size).toBe(1);
  });

  it('works offline when the bucket cannot be reached, and fails loudly on bad credentials', async () => {
    const closed = await startMockS3();
    await closed.close();
    const unreachable = configFor({}, closed.endpoint);
    const s = storageFromConfig(unreachable, dir, env()) as BucketStorage;
    expect(await s.has('a__b/0123abcd-grid.avif')).toBe(false);
    expect(s.offline()).toBeInstanceOf(S3Error);
    expect(s.offline()?.code).toBe('NetworkError');

    const wrong = storageFromConfig(config, dir, {
      ...env(),
      MG_S3_SECRET_ACCESS_KEY: 'wrong',
    });
    await expect(wrong.has('a__b/0123abcd-grid.avif')).rejects.toMatchObject({
      code: 'SignatureDoesNotMatch',
    });
  });

  it('keeps originals in public/_mg with originals: repo', async () => {
    const repoOriginals = configFor({ originals: 'repo' });
    await processGallery(dir, { config: repoOriginals });
    const staged = [...(await stagedFiles(dir)).keys()];
    expect(staged).toHaveLength(4);
    expect(staged.some((k) => k.includes('-original'))).toBe(false);
    const m = JSON.parse(
      await readFile(join(dir, MANIFEST_DIR, 'trips__a.json'), 'utf8')
    );
    expect(m.original.url).toBe(`/_mg/${m.original.key}`);
    expect(await exists(join(dir, 'public/_mg', m.original.key))).toBe(true);
    expect((await pendingUploads(dir, { config: repoOriginals })).files).toBe(
      4
    );
  });

  it('stops at the first failed upload, records the rest, and continues on the next run', async () => {
    await processGallery(dir, { config });
    const err = await uploadToBucket(dir, {
      config,
      env: env(),
      concurrency: 1,
      onProgress: (p) => {
        if (p.done === 2) mock.fail(1, 403);
      },
    }).catch((e) => e);
    expect(err.name).toBe('BucketError');
    expect(err.code).toBe('upload-failed');
    expect(err.cause).toBeInstanceOf(S3Error);
    expect(err.message).toContain('MG_S3_ACCESS_KEY_ID');
    expect(err.message).toContain('2 of 4 file(s) were uploaded');
    expect(mock.objects.size).toBe(2);
    expect((await stagedFiles(dir)).size).toBe(2);
    const record = JSON.parse(
      await readFile(join(dir, BUCKET_INDEX_FILE), 'utf8')
    );
    expect(record.keys).toEqual([...mock.objects.keys()].sort());

    const again = await uploadToBucket(dir, { config, env: env() });
    expect(again.uploaded).toHaveLength(2);
    expect(mock.objects.size).toBe(4);
    expect((await stagedFiles(dir)).size).toBe(0);
  });

  it('clears identical staged copies and uploads changed ones again', async () => {
    await processGallery(dir, { config });
    const keys = [...(await stagedFiles(dir)).keys()].sort();
    for (const key of keys) {
      // The AVIF copies in the bucket are identical; the JPEGs are older encodes.
      const staged = await readFile(join(dir, STAGE_DIR, key));
      const body = key.endsWith('.avif')
        ? staged
        : Buffer.from('an older encode');
      mock.objects.set(key, {
        body,
        contentType: null,
        cacheControl: null,
        etag: createHash('md5').update(body).digest('hex'),
      });
    }
    const plan = await planBucketSync(dir, { config, env: env() });
    expect(plan.alreadyUploaded).toEqual(
      keys.filter((k) => k.endsWith('.avif'))
    );
    expect(plan.upload).toEqual(keys.filter((k) => k.endsWith('.jpg')));
    const up = await uploadToBucket(dir, { config, env: env() });
    expect(up.uploaded).toEqual(plan.upload);
    expect(up.alreadyUploaded).toEqual(plan.alreadyUploaded);
    expect((await stagedFiles(dir)).size).toBe(0);
    for (const k of plan.upload)
      expect(mock.objects.get(k)?.body.toString()).not.toBe('an older encode');
  });

  it('reports missing keys and refuses to prune without readable manifests', async () => {
    await processGallery(dir, { config });
    await uploadToBucket(dir, { config, env: env() });
    const gone = [...mock.objects.keys()][0];
    mock.objects.delete(gone);
    mock.objects.set('unrelated/file.txt', {
      body: Buffer.from('not ours'),
      contentType: null,
      cacheControl: null,
      etag: 'x',
    });
    const plan = await planBucketSync(dir, { config, env: env() });
    expect(plan.missing).toEqual([gone]);
    expect(plan.orphans).toEqual([]); // keys of another shape are left alone
    // The refreshed record makes the next run encode the missing file again.
    const r = await processGallery(dir, { config });
    expect(r.encoded).toBe(1);
    // The photo’s other variant is staged again too, identical to the
    // bucket’s copy: the upload sends only the missing one.
    const pending = (await pendingUploads(dir, { config })).keys;
    expect(pending).toContain(gone);
    expect(pending).toHaveLength(2);
    const up = await uploadToBucket(dir, { config, env: env() });
    expect(up.uploaded).toEqual([gone]);
    expect(up.alreadyUploaded).toEqual(pending.filter((k) => k !== gone));

    await write(join(dir, MANIFEST_DIR, 'trips__b.json'), '{ broken');
    await expect(
      pruneBucket(dir, { config, env: env() })
    ).rejects.toMatchObject({ code: 'unreadable-manifests' });
    await rm(join(dir, MANIFEST_DIR), { recursive: true });
    await expect(
      pruneBucket(dir, { config, env: env() })
    ).rejects.toMatchObject({ code: 'no-manifests' });
    expect(mock.objects.has('unrelated/file.txt')).toBe(true);
  });

  it('checkBucket reports a bucket that is not public, and missing credentials', async () => {
    mock.publicRead = false;
    const check = await checkBucket(dir, { config, env: env() });
    expect(check.ok).toBe(false);
    const byStep = Object.fromEntries(check.steps.map((s) => [s.step, s]));
    expect(byStep.put.ok && byStep.list.ok && byStep.has.ok).toBe(true);
    expect(byStep.public.ok).toBe(false);
    expect(byStep.public.message).toContain('403');
    expect(byStep.public.message).toContain('not publicly readable');
    expect(byStep.remove.ok).toBe(true);
    expect(mock.objects.size).toBe(0);
    expect(formatBucketCheck(check)).toContain('The bucket check failed.');

    const none = await checkBucket(dir, { config, env: {} });
    expect(none.ok).toBe(false);
    expect(none.steps).toEqual([
      expect.objectContaining({
        step: 'credentials',
        ok: false,
        message: MISSING_CREDENTIALS,
      }),
    ]);
  });

  it('refuses remote operations in repo mode', async () => {
    await expect(
      planBucketSync(dir, { config: resolveConfig({}) })
    ).rejects.toMatchObject({ code: 'not-bucket-mode' });
    expect(await pendingUploads(dir, { config: resolveConfig({}) })).toEqual({
      files: 0,
      bytes: 0,
      keys: [],
    });
  });
});
