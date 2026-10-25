/**
 * Staged bucket storage, what the pipeline writes to in bucket mode. Writes go
 * to a local stage (`.minimalgallery/cache/media`) and never to the network,
 * so encoding works offline and nothing is public before a publish.
 * `uploadToBucket` later moves staged files to the bucket.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { folderStorage } from './folder.ts';
import { S3Error, type S3Storage } from './s3.ts';
import type { Storage } from './types.ts';

/**
 * Local record of the keys in the bucket, relative to the gallery directory.
 * Written by every full listing, upload and prune, so the pipeline knows what
 * is uploaded without asking the network.
 */
export const BUCKET_INDEX_FILE = '.minimalgallery/cache/bucket.json';

/** `checkBucket` writes its probe object under this prefix. */
export const PROBE_PREFIX = '_minimalgallery-check/';

/** Which bucket a record describes: `<endpoint>/<bucket>`. */
export function bucketId(storage: { endpoint: string; bucket: string }) {
  return `${storage.endpoint.replace(/\/+$/, '')}/${storage.bucket}`;
}

interface BucketIndexFile {
  version: 1;
  bucket: string;
  updated: string;
  keys: string[];
}

/** The recorded keys, or null when there is no record for this bucket. */
export async function readBucketIndex(
  file: string,
  bucket: string
): Promise<Set<string> | null> {
  let data: BucketIndexFile;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (
    data?.version !== 1 ||
    data.bucket !== bucket ||
    !Array.isArray(data.keys)
  )
    return null;
  return new Set(data.keys);
}

export async function writeBucketIndex(
  file: string,
  bucket: string,
  keys: Iterable<string>
): Promise<void> {
  const data: BucketIndexFile = {
    version: 1,
    bucket,
    updated: new Date().toISOString(),
    keys: [...keys].sort(),
  };
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data)}\n`);
  await rename(tmp, file);
}

export interface BucketStorageOptions {
  /** The stage, usually `<gallery>/.minimalgallery/cache/media`. */
  stageDir: string;
  /** Public base URL that serves the bucket. */
  publicUrl: string;
  /** The bucket, when credentials exist. */
  remote?: S3Storage | null;
  /** The local record of the bucket’s keys: its file and `bucketId()`. */
  index?: { file: string; bucket: string };
}

export interface BucketStorage extends Storage {
  readonly stageDir: string;
  readonly remote: S3Storage | null;
  /**
   * Set when `has` needed the bucket listing and the bucket could not be
   * reached; `has` then answered from the stage alone.
   */
  offline(): S3Error | null;
}

/**
 * `put`, `remove`, `list` and `sweep` act on the stage only. `has` answers
 * from the stage, then from the local record of the bucket’s keys, then
 * (when there is no record and credentials exist) from one listing of the
 * bucket, which is saved as the record. A bucket that cannot be reached
 * counts as empty, so a run offline encodes instead of failing. `url` is
 * `${publicUrl}/${key}`.
 */
export function bucketStorage(options: BucketStorageOptions): BucketStorage {
  const { stageDir, remote = null, index } = options;
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const stage = folderStorage({ root: stageDir, baseUrl: publicUrl });
  let offline: S3Error | null = null;
  let known: Promise<Set<string> | null> | undefined;
  const knownKeys = () =>
    (known ??= (async () => {
      if (index) {
        const saved = await readBucketIndex(index.file, index.bucket);
        if (saved) return saved;
      }
      if (!remote) return null;
      try {
        const keys = new Set((await remote.index()).keys());
        if (index) await writeBucketIndex(index.file, index.bucket, keys);
        return keys;
      } catch (e) {
        if (e instanceof S3Error && e.status === 0) {
          offline = e;
          return null;
        }
        throw e;
      }
    })());

  return {
    stageDir,
    remote,
    offline: () => offline,
    put: stage.put,
    async has(key) {
      if (await stage.has(key)) return true;
      return (await knownKeys())?.has(key) ?? false;
    },
    url: (key) => `${publicUrl}/${key}`,
    list: stage.list,
    remove: stage.remove,
    sweep: stage.sweep,
  };
}
