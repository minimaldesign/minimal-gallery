/**
 * Bucket credentials. They never go in `minimalgallery.config.ts`: they come
 * from the environment or from the gallery’s `.env` file, and the
 * environment wins.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

export const ACCESS_KEY_VAR = 'MG_S3_ACCESS_KEY_ID';
export const SECRET_KEY_VAR = 'MG_S3_SECRET_ACCESS_KEY';

/** What to tell someone whose gallery is in bucket mode without credentials. */
export const MISSING_CREDENTIALS = `Bucket credentials are missing. Add ${ACCESS_KEY_VAR} and ${SECRET_KEY_VAR} to the gallery’s .env file (or set them in the environment). For Cloudflare R2, create an API token with Object Read & Write on the bucket. Until then, new files stay staged in .minimalgallery/cache/media.`;

export interface BucketCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** The gallery’s `.env` file, parsed. Empty when there is none. */
export function readGalleryEnv(galleryDir: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(join(galleryDir, '.env'), 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return {};
    throw e;
  }
  return parseEnv(text) as Record<string, string>;
}

/**
 * Credentials for the bucket, each variable read from `env` (default
 * `process.env`) first and from the gallery’s `.env` second. An empty value
 * counts as unset. Null when either is missing.
 */
export function bucketCredentials(
  galleryDir: string,
  env: NodeJS.ProcessEnv = process.env
): BucketCredentials | null {
  let file: Record<string, string> | undefined;
  const read = (name: string) =>
    env[name] || (file ??= readGalleryEnv(galleryDir))[name] || '';
  const accessKeyId = read(ACCESS_KEY_VAR);
  const secretAccessKey = read(SECRET_KEY_VAR);
  return accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey }
    : null;
}
