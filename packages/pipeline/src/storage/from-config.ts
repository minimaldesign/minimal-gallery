import { join } from 'node:path';
import type { GalleryConfig } from '../config.ts';
import { configPlaceholders, placeholderMessage } from '../placeholders.ts';
import { STAGE_DIR } from '../schema.ts';
import { BUCKET_INDEX_FILE, bucketId, bucketStorage } from './bucket.ts';
import { bucketCredentials, MISSING_CREDENTIALS } from './env.ts';
import { repoStorage } from './repo.ts';
import { s3Storage, type S3Storage } from './s3.ts';
import type { Storage } from './types.ts';

/** Why a bucket operation cannot start. The message is meant to be shown as is. */
export class BucketError extends Error {
  code:
    | 'not-bucket-mode'
    | 'missing-credentials'
    | 'placeholder'
    | 'no-manifests'
    | 'unreadable-manifests'
    | 'upload-failed';

  constructor(
    code: BucketError['code'],
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'BucketError';
    this.code = code;
  }
}

type S3Config = Extract<GalleryConfig['storage'], { mode: 's3' }>;

/**
 * Storage for the derivatives, from the config’s `storage` key. In repo mode,
 * `public/_mg`. In s3 mode, the staged bucket storage (see `bucketStorage`):
 * writes go to `<gallery>/.minimalgallery/cache/media`, never to the network.
 * Credentials are read from `env` (default `process.env`), then from the
 * gallery’s `.env`.
 */
export function storageFromConfig(
  config: Pick<GalleryConfig, 'storage'>,
  galleryDir: string,
  env: NodeJS.ProcessEnv = process.env
): Storage {
  const s = config.storage;
  if (s.mode === 'repo')
    return repoStorage({ root: join(galleryDir, 'public', '_mg') });
  // With the scaffold’s stand-in endpoint there is no bucket to ask.
  const credentials = configPlaceholders(config).some(
    (p) => p.key === 'storage.endpoint'
  )
    ? null
    : bucketCredentials(galleryDir, env);
  return bucketStorage({
    stageDir: join(galleryDir, STAGE_DIR),
    publicUrl: s.publicUrl,
    remote: credentials ? s3Storage({ ...s, ...credentials }) : null,
    index: { file: join(galleryDir, BUCKET_INDEX_FILE), bucket: bucketId(s) },
  });
}

/**
 * The bucket itself, for remote operations. Throws a `BucketError` when the
 * config is not in s3 mode, still holds a scaffold stand-in, or when
 * credentials are missing.
 */
export function bucketFromConfig(
  config: Pick<GalleryConfig, 'storage'>,
  galleryDir: string,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}
): S3Storage {
  const s = s3Config(config);
  const credentials = bucketCredentials(galleryDir, options.env);
  if (!credentials)
    throw new BucketError('missing-credentials', MISSING_CREDENTIALS);
  return s3Storage({ ...s, ...credentials, fetch: options.fetch });
}

/**
 * The s3 storage config, for remote operations. A `BucketError` in repo mode,
 * or while the config still holds a stand-in from create-minimalgallery.
 */
export function s3Config(config: Pick<GalleryConfig, 'storage'>): S3Config {
  if (config.storage.mode !== 's3')
    throw new BucketError(
      'not-bucket-mode',
      "The gallery is in repo mode: set storage: { mode: 's3', ... } in minimalgallery.config.ts to use a bucket."
    );
  const placeholders = configPlaceholders(config);
  if (placeholders.length)
    throw new BucketError('placeholder', placeholderMessage(placeholders));
  return config.storage;
}

/**
 * Storage for published originals, or null when `originals: 'none'`.
 * `repo` always writes to `public/_mg`, even when derivatives go to a bucket.
 */
export function originalsStorageFromConfig(
  config: Pick<GalleryConfig, 'storage' | 'originals'>,
  galleryDir: string,
  derivatives: Storage
): Storage | null {
  if (config.originals === 'none') return null;
  if (config.originals === 'repo')
    return config.storage.mode === 'repo'
      ? derivatives
      : repoStorage({ root: join(galleryDir, 'public', '_mg') });
  return derivatives;
}
