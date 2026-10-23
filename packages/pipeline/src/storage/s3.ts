import type { Storage } from './types.ts';

export interface S3StorageOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  /** Public base URL (custom domain) that serves the bucket. */
  publicUrl: string;
}

/**
 * S3-compatible storage (Cloudflare R2, Backblaze B2, AWS S3).
 *
 * TODO: implement with `aws4fetch` in phase 3. `put` should send
 * `Cache-Control: public, max-age=31536000, immutable`, since keys are
 * content-addressed. `list` pages with ListObjectsV2 continuation tokens.
 */
export function s3Storage(options: S3StorageOptions): Storage {
  const notYet = () =>
    Promise.reject(new Error('s3 storage is not implemented yet'));
  return {
    put: notYet,
    has: notYet,
    url: (key) => `${options.publicUrl.replace(/\/$/, '')}/${key}`,
    list: notYet,
    remove: notYet,
  };
}
