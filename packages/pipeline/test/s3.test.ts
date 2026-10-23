import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CACHE_CONTROL, S3Error, s3Storage } from '../src/storage/s3.ts';
import { startMockS3, type MockS3 } from './mock-s3.ts';
import { targets, type TestBucket } from './s3-targets.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

describe.each(targets)('s3Storage against $name', (target) => {
  let b: TestBucket;
  beforeEach(async () => {
    b = await target.setup();
  });
  afterEach(async () => {
    await b.close();
  });
  const storage = (extra: Partial<Parameters<typeof s3Storage>[0]> = {}) =>
    s3Storage({
      endpoint: b.endpoint,
      bucket: b.bucket,
      region: b.region,
      accessKeyId: b.accessKeyId,
      secretAccessKey: b.secretAccessKey,
      publicUrl: 'https://media.example.com/',
      retryDelay: 1,
      ...extra,
    });

  it('puts, lists, checks and removes objects with the immutable headers', async () => {
    const s = storage();
    await s.put('trips__a/0123abcd-grid.avif', bytes('avif'), 'image/avif');
    await s.put('trips__a/0123abcd-jpeg1600.jpg', bytes('jpeg!'), 'image/jpeg');
    expect(await s.has('trips__a/0123abcd-grid.avif')).toBe(true);
    expect(await s.has('trips__a/missing.avif')).toBe(false);
    expect(await s.list('trips__a/')).toEqual([
      'trips__a/0123abcd-grid.avif',
      'trips__a/0123abcd-jpeg1600.jpg',
    ]);
    const stored = await b.objects();
    expect(stored.get('trips__a/0123abcd-grid.avif')).toEqual({
      size: 4,
      contentType: 'image/avif',
      cacheControl: CACHE_CONTROL,
    });
    expect(stored.get('trips__a/0123abcd-jpeg1600.jpg')?.contentType).toBe(
      'image/jpeg'
    );
    await s.remove('trips__a/0123abcd-grid.avif');
    await s.remove('trips__a/never-there.avif'); // a missing key is fine
    expect(await s.list('trips__a/')).toEqual([
      'trips__a/0123abcd-jpeg1600.jpg',
    ]);
    expect([...(await b.objects()).keys()]).toEqual([
      'trips__a/0123abcd-jpeg1600.jpg',
    ]);
    expect(s.url('trips__a/x.avif')).toBe(
      'https://media.example.com/trips__a/x.avif'
    );
  });

  it('signs keys with spaces, non-ASCII characters and reserved marks', async () => {
    const s = storage();
    const keys = [
      'album/naïve file.jpg',
      'album/東京 (1)+2!.avif',
      "album/it's ~ 100% *.txt",
      'album/ leading and trailing ',
    ];
    for (const k of keys) await s.put(k, bytes(k), 'text/plain');
    // A fresh instance lists the bucket again: the keys come back intact.
    const fresh = storage();
    expect(await fresh.list('album/')).toEqual([...keys].sort());
    for (const k of keys) expect(await fresh.head(k)).not.toBeNull();
    expect([...(await b.objects()).keys()].sort()).toEqual([...keys].sort());
    for (const k of keys) await fresh.remove(k);
    expect((await b.objects()).size).toBe(0);
  });

  it('pages the listing with continuation tokens', async () => {
    const s = storage({ pageSize: 2 });
    const keys = Array.from({ length: 7 }, (_, i) => `p__x/0000000${i}-v.avif`);
    for (const k of keys) await s.put(k, bytes(k), 'image/avif');
    const listed = await storage({ pageSize: 2 }).listObjects();
    expect(listed.map((o) => o.key)).toEqual(keys);
    expect(listed[0].size).toBe(keys[0].length);
    expect(listed[0].etag).toMatch(/^[0-9a-f]{32}$/);
    if (b.mock) {
      const lists = b.mock.requests.filter((r) => r.query['list-type']);
      expect(lists).toHaveLength(4);
      expect(lists[0].query['max-keys']).toBe('2');
      expect(lists[1].query['continuation-token']).toBeTruthy();
    }
  });

  it('names the credential variables when the secret is wrong', async () => {
    const s = storage({ secretAccessKey: 'not-the-secret' });
    const err = await s
      .put('k/x.txt', bytes('x'), 'text/plain')
      .catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.status).toBe(403);
    expect(err.code).toBe('SignatureDoesNotMatch');
    expect(err.credentials).toBe(true);
    expect(err.message).toContain('MG_S3_ACCESS_KEY_ID');
    expect(err.message).toContain('MG_S3_SECRET_ACCESS_KEY');
    expect(err.message).toContain('PUT k/x.txt');
  });

  it('says to check the bucket name when it does not exist', async () => {
    const s = storage({ bucket: `${b.bucket}-nope` });
    const err = await s.has('k').catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.code).toBe('NoSuchBucket');
    expect(err.message).toContain('storage.bucket');
  });
});

describe('s3Storage against the mock only', () => {
  let mock: MockS3;
  beforeEach(async () => {
    mock = await startMockS3();
  });
  afterEach(async () => {
    await mock.close();
  });
  const storage = (extra: Partial<Parameters<typeof s3Storage>[0]> = {}) =>
    s3Storage({
      endpoint: mock.endpoint,
      bucket: mock.bucket,
      accessKeyId: mock.accessKeyId,
      secretAccessKey: mock.secretAccessKey,
      publicUrl: mock.publicUrl,
      retryDelay: 1,
      ...extra,
    });

  it('signs every request with SigV4, the key id and a payload hash', async () => {
    const seen: Request[] = [];
    const s = storage({
      fetch: (input, init) => {
        seen.push(input as Request);
        return fetch(input, init);
      },
    });
    await s.put('a/b.txt', bytes('hello'), 'text/plain');
    await s.has('a/b.txt');
    await s.head('a/b.txt');
    await s.remove('a/b.txt');
    expect(seen.map((r) => r.method)).toEqual(['PUT', 'GET', 'HEAD', 'DELETE']);
    for (const r of seen) {
      expect(r.headers.get('authorization')).toMatch(
        new RegExp(
          `^AWS4-HMAC-SHA256 Credential=${mock.accessKeyId}/\\d{8}/auto/s3/aws4_request, SignedHeaders=[^,]*x-amz-content-sha256`
        )
      );
      expect(r.headers.get('x-amz-content-sha256')).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(mock.requests.every((r) => r.signed && r.status < 300)).toBe(true);
  });

  it('lists the bucket once and keeps the listing current', async () => {
    const s = storage();
    await s.put('a/1.txt', bytes('1'), 'text/plain');
    expect(await s.has('a/1.txt')).toBe(true);
    await s.put('a/2.txt', bytes('2'), 'text/plain');
    await s.remove('a/1.txt');
    expect(await s.has('a/2.txt')).toBe(true);
    expect(await s.has('a/1.txt')).toBe(false);
    expect(await s.list('')).toEqual(['a/2.txt']);
    expect(mock.requests.filter((r) => r.query['list-type'])).toHaveLength(1);
    s.refresh();
    expect(await s.list('a/')).toEqual(['a/2.txt']);
    expect(mock.requests.filter((r) => r.query['list-type'])).toHaveLength(2);
  });

  it('retries 503, 429 and reset connections, then succeeds', async () => {
    const s = storage();
    mock.fail(1, 503);
    mock.fail(1, 429);
    mock.fail(1, 'reset');
    await s.put('a/x.txt', bytes('x'), 'text/plain');
    expect(mock.objects.has('a/x.txt')).toBe(true);
    expect(mock.requests.map((r) => r.status)).toEqual([503, 429, 0, 200]);
  });

  it('gives up after the retries with the S3 code and message', async () => {
    const s = storage({ retries: 2 });
    mock.fail(5, 500);
    const err = await s
      .put('a/x.txt', bytes('x'), 'text/plain')
      .catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.status).toBe(500);
    expect(err.code).toBe('InternalError');
    expect(err.message).toContain('We encountered an internal error');
    expect(mock.requests).toHaveLength(3);
  });

  it('does not retry a 403 and names the key id variable', async () => {
    const s = storage({ accessKeyId: 'WRONG' });
    const err = await s.has('a').catch((e) => e);
    expect(err.code).toBe('InvalidAccessKeyId');
    expect(err.message).toContain('MG_S3_ACCESS_KEY_ID');
    expect(mock.requests).toHaveLength(1);
  });

  it('points at storage.region when the region is wrong', async () => {
    const err = await storage({ region: 'us-east-1' })
      .has('a')
      .catch((e) => e);
    expect(err.code).toBe('AuthorizationHeaderMalformed');
    expect(err.message).toContain('storage.region');
  });

  it('reports an unreachable endpoint as a network error', async () => {
    const closed = await startMockS3();
    await closed.close();
    const s = s3Storage({
      endpoint: closed.endpoint,
      bucket: 'photos',
      accessKeyId: 'k',
      secretAccessKey: 's',
      publicUrl: 'https://media.example.com',
      retries: 1,
      retryDelay: 1,
    });
    const err = await s.has('a').catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.status).toBe(0);
    expect(err.code).toBe('NetworkError');
    expect(err.message).toContain('ECONNREFUSED');
    expect(err.message).toContain('2 attempt(s)');
  });
});
