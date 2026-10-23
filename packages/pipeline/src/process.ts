import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { extname, join } from 'node:path';
import { Piscina } from 'piscina';
import sharp from 'sharp';
import { z } from 'zod';
import { ladderFromConfig, loadConfig, type GalleryConfig } from './config.ts';
import type { EncodeResult, EncodeTask } from './encode.ts';
import { readEmbedded } from './embedded.ts';
import { photoFacets, sortPhotos } from './facets.ts';
import {
  isHeic,
  UnsupportedInputError,
  UNSUPPORTED_MESSAGES,
} from './formats.ts';
import { hashBytes, hashString, stableStringify } from './hash.ts';
import {
  ladderHash as computeLadderHash,
  type LadderConfig,
} from './ladder.ts';
import type { Layer, LayerName } from './layers.ts';
import { mergeLayers } from './merge.ts';
import { dateToLocal, parseUserDate } from './normalize.ts';
import {
  ALBUMS_FILE,
  AlbumManifest,
  AlbumsFile,
  MANIFEST_DIR,
  Oklch,
  PhotoManifest,
  Variant,
  type AlbumSort,
  type PhotoOverrides,
} from './schema.ts';
import {
  overridesToLayer,
  readAlbumFile,
  readPhotoSidecars,
  type AlbumFile,
} from './sidecars.ts';
import { titleFromFile, titleFromFolder } from './slug.ts';
import {
  originalsStorageFromConfig,
  storageFromConfig,
} from './storage/from-config.ts';
import type { Storage } from './storage/types.ts';
import { walkPhotos, type WalkedAlbum, type WalkedPhoto } from './walk.ts';

/**
 * Bump when the manifest’s shape or meaning changes. Every manifest is
 * rebuilt from the metadata; derivatives are kept. Derivative changes bump
 * ENCODER_VERSION in `ladder.ts` instead.
 */
export const PIPELINE_VERSION = '0.2.1';

export { MANIFEST_DIR, ALBUMS_FILE } from './schema.ts';

export interface ProcessOptions {
  /** Re-encode every photo. */
  force?: boolean;
  /** Remove manifests, derivatives and empty folders of photos that no longer exist. */
  prune?: boolean;
  /** The gallery config. Defaults to `loadConfig(galleryDir)`. */
  config?: GalleryConfig;
  /** Overrides the storage from the config. */
  storage?: Storage;
  /** Overrides the ladder from the config. */
  ladder?: LadderConfig;
  /** Worker threads for encoding. Default: see `workerPlan`. */
  concurrency?: number;
  /** libvips threads inside each worker. Default: see `workerPlan`. */
  threadsPerWorker?: number;
  log?: (message: string) => void;
  /** After the cheap first pass: how many photos there are and how many need work. */
  onPlan?: (plan: { photos: number; pending: number }) => void;
  /** After each photo that was encoded or had its manifest rebuilt. */
  onPhoto?: (manifest: PhotoManifest, result: PhotoResult) => void;
  /** After each photo that could not be processed. */
  onError?: (error: PhotoError) => void;
}

export type PhotoStatus = 'encoded' | 'metadata' | 'skipped';

export interface PhotoResult {
  id: string;
  status: PhotoStatus;
  /** Time spent on this photo in the main thread, including waiting for a worker. */
  seconds: number;
  /** Time spent encoding inside the worker. */
  encodeSeconds?: number;
  filesWritten: number;
  bytesWritten: number;
  manifestWritten: boolean;
  iccIn?: string | null;
}

/** A photo that could not be processed. The run continues without it. */
export interface PhotoError {
  /** Relative to the gallery directory. */
  path: string;
  kind: 'heic' | 'raw' | 'decode' | 'metadata';
  message: string;
}

export interface ProcessSummary {
  photos: number;
  albums: number;
  encoded: number;
  metadataOnly: number;
  skipped: number;
  manifestsWritten: number;
  filesWritten: number;
  bytesWritten: number;
  /** Bytes of every current derivative, written now or earlier. */
  derivativeBytes: number;
  derivativeFiles: number;
  meanEncodeSeconds: number | null;
  p95EncodeSeconds: number | null;
  wallSeconds: number;
  /** Worker threads and libvips threads per worker used for this run. */
  workers: number;
  threadsPerWorker: number;
  /** Ids with a manifest or derivatives but no photo. */
  orphans: string[];
  pruned: {
    /** Orphaned photo ids removed. */
    ids: string[];
    manifests: number;
    files: number;
    /** Empty folders and interrupted writes removed from storage. */
    swept: string[];
  };
  errors: PhotoError[];
  warnings: string[];
  results: PhotoResult[];
}

const CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};
const EXTENSIONS = { avif: 'avif', jpeg: 'jpg', webp: 'webp' } as const;

/**
 * Worker pool size for a batch. Workers = min(CPUs, photos to encode);
 * libvips threads per worker = max(1, floor(CPUs / workers)). A large batch
 * gets one thread per worker; a single photo gets every core in one worker.
 * Either value can be overridden.
 */
export function workerPlan(
  cpus: number,
  files: number,
  overrides: { concurrency?: number; threadsPerWorker?: number } = {}
): { workers: number; threadsPerWorker: number } {
  const cpu = Math.max(1, Math.floor(cpus));
  const batch = Math.max(1, files);
  const workers = overrides.concurrency
    ? Math.max(1, Math.floor(overrides.concurrency))
    : Math.min(cpu, batch);
  const threadsPerWorker =
    overrides.threadsPerWorker ?? Math.max(1, Math.floor(cpu / workers));
  return { workers, threadsPerWorker };
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e instanceof SyntaxError) return undefined;
    throw e;
  }
}

/** Write only when the content changed, so file mtimes stay meaningful. */
async function writeIfChanged(path: string, text: string): Promise<boolean> {
  try {
    if ((await readFile(path, 'utf8')) === text) return false;
  } catch {}
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
  return true;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[Math.max(0, i)];
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

/** Digest of a manifest: every field except `digest` and the file-system bookkeeping. */
export async function manifestDigest(
  m: Omit<PhotoManifest, 'digest'> | Omit<AlbumManifest, 'digest'>
): Promise<string> {
  const {
    sourceMtime: _m,
    inputsHash: _i,
    ...rest
  } = m as Record<string, unknown>;
  return hashString(stableStringify(rest));
}

/**
 * The fields of an earlier manifest that let a run reuse its derivatives.
 * Read leniently, so a manifest written by an older pipeline version still
 * saves the re-encode when only the manifest shape changed.
 */
const ReusableManifest = z.looseObject({
  sourceHash: z.string(),
  ladderHash: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  color: Oklch,
  thumbhash: z.string(),
  placeholder: z.string(),
  variants: z.array(Variant),
  original: z.looseObject({ icc: z.string().nullable() }),
});
type ReusableManifest = z.infer<typeof ReusableManifest>;

function albumEntryFor(
  album: AlbumFile | undefined,
  photo: WalkedPhoto
): PhotoOverrides | undefined {
  const map = album?.frontmatter.photos;
  if (!map) return undefined;
  const noExt = photo.file.replace(/\.[^.]+$/, '');
  return map[photo.file] ?? map[noExt] ?? map[photo.slug];
}

/** Remove keys under `<id>/` that are not in `keep`. */
async function removeStale(
  storage: Storage,
  id: string,
  keep: Set<string>
): Promise<void> {
  for (const key of await storage.list(`${id}/`)) {
    if (!keep.has(key)) await storage.remove(key);
  }
}

/**
 * Process a gallery: read metadata, encode derivatives, write manifests.
 * See the package README for the incremental rules.
 */
export async function processGallery(
  galleryDir: string,
  options: ProcessOptions = {}
): Promise<ProcessSummary> {
  const started = performance.now();
  const log = options.log ?? (() => {});
  const config = options.config ?? (await loadConfig(galleryDir));
  const ladder = options.ladder ?? ladderFromConfig(config);
  const color = config.color;
  const storage = options.storage ?? storageFromConfig(config, galleryDir);
  const originalsStorage = originalsStorageFromConfig(
    config,
    galleryDir,
    storage
  );
  const ladderHash = await computeLadderHash(ladder, color);
  const manifestDir = join(galleryDir, MANIFEST_DIR);
  await mkdir(manifestDir, { recursive: true });

  const { albums, photos, unsupported, warnings } =
    await walkPhotos(galleryDir);
  const errors: PhotoError[] = [];
  let pairedIgnored = 0;
  for (const u of unsupported) {
    if (u.hasSibling) pairedIgnored++;
    else
      errors.push({
        path: u.relativePath,
        kind: u.kind,
        message: UNSUPPORTED_MESSAGES[u.kind],
      });
  }
  if (pairedIgnored)
    warnings.push(
      `${pairedIgnored} RAW or HEIC file(s) ignored: a JPEG with the same name is next to each`
    );

  const albumFiles = new Map<string, AlbumFile | undefined>();
  await Promise.all(
    albums.map(async (a) =>
      albumFiles.set(a.id, await readAlbumFile(join(a.absDir, '_album.md')))
    )
  );

  const manifests = new Map<string, PhotoManifest>();
  const originalKeyFor = (photo: WalkedPhoto, sourceHash: string) => {
    const ext = extname(photo.file).toLowerCase().replace('.jpeg', '.jpg');
    return `${photo.id}/${sourceHash.slice(0, 8)}-original${ext}`;
  };
  const present = async (keys: Array<[Storage, string]>) =>
    (await Promise.all(keys.map(([s, k]) => s.has(k)))).every(Boolean);

  // Pass 1, cheap: stat, sidecars and the earlier manifest. Photos whose
  // file, sidecars, settings and derivatives are unchanged are done here.
  interface Pending {
    photo: WalkedPhoto;
    size: number;
    mtime: Date;
    mtimeMs: number;
    albumEntry: PhotoOverrides | undefined;
    sidecars: Awaited<ReturnType<typeof readPhotoSidecars>>;
    inputsHash: string;
    reusable: ReusableManifest | undefined;
  }
  const pending: Pending[] = [];
  const results: PhotoResult[] = [];
  await mapLimit(photos, 16, async (photo) => {
    const t0 = performance.now();
    try {
      const st = await stat(photo.abs);
      const albumEntry = albumEntryFor(albumFiles.get(photo.albumId), photo);
      const sidecars = await readPhotoSidecars(
        photo.absNoExt,
        photo.relativePath.replace(/\.[^.]+$/, '')
      );
      const inputsHash = await hashString(
        `${PIPELINE_VERSION}\n${sidecars.raw}\n${stableStringify(albumEntry ?? null)}`
      );
      const prevRaw = await readJson(join(manifestDir, `${photo.id}.json`));
      const full = prevRaw ? PhotoManifest.safeParse(prevRaw) : undefined;
      const loose = prevRaw ? ReusableManifest.safeParse(prevRaw) : undefined;
      const prev = full?.success ? full.data : undefined;
      if (
        !options.force &&
        prev &&
        prev.ladderHash === ladderHash &&
        prev.sourceSize === st.size &&
        prev.sourceMtime === st.mtimeMs &&
        prev.inputsHash === inputsHash &&
        // A changed storage address (a new publicUrl) rewrites the manifest.
        prev.variants.every((v) => v.url === storage.url(v.key)) &&
        (!prev.original.key ||
          prev.original.url === originalsStorage?.url(prev.original.key)) &&
        (originalsStorage
          ? prev.original.key === originalKeyFor(photo, prev.sourceHash)
          : prev.original.key === undefined) &&
        (await present([
          ...prev.variants.map((v): [Storage, string] => [storage, v.key]),
          ...(originalsStorage && prev.original.key
            ? [[originalsStorage, prev.original.key] as [Storage, string]]
            : []),
        ]))
      ) {
        manifests.set(photo.id, prev);
        results.push({
          id: photo.id,
          status: 'skipped',
          seconds: (performance.now() - t0) / 1000,
          filesWritten: 0,
          bytesWritten: 0,
          manifestWritten: false,
        });
        return;
      }
      pending.push({
        photo,
        size: st.size,
        mtime: st.mtime,
        mtimeMs: st.mtimeMs,
        albumEntry,
        sidecars,
        inputsHash,
        reusable: loose?.success ? loose.data : undefined,
      });
    } catch (e) {
      const error: PhotoError = {
        path: photo.relativePath,
        kind: 'metadata',
        message: (e as Error).message,
      };
      errors.push(error);
      options.onError?.(error);
    }
  });

  options.onPlan?.({ photos: photos.length, pending: pending.length });
  const plan = workerPlan(availableParallelism(), pending.length, {
    concurrency: options.concurrency,
    threadsPerWorker: options.threadsPerWorker,
  });

  // sharp is loaded on the main thread before any worker, as its docs advise.
  void sharp.versions;
  let pool: Piscina<EncodeTask, EncodeResult> | undefined;
  const getPool = () => {
    if (!pool) {
      log(
        `encoding with ${plan.workers} worker(s) × ${plan.threadsPerWorker} thread(s)`
      );
      pool = new Piscina<EncodeTask, EncodeResult>({
        filename: new URL(
          import.meta.url.endsWith('.ts')
            ? './encode-worker.ts'
            : './encode-worker.js',
          import.meta.url
        ).href,
        maxThreads: plan.workers,
        minThreads: 0,
        idleTimeout: 1000,
        workerData: { threads: plan.threadsPerWorker },
      });
    }
    return pool;
  };

  // Pass 2: hash, read metadata, encode when the pixels changed.
  const processOne = async (job: Pending): Promise<PhotoResult> => {
    const t0 = performance.now();
    const { photo, sidecars, albumEntry, reusable } = job;
    const bytes = await readFile(photo.abs);
    if (isHeic(bytes))
      throw new UnsupportedInputError(photo.relativePath, 'heic');
    const sourceHash = await hashBytes(bytes);
    const embedded = await readEmbedded(bytes);
    const originalKey = originalsStorage
      ? originalKeyFor(photo, sourceHash)
      : undefined;

    type Encoded = Pick<
      PhotoManifest,
      'width' | 'height' | 'color' | 'thumbhash' | 'placeholder' | 'variants'
    > & { icc: string | null };
    let encoded: Encoded;
    let status: PhotoStatus;
    let filesWritten = 0;
    let bytesWritten = 0;
    let encodeSeconds: number | undefined;

    if (
      !options.force &&
      reusable &&
      reusable.ladderHash === ladderHash &&
      reusable.sourceHash === sourceHash &&
      (await present(reusable.variants.map((v) => [storage, v.key])))
    ) {
      // Same pixels: keep the derivatives, rebuild the metadata. URLs are
      // computed again, in case the storage address changed.
      const { width, height, color, thumbhash, placeholder } = reusable;
      encoded = {
        width,
        height,
        color,
        thumbhash,
        placeholder,
        variants: reusable.variants.map((v) => ({
          ...v,
          url: storage.url(v.key),
        })),
        icc: reusable.original.icc,
      };
      status = 'metadata';
    } else {
      // New or changed pixels: encode.
      let r: EncodeResult;
      try {
        r = await getPool().run({ bytes, ladder, color });
      } catch (e) {
        throw Object.assign(
          new Error(
            `${photo.relativePath}: cannot decode: ${(e as Error).message}`
          ),
          { kind: 'decode' }
        );
      }
      encodeSeconds = r.seconds;
      const hash8 = sourceHash.slice(0, 8);
      const variants: PhotoManifest['variants'] = [];
      for (const v of r.variants) {
        const key = `${photo.id}/${hash8}-${v.name}.${EXTENSIONS[v.format]}`;
        const data = new Uint8Array(
          v.data.buffer,
          v.data.byteOffset,
          v.data.byteLength
        );
        await storage.put(key, data, CONTENT_TYPES[v.format]);
        filesWritten++;
        bytesWritten += data.byteLength;
        variants.push({
          name: v.name,
          width: v.width,
          height: v.height,
          bytes: data.byteLength,
          format: v.format,
          url: storage.url(key),
          key,
        });
      }
      encoded = {
        width: r.width,
        height: r.height,
        color: r.color,
        thumbhash: r.thumbhash,
        placeholder: r.placeholder,
        variants,
        icc: r.iccIn,
      };
      status = 'encoded';
    }

    if (
      originalsStorage &&
      originalKey &&
      !(await originalsStorage.has(originalKey))
    ) {
      await originalsStorage.put(
        originalKey,
        bytes,
        CONTENT_TYPES[extname(photo.file).toLowerCase()] ??
          'application/octet-stream'
      );
      filesWritten++;
      bytesWritten += bytes.byteLength;
    }
    // Remove derivatives and originals from an earlier version of this photo,
    // or an original no longer published.
    const keep = new Set(encoded.variants.map((v) => v.key));
    if (originalKey && originalsStorage === storage) keep.add(originalKey);
    await removeStale(storage, photo.id, keep);
    if (originalsStorage && originalsStorage !== storage)
      await removeStale(
        originalsStorage,
        photo.id,
        new Set(originalKey ? [originalKey] : [])
      );

    const layers: Array<[LayerName, Layer]> = [
      ['sidecar', sidecars.sidecar],
      [
        'album',
        albumEntry
          ? overridesToLayer(
              albumEntry,
              `${photo.albumId}/_album.md photos.${photo.file}`
            )
          : {},
      ],
      ['xmp-sidecar', sidecars.xmpSidecar],
      ['xmp', embedded.xmp],
      ['iptc', embedded.iptc],
      ['exif', embedded.exif],
      ['filename', { title: titleFromFile(photo.file) }],
    ];
    const meta = mergeLayers({
      layers,
      dateFallbacks: [
        ['exif', embedded.exifCreateDate],
        ['iptc', embedded.iptcDate],
      ],
      mtimeDate: dateToLocal(job.mtime),
      exifOffset:
        embedded.exif.date && embedded.exifOffset
          ? { date: embedded.exif.date, offset: embedded.exifOffset }
          : undefined,
    });

    const body: Omit<PhotoManifest, 'digest'> = {
      id: photo.id,
      album: photo.albumId,
      file: photo.file,
      source: photo.source,
      slug: photo.slug,
      ...meta,
      width: encoded.width,
      height: encoded.height,
      color: encoded.color,
      thumbhash: encoded.thumbhash,
      placeholder: encoded.placeholder,
      variants: encoded.variants,
      original: {
        bytes: job.size,
        width: encoded.width,
        height: encoded.height,
        relativePath: photo.relativePath,
        icc: encoded.icc,
        ...(originalKey && originalsStorage
          ? { key: originalKey, url: originalsStorage.url(originalKey) }
          : {}),
      },
      facets: photoFacets(meta),
      sourceHash,
      sourceSize: job.size,
      sourceMtime: job.mtimeMs,
      inputsHash: job.inputsHash,
      pipelineVersion: PIPELINE_VERSION,
      ladderHash,
    };
    const manifest = PhotoManifest.parse({
      ...body,
      digest: await manifestDigest(body),
    });
    manifests.set(photo.id, manifest);
    const manifestWritten = await writeIfChanged(
      join(manifestDir, `${photo.id}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    return {
      id: photo.id,
      status,
      seconds: (performance.now() - t0) / 1000,
      encodeSeconds,
      filesWritten,
      bytesWritten,
      manifestWritten,
      iccIn: encoded.icc,
    };
  };

  let done = 0;
  try {
    await mapLimit(pending, plan.workers * 2, async (job) => {
      try {
        const r = await processOne(job);
        results.push(r);
        done++;
        options.onPhoto?.(manifests.get(r.id)!, r);
        log(
          `[${done}/${pending.length}] ${r.status.padEnd(8)} ${job.photo.relativePath}`
        );
      } catch (e: any) {
        const error: PhotoError = {
          path: job.photo.relativePath,
          kind:
            e instanceof UnsupportedInputError
              ? e.kind
              : e?.kind === 'decode'
                ? 'decode'
                : 'metadata',
          message: e?.message ?? String(e),
        };
        errors.push(error);
        options.onError?.(error);
      }
    });
  } finally {
    await pool?.destroy();
  }

  // Albums.
  const albumManifests: AlbumManifest[] = [];
  for (const a of albums)
    albumManifests.push(
      await buildAlbum(
        a,
        albumFiles.get(a.id),
        photos,
        manifests,
        config.albums.sort
      )
    );
  const albumsFile = AlbumsFile.parse({
    pipelineVersion: PIPELINE_VERSION,
    albums: albumManifests,
  });
  const albumsWritten = await writeIfChanged(
    join(manifestDir, ALBUMS_FILE),
    `${JSON.stringify(albumsFile, null, 2)}\n`
  );

  // Orphans: manifests and derivative folders with no photo behind them.
  const current = new Set(photos.map((p) => p.id));
  const manifestFiles = await readdir(manifestDir);
  const manifestIds = new Set(
    manifestFiles
      .filter((f) => f.endsWith('.json') && f !== ALBUMS_FILE)
      .map((f) => f.slice(0, -5))
  );
  const stores = [
    storage,
    ...(originalsStorage && originalsStorage !== storage
      ? [originalsStorage]
      : []),
  ];
  const storedIds = new Set<string>();
  for (const s of stores)
    for (const k of await s.list('')) storedIds.add(k.split('/')[0]);
  const orphans = [...new Set([...manifestIds, ...storedIds])]
    .filter((id) => !current.has(id))
    .sort();
  const pruned: ProcessSummary['pruned'] = {
    ids: [],
    manifests: 0,
    files: 0,
    swept: [],
  };
  if (options.prune) {
    for (const id of orphans) {
      if (manifestIds.has(id)) {
        await rm(join(manifestDir, `${id}.json`), { force: true });
        pruned.manifests++;
      }
      for (const s of stores)
        for (const key of await s.list(`${id}/`)) {
          await s.remove(key);
          pruned.files++;
        }
      pruned.ids.push(id);
    }
    // Interrupted manifest writes.
    for (const f of manifestFiles)
      if (f.endsWith('.tmp')) {
        await rm(join(manifestDir, f), { force: true });
        pruned.swept.push(`${MANIFEST_DIR}/${f}`);
      }
    for (const s of stores)
      if (s.sweep) pruned.swept.push(...(await s.sweep()));
    for (const id of pruned.ids) log(`pruned   ${id}`);
  } else if (orphans.length) {
    warnings.push(
      `${orphans.length} orphaned photo(s) with manifests or derivatives; run with --prune to remove them`
    );
  }

  const encodeTimes = results
    .map((r) => r.encodeSeconds)
    .filter((s): s is number => s !== undefined)
    .sort((a, b) => a - b);
  let derivativeBytes = 0;
  let derivativeFiles = 0;
  for (const m of manifests.values()) {
    for (const v of m.variants) {
      derivativeBytes += v.bytes;
      derivativeFiles++;
    }
  }
  const order = new Map(photos.map((p, i) => [p.id, i]));
  results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  errors.sort((a, b) => a.path.localeCompare(b.path));
  return {
    photos: photos.length,
    albums: albums.length,
    encoded: results.filter((r) => r.status === 'encoded').length,
    metadataOnly: results.filter((r) => r.status === 'metadata').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    manifestsWritten:
      results.filter((r) => r.manifestWritten).length + (albumsWritten ? 1 : 0),
    filesWritten: results.reduce((s, r) => s + r.filesWritten, 0),
    bytesWritten: results.reduce((s, r) => s + r.bytesWritten, 0),
    derivativeBytes,
    derivativeFiles,
    meanEncodeSeconds: encodeTimes.length
      ? encodeTimes.reduce((s, t) => s + t, 0) / encodeTimes.length
      : null,
    p95EncodeSeconds: encodeTimes.length ? percentile(encodeTimes, 95) : null,
    wallSeconds: (performance.now() - started) / 1000,
    workers: plan.workers,
    threadsPerWorker: plan.threadsPerWorker,
    orphans,
    pruned,
    errors,
    warnings,
    results,
  };
}

async function buildAlbum(
  a: WalkedAlbum,
  file: AlbumFile | undefined,
  photos: WalkedPhoto[],
  manifests: Map<string, PhotoManifest>,
  defaultSort: AlbumSort
): Promise<AlbumManifest> {
  const fm = file?.frontmatter ?? {};
  const own = photos
    .filter((p) => p.albumId === a.id)
    .map((p) => manifests.get(p.id))
    .filter((m): m is PhotoManifest => !!m);
  const sort = fm.sort ?? defaultSort;
  const ordered = sortPhotos(own, sort, fm.order ?? []);

  const coverPhoto = fm.cover
    ? own.find(
        (m) =>
          m.file === fm.cover || m.file.replace(/\.[^.]+$/, '') === fm.cover
      )
    : undefined;
  if (fm.cover && !coverPhoto)
    throw new Error(
      `${a.path}/_album.md: cover “${fm.cover}” is not a photo in this album`
    );
  const dates = own
    .filter((m) => m.dateSource !== 'mtime')
    .map((m) => m.date)
    .sort();
  const body: Omit<AlbumManifest, 'digest'> = {
    id: a.id,
    path: a.path,
    parent: a.parent,
    title: fm.title ?? titleFromFolder(a.path),
    description: file?.description ?? null,
    cover:
      (coverPhoto ?? ordered.find((m) => !m.hidden) ?? ordered[0])?.id ?? null,
    sort,
    order: fm.order ?? [],
    hidden: fm.hidden ?? false,
    date: fm.date !== undefined ? (parseUserDate(fm.date) ?? null) : null,
    dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null,
    photoIds: ordered.map((m) => m.id),
    children: a.children,
  };
  return AlbumManifest.parse({ ...body, digest: await manifestDigest(body) });
}
