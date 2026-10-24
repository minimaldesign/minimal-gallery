/**
 * Remote operations of bucket mode: what to upload, the upload, and the
 * prune. The pipeline never calls these; `sync`, `publish` and the admin do.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { loadConfig, type GalleryConfig } from '../config.ts';
import { ALBUMS_FILE, MANIFEST_DIR, STAGE_DIR } from '../schema.ts';
import {
  BUCKET_INDEX_FILE,
  bucketId,
  PROBE_PREFIX,
  writeBucketIndex,
} from './bucket.ts';
import { BucketError, bucketFromConfig, s3Config } from './from-config.ts';
import { repoStorage } from './repo.ts';
import { md5, type S3Object, type S3Storage } from './s3.ts';

/** Options shared by the bucket functions. */
export interface BucketOptions {
  /** Default: `loadConfig(galleryDir)`. */
  config?: GalleryConfig;
  /** Where credentials are read first. Default `process.env`; the gallery’s `.env` second. */
  env?: NodeJS.ProcessEnv;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
}

/** The shape of every key the pipeline writes: `<photo id>/<hash8>-<variant>.<ext>`. */
const GALLERY_KEY = /^[a-z0-9_]+\/[0-9a-f]{8}-[a-z0-9-]+\.[a-z0-9]+$/;

const CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain; charset=utf-8',
};

/** Content type of a key, from its extension. */
export function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, limit), items.length) },
      async () => {
        while (next < items.length) await fn(items[next++]);
      }
    )
  );
}

/** Only what the bucket functions need, read leniently so older manifests count. */
const KeyedManifest = z.looseObject({
  variants: z.array(z.looseObject({ key: z.string(), bytes: z.number() })),
  original: z.looseObject({ key: z.string().optional(), bytes: z.number() }),
});

interface Referenced {
  /** Key to the byte size the manifest records. */
  keys: Map<string, number>;
  manifests: number;
  unreadable: string[];
}

/** Keys the manifests reference: every variant, plus originals when `originals: 'bucket'`. */
async function referencedKeys(
  galleryDir: string,
  config: GalleryConfig
): Promise<Referenced> {
  const dir = join(galleryDir, MANIFEST_DIR);
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw e;
  }
  const keys = new Map<string, number>();
  const unreadable: string[] = [];
  let manifests = 0;
  const names = files.filter((f) => f.endsWith('.json') && f !== ALBUMS_FILE);
  await mapLimit(names, 32, async (f) => {
    let m;
    try {
      m = KeyedManifest.parse(JSON.parse(await readFile(join(dir, f), 'utf8')));
    } catch {
      unreadable.push(f);
      return;
    }
    manifests++;
    for (const v of m.variants) keys.set(v.key, v.bytes);
    if (config.originals === 'bucket' && m.original.key)
      keys.set(m.original.key, m.original.bytes);
  });
  return { keys, manifests, unreadable: unreadable.sort() };
}

/** Files in the stage (`.minimalgallery/cache/media`), by key, with their sizes. */
export async function stagedFiles(
  galleryDir: string
): Promise<Map<string, number>> {
  const root = join(galleryDir, STAGE_DIR);
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (e: any) {
    if (e?.code === 'ENOENT') return new Map();
    throw e;
  }
  const files = entries.filter((e) => e.isFile() && !e.name.endsWith('.tmp'));
  const out = new Map<string, number>();
  await mapLimit(files, 64, async (e) => {
    const path = join(e.parentPath, e.name);
    try {
      out.set(
        relative(root, path).split(sep).join('/'),
        (await stat(path)).size
      );
    } catch {}
  });
  return out;
}

export interface PendingUploads {
  files: number;
  bytes: number;
  keys: string[];
}

/**
 * Staged files the manifests reference: the files waiting for upload. Local
 * only, no network, so the doctor, `watch` and the admin can show it at any
 * time. Empty in repo mode.
 */
export async function pendingUploads(
  galleryDir: string,
  options: Pick<BucketOptions, 'config'> = {}
): Promise<PendingUploads> {
  const config = options.config ?? (await loadConfig(galleryDir));
  if (config.storage.mode !== 's3') return { files: 0, bytes: 0, keys: [] };
  const [ref, staged] = await Promise.all([
    referencedKeys(galleryDir, config),
    stagedFiles(galleryDir),
  ]);
  const keys = [...staged.keys()].filter((k) => ref.keys.has(k)).sort();
  return {
    files: keys.length,
    bytes: keys.reduce((s, k) => s + staged.get(k)!, 0),
    keys,
  };
}

/** What a sync would do, from the manifests, the stage and one listing of the bucket. */
export interface BucketSyncPlan {
  /** Photo manifests read. */
  manifests: number;
  /** Number of keys the manifests reference: variants, plus originals when `originals: 'bucket'`. */
  referenced: number;
  /** Referenced keys found in the stage. */
  staged: string[];
  /** Referenced keys already in the bucket. */
  inBucket: string[];
  /** Staged keys to upload: absent from the bucket, or different there. */
  upload: string[];
  uploadBytes: number;
  /** Staged keys whose copy in the bucket is identical. `uploadToBucket` clears them from the stage. */
  alreadyUploaded: string[];
  /** Referenced keys neither staged nor in the bucket. The pipeline encodes them again on its next run. */
  missing: string[];
  /** Gallery keys in the bucket that no manifest references (and leftover check probes). `pruneBucket` deletes them. */
  orphans: string[];
  orphanBytes: number;
  /** Manifest files that could not be read. `pruneBucket` refuses to run while there are any. */
  unreadable: string[];
}

interface Planned extends BucketSyncPlan {
  listing: ReadonlyMap<string, S3Object>;
}

async function plan(
  galleryDir: string,
  config: GalleryConfig,
  bucket: S3Storage
): Promise<Planned> {
  const s = s3Config(config);
  const [ref, stage, listing] = await Promise.all([
    referencedKeys(galleryDir, config),
    stagedFiles(galleryDir),
    bucket.index(),
  ]);
  // Every full listing refreshes the local record, so keys deleted from the
  // bucket elsewhere are encoded again on the next run.
  await writeBucketIndex(
    join(galleryDir, BUCKET_INDEX_FILE),
    bucketId(s),
    listing.keys()
  );
  const stageDir = join(galleryDir, STAGE_DIR);
  const staged: string[] = [];
  const inBucket: string[] = [];
  const upload: string[] = [];
  const alreadyUploaded: string[] = [];
  const missing: string[] = [];
  let uploadBytes = 0;
  const identical = async (key: string, size: number, remote: S3Object) => {
    if (remote.size !== size) return false;
    if (!/^[0-9a-f]{32}$/.test(remote.etag)) return true;
    return (
      md5(await readFile(join(stageDir, ...key.split('/')))) === remote.etag
    );
  };
  await mapLimit([...ref.keys.keys()], 16, async (key) => {
    const size = stage.get(key);
    const remote = listing.get(key);
    if (remote) inBucket.push(key);
    if (size === undefined) {
      if (!remote) missing.push(key);
      return;
    }
    staged.push(key);
    if (remote && (await identical(key, size, remote)))
      alreadyUploaded.push(key);
    else {
      upload.push(key);
      uploadBytes += size;
    }
  });
  const orphans: string[] = [];
  let orphanBytes = 0;
  for (const o of listing.values())
    if (
      !ref.keys.has(o.key) &&
      (GALLERY_KEY.test(o.key) || o.key.startsWith(PROBE_PREFIX))
    ) {
      orphans.push(o.key);
      orphanBytes += o.size;
    }
  const sort = (a: string[]) => a.sort();
  return {
    manifests: ref.manifests,
    referenced: ref.keys.size,
    staged: sort(staged),
    inBucket: sort(inBucket),
    upload: sort(upload),
    uploadBytes,
    alreadyUploaded: sort(alreadyUploaded),
    missing: sort(missing),
    orphans: sort(orphans),
    orphanBytes,
    unreadable: ref.unreadable,
    listing,
  };
}

/**
 * Compare the manifests, the stage and the bucket. Lists the whole bucket
 * once and saves the listing as the local record. Throws a `BucketError`
 * outside s3 mode or without credentials, and an `S3Error` when the bucket
 * refuses or cannot be reached.
 */
export async function planBucketSync(
  galleryDir: string,
  options: BucketOptions = {}
): Promise<BucketSyncPlan> {
  const config = options.config ?? (await loadConfig(galleryDir));
  const { listing: _, ...rest } = await plan(
    galleryDir,
    config,
    bucketFromConfig(config, galleryDir, options)
  );
  return rest;
}

export interface UploadProgress {
  /** Files uploaded so far, this one included. */
  done: number;
  total: number;
  key: string;
  /** Size of this file. */
  bytes: number;
  doneBytes: number;
  totalBytes: number;
}

export interface UploadOptions extends BucketOptions {
  /** Uploads in flight. Default 8. */
  concurrency?: number;
  /** After each uploaded file. */
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadSummary {
  uploaded: string[];
  bytes: number;
  /** Staged files that were already in the bucket, identical; cleared from the stage. */
  alreadyUploaded: string[];
  /** Referenced keys neither staged nor in the bucket; see `BucketSyncPlan.missing`. */
  missing: string[];
  seconds: number;
}

/**
 * Upload the staged files the bucket lacks (or holds a different version
 * of), with `Content-Type` and an immutable `Cache-Control`. Each uploaded
 * file is added to the local record and then removed from the stage, so the
 * stage holds only what waits for upload. Never deletes anything from the
 * bucket.
 *
 * On the first failed upload, no new upload starts; the ones in flight
 * finish and are recorded, and a `BucketError` (`code: 'upload-failed'`,
 * the `S3Error` as `cause`) is thrown. Running it again continues.
 */
export async function uploadToBucket(
  galleryDir: string,
  options: UploadOptions = {}
): Promise<UploadSummary> {
  const t0 = performance.now();
  const config = options.config ?? (await loadConfig(galleryDir));
  const s = s3Config(config);
  const bucket = bucketFromConfig(config, galleryDir, options);
  const p = await plan(galleryDir, config, bucket);
  const stageDir = join(galleryDir, STAGE_DIR);
  const stage = repoStorage({ root: stageDir });
  const indexFile = join(galleryDir, BUCKET_INDEX_FILE);
  const id = bucketId(s);
  const known = new Set(p.listing.keys());

  for (const key of p.alreadyUploaded) await stage.remove(key);

  // Uploaded files are recorded, then cleared from the stage, in batches: a
  // file is never cleared before the record says it is in the bucket.
  let recorded: string[] = [];
  let flushing: Promise<void> = Promise.resolve();
  const flush = () => {
    flushing = flushing.then(async () => {
      if (!recorded.length) return;
      const batch = recorded;
      recorded = [];
      for (const k of batch) known.add(k);
      await writeBucketIndex(indexFile, id, known);
      for (const k of batch) await stage.remove(k);
    });
    flushing.catch(() => {});
    return flushing;
  };

  const uploaded: string[] = [];
  let done = 0;
  let doneBytes = 0;
  let failure: unknown;
  await mapLimit(p.upload, options.concurrency ?? 8, async (key) => {
    if (failure) return;
    let bytes: Buffer;
    try {
      bytes = await readFile(join(stageDir, ...key.split('/')));
    } catch (e: any) {
      // Removed since the plan, for example by a pipeline run.
      if (e?.code === 'ENOENT') return;
      failure ??= e;
      return;
    }
    try {
      await bucket.put(key, bytes, contentTypeFor(key));
    } catch (e) {
      failure ??= e;
      return;
    }
    uploaded.push(key);
    recorded.push(key);
    done++;
    doneBytes += bytes.byteLength;
    options.onProgress?.({
      done,
      total: p.upload.length,
      key,
      bytes: bytes.byteLength,
      doneBytes,
      totalBytes: p.uploadBytes,
    });
    if (recorded.length >= 100) void flush();
  });
  await flush();
  if (failure) {
    const message = (failure as Error)?.message ?? String(failure);
    throw new BucketError(
      'upload-failed',
      `${message} ${uploaded.length} of ${p.upload.length} file(s) were uploaded before the error; run the upload again to continue.`,
      { cause: failure }
    );
  }
  return {
    uploaded: uploaded.sort(),
    bytes: doneBytes,
    alreadyUploaded: p.alreadyUploaded,
    missing: p.missing,
    seconds: (performance.now() - t0) / 1000,
  };
}

export interface PruneOptions extends BucketOptions {
  /** Report what would be deleted, delete nothing. */
  dryRun?: boolean;
  /** Deletes in flight. Default 8. */
  concurrency?: number;
}

export interface PruneSummary {
  /** Keys deleted, or that would be with `dryRun`. */
  removed: string[];
  bytes: number;
  dryRun: boolean;
}

/**
 * Delete the gallery keys in the bucket that no manifest references. Keys
 * that do not have the pipeline’s shape (`<photo id>/<hash8>-<name>.<ext>`)
 * are left alone, so a shared bucket is safe. Refuses (`BucketError`) when a
 * manifest cannot be read or there are none, since every key would then
 * look unreferenced. A live site may still use old keys until its next
 * build, so only `sync --prune` calls this.
 */
export async function pruneBucket(
  galleryDir: string,
  options: PruneOptions = {}
): Promise<PruneSummary> {
  const config = options.config ?? (await loadConfig(galleryDir));
  const s = s3Config(config);
  const bucket = bucketFromConfig(config, galleryDir, options);
  const p = await plan(galleryDir, config, bucket);
  if (p.unreadable.length)
    throw new BucketError(
      'unreadable-manifests',
      `Not pruning the bucket: ${p.unreadable.length} manifest(s) cannot be read (${p.unreadable.slice(0, 3).join(', ')}${p.unreadable.length > 3 ? ', …' : ''}). Run the pipeline first.`
    );
  if (p.manifests === 0)
    throw new BucketError(
      'no-manifests',
      `Not pruning the bucket: there are no manifests in ${MANIFEST_DIR}. Run the pipeline first.`
    );
  const dryRun = options.dryRun ?? false;
  if (!dryRun && p.orphans.length) {
    // As with uploads: stop at the first failure, let the deletes in flight
    // finish, and record what is gone before throwing.
    const known = new Set(p.listing.keys());
    let failure: unknown;
    await mapLimit(p.orphans, options.concurrency ?? 8, async (key) => {
      if (failure) return;
      try {
        await bucket.remove(key);
        known.delete(key);
      } catch (e) {
        failure ??= e;
      }
    });
    await writeBucketIndex(
      join(galleryDir, BUCKET_INDEX_FILE),
      bucketId(s),
      known
    );
    if (failure) throw failure;
  }
  return { removed: p.orphans, bytes: p.orphanBytes, dryRun };
}
