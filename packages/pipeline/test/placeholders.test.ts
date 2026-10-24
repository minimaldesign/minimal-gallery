import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.ts';
import { doctor } from '../src/doctor.ts';
import {
  ACCOUNT_ID_PLACEHOLDER,
  configPlaceholders,
  placeholderMessage,
  PUBLIC_URL_PLACEHOLDER,
} from '../src/placeholders.ts';
import type { BucketStorage } from '../src/storage/bucket.ts';
import { checkBucket } from '../src/storage/check.ts';
import { storageFromConfig } from '../src/storage/from-config.ts';
import {
  planBucketSync,
  pruneBucket,
  uploadToBucket,
} from '../src/storage/sync.ts';
import { tempGallery } from './helpers.ts';

const bucketConfig = (storage: object = {}) =>
  resolveConfig({
    storage: {
      mode: 's3',
      bucket: 'photos',
      endpoint: 'https://0123abcd.r2.cloudflarestorage.com',
      publicUrl: 'https://media.photos.test',
      ...storage,
    },
  });
const standInEndpoint = `https://${ACCOUNT_ID_PLACEHOLDER}.r2.cloudflarestorage.com`;
const env = { MG_S3_ACCESS_KEY_ID: 'key', MG_S3_SECRET_ACCESS_KEY: 'secret' };

describe('scaffold stand-ins', () => {
  it('finds the stand-ins the scaffold writes, and nothing in real values', () => {
    expect(configPlaceholders(bucketConfig())).toEqual([]);
    expect(configPlaceholders(resolveConfig({}))).toEqual([]);
    const both = configPlaceholders(
      bucketConfig({
        endpoint: standInEndpoint,
        publicUrl: PUBLIC_URL_PLACEHOLDER,
      })
    );
    expect(both.map((p) => p.key)).toEqual([
      'storage.endpoint',
      'storage.publicUrl',
    ]);
    // Edited around the stand-in, it is still the stand-in.
    expect(
      configPlaceholders(
        bucketConfig({ publicUrl: `${PUBLIC_URL_PLACEHOLDER}/photos/` })
      ).map((p) => p.key)
    ).toEqual(['storage.publicUrl']);

    const message = placeholderMessage(both);
    expect(message).toMatch(
      /^minimalgallery\.config\.ts still holds stand-in values/
    );
    expect(message).toContain(
      `storage.endpoint: replace ${ACCOUNT_ID_PLACEHOLDER} with your Cloudflare account id, which npx wrangler whoami prints.`
    );
    expect(message).toContain(
      `storage.publicUrl: replace ${PUBLIC_URL_PLACEHOLDER} with the address of the custom domain connected to the bucket`
    );
  });

  it('keeps every remote operation from starting', async () => {
    const dir = await tempGallery();
    let requests = 0;
    const fetch = (async () => {
      requests++;
      return new Response('');
    }) as typeof globalThis.fetch;
    for (const config of [
      bucketConfig({ endpoint: standInEndpoint }),
      bucketConfig({ publicUrl: PUBLIC_URL_PLACEHOLDER }),
    ])
      for (const run of [
        uploadToBucket,
        pruneBucket,
        planBucketSync,
        checkBucket,
      ]) {
        const err = await run(dir, { config, env, fetch }).catch((e) => e);
        expect(err.name).toBe('BucketError');
        expect(err.code).toBe('placeholder');
        expect(err.message).toContain(configPlaceholders(config)[0].key);
      }
    expect(requests).toBe(0);
  });

  it('does not ask the stand-in endpoint while encoding', async () => {
    const dir = await tempGallery();
    const remote = (storage: object) =>
      (storageFromConfig(bucketConfig(storage), dir, env) as BucketStorage)
        .remote;
    expect(remote({ endpoint: standInEndpoint })).toBeNull();
    expect(remote({})).not.toBeNull();
  });

  it('names each stand-in in the doctor report', async () => {
    const dir = await tempGallery();
    const report = await doctor(dir, {
      config: bucketConfig({
        endpoint: standInEndpoint,
        publicUrl: PUBLIC_URL_PLACEHOLDER,
      }),
    });
    const standIns = report.issues.filter((i) => i.includes('stand-in'));
    expect(standIns).toHaveLength(2);
    expect(standIns[0]).toMatch(/^storage\.endpoint .*npx wrangler whoami/);
    expect(standIns[1]).toMatch(/^storage\.publicUrl .*Custom Domains/);
    expect(
      (await doctor(dir, { config: bucketConfig() })).issues.some((i) =>
        i.includes('stand-in')
      )
    ).toBe(false);
  });
});
