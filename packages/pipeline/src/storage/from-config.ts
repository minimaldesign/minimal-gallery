import { join } from 'node:path';
import type { GalleryConfig } from '../config.ts';
import { repoStorage } from './repo.ts';
import { s3Storage } from './s3.ts';
import type { Storage } from './types.ts';

/** Storage for the derivatives, from the config’s `storage` key. */
export function storageFromConfig(
  config: Pick<GalleryConfig, 'storage'>,
  galleryDir: string,
  env: NodeJS.ProcessEnv = process.env
): Storage {
  const s = config.storage;
  if (s.mode === 'repo')
    return repoStorage({ root: join(galleryDir, 'public', '_mg') });
  return s3Storage({
    bucket: s.bucket,
    endpoint: s.endpoint,
    region: s.region,
    publicUrl: s.publicUrl,
    accessKeyId: env.MG_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.MG_S3_SECRET_ACCESS_KEY ?? '',
  });
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
