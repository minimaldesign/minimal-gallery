/**
 * Buckets the S3 tests run against: always the in-process mock, plus a real
 * S3-compatible server (MinIO) when `MG_TEST_S3_ENDPOINT`,
 * `MG_TEST_S3_ACCESS_KEY_ID` and `MG_TEST_S3_SECRET_ACCESS_KEY` are set.
 * Each `setup()` gives a fresh, empty, publicly readable bucket; for MinIO
 * it is created through the S3 API and deleted by `close()`.
 *
 *   MG_TEST_S3_ENDPOINT=http://localhost:4430 \
 *   MG_TEST_S3_ACCESS_KEY_ID=mgtest MG_TEST_S3_SECRET_ACCESS_KEY=mgtest-secret-123 \
 *   pnpm --filter @minimalgallery/pipeline test
 */
import { randomBytes } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { s3Storage } from '../src/storage/s3.ts';
import { startMockS3, type MockS3 } from './mock-s3.ts';

export interface StoredObject {
  size: number;
  contentType: string | null;
  cacheControl: string | null;
}

export interface TestBucket {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  /** Only for the mock. */
  mock?: MockS3;
  /** Every object in the bucket, read without the code under test’s cache. */
  objects(): Promise<Map<string, StoredObject>>;
  close(): Promise<void>;
}

export interface Target {
  name: string;
  setup(): Promise<TestBucket>;
}

const mockTarget: Target = {
  name: 'mock',
  async setup() {
    const mock = await startMockS3();
    return {
      endpoint: mock.endpoint,
      bucket: mock.bucket,
      region: mock.region,
      accessKeyId: mock.accessKeyId,
      secretAccessKey: mock.secretAccessKey,
      publicUrl: mock.publicUrl,
      mock,
      async objects() {
        return new Map(
          [...mock.objects].map(([k, o]) => [
            k,
            {
              size: o.body.length,
              contentType: o.contentType,
              cacheControl: o.cacheControl,
            },
          ])
        );
      },
      close: () => mock.close(),
    };
  },
};

const env = process.env;
export const realS3 = env.MG_TEST_S3_ENDPOINT
  ? {
      endpoint: env.MG_TEST_S3_ENDPOINT.replace(/\/+$/, ''),
      accessKeyId: env.MG_TEST_S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.MG_TEST_S3_SECRET_ACCESS_KEY ?? '',
      region: env.MG_TEST_S3_REGION ?? 'auto',
    }
  : null;

const realTarget: Target = {
  name: 'minio',
  async setup() {
    const r = realS3!;
    const bucket = `mg-test-${randomBytes(4).toString('hex')}`;
    const aws = new AwsClient({
      accessKeyId: r.accessKeyId,
      secretAccessKey: r.secretAccessKey,
      service: 's3',
      region: r.region,
      retries: 0,
    });
    const call = async (method: string, path: string, body?: string) => {
      const res = await fetch(
        await aws.sign(`${r.endpoint}/${path}`, { method, body })
      );
      if (!res.ok)
        throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    };
    await call('PUT', bucket);
    await call(
      'PUT',
      `${bucket}?policy`,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      })
    );
    const admin = s3Storage({ ...r, bucket, publicUrl: '' });
    return {
      ...r,
      bucket,
      publicUrl: `${r.endpoint}/${bucket}`,
      async objects() {
        const out = new Map<string, StoredObject>();
        for (const o of await admin.listObjects()) {
          const h = await admin.head(o.key);
          out.set(o.key, {
            size: o.size,
            contentType: h?.contentType ?? null,
            cacheControl: h?.cacheControl ?? null,
          });
        }
        return out;
      },
      async close() {
        for (const o of await admin.listObjects()) await admin.remove(o.key);
        await call('DELETE', bucket);
      },
    };
  },
};

export const targets: Target[] = [mockTarget, ...(realS3 ? [realTarget] : [])];
