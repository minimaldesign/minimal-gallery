/**
 * `doctor`: a health report for a gallery, read from the manifests and the
 * photos folder. It never encodes. It projects the number of files a
 * Cloudflare deploy would hold, against its 20,000-file limit, and
 * recommends a storage mode: repo, or photo storage (bucket mode).
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  albumPathOf,
  missingPhotos,
  readSeen,
  withAbsentAlbums,
} from './absent.ts';
import { loadConfig, type GalleryConfig } from './config.ts';
import { configPlaceholders } from './placeholders.ts';
import {
  ALBUMS_FILE,
  AlbumsFile,
  MANIFEST_DIR,
  PhotoManifest,
} from './schema.ts';
import { bucketCredentials } from './storage/env.ts';
import { pendingUploads } from './storage/sync.ts';
import { walkPhotos, type UnsupportedFile } from './walk.ts';

/** Files in one Cloudflare deploy (a Worker version’s static assets). */
export const PAGES_FILE_LIMIT = 20_000;
/** Past this, photo storage (bucket mode) is recommended before it is needed. */
export const FILE_ADVICE = 16_000;

/** What setting up photo storage involves, said wherever it is advised. */
const BUCKET_COST =
  'See https://docs.minimalgallery.net/hosting/photo-storage/. Enabling R2 in the Cloudflare dashboard asks for a payment method, even on the free tier.';
/**
 * Files every build has besides photo and context pages: feed, map, random,
 * 404, sitemap, robots, icons, CSS and JS bundles. An estimate.
 */
export const FIXED_SITE_FILES = 20;

export type Recommendation = 'repo-ok' | 'consider-bucket' | 'move-to-bucket';

export interface DoctorReport {
  galleryDir: string;
  storage: GalleryConfig['storage']['mode'];
  /**
   * How the gallery publishes (`minimalgallery.publish` in package.json, else
   * `deploy` when there is a wrangler config), or null when that is unknown.
   * Cloudflare’s file limit does not apply to `build`, for the owner’s host.
   */
  publish: 'deploy' | 'build' | null;
  originals: GalleryConfig['originals'];
  photos: number;
  albums: number;
  /** Photos with no manifest yet: run the pipeline. */
  missingManifests: string[];
  /** Manifests of photos deleted from this folder: run with --prune. */
  orphans: string[];
  /**
   * Manifests of photos whose originals are not on this computer and never
   * were (a copy of the gallery made without them). They stay in the gallery
   * and are never pruned here.
   */
  absent: string[];
  /** Photos dated from the file’s mtime. */
  undated: number;
  unsupported: UnsupportedFile[];
  derivatives: { files: number; bytes: number };
  publishedOriginals: { files: number; bytes: number };
  /** Contexts: the archive, every album, every facet value. */
  contexts: { total: number; albums: number; facets: Record<string, number> };
  /** Projected Cloudflare Pages deploy. */
  pages: {
    /** One HTML page per visible photo. */
    photoPages: number;
    /** One HTML page and one `<context>.json` per context. */
    contextFiles: number;
    fixedFiles: number;
    /** Derivatives and originals served from the deploy (repo mode only). */
    mediaFiles: number;
    total: number;
    limit: number;
  };
  /** Bytes of photo media published with the site: the derivatives in repo mode, and published originals. */
  siteMedia: { bytes: number };
  /**
   * Bucket mode only, read from the disk without the network: staged files
   * the manifests reference (waiting for upload), and whether credentials
   * are set. Null in repo mode.
   */
  bucket: { staged: number; stagedBytes: number; credentials: boolean } | null;
  /** How many more photos fit at the current average, before each limit. */
  headroom: { photosUntilFileLimit: number };
  recommendation: Recommendation;
  message: string;
  issues: string[];
}

async function readManifests(dir: string): Promise<{
  photos: PhotoManifest[];
  albums: AlbumsFile | undefined;
  invalid: string[];
}> {
  const manifestDir = join(dir, MANIFEST_DIR);
  let files: string[] = [];
  try {
    files = await readdir(manifestDir);
  } catch {}
  const invalid: string[] = [];
  const photos: PhotoManifest[] = [];
  let albums: AlbumsFile | undefined;
  await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        let raw: unknown;
        try {
          raw = JSON.parse(await readFile(join(manifestDir, f), 'utf8'));
        } catch {
          invalid.push(f);
          return;
        }
        if (f === ALBUMS_FILE) {
          const r = AlbumsFile.safeParse(raw);
          if (r.success) albums = r.data;
          else invalid.push(f);
          return;
        }
        const r = PhotoManifest.safeParse(raw);
        if (r.success) photos.push(r.data);
        else invalid.push(f);
      })
  );
  return { photos, albums, invalid: invalid.sort() };
}

/**
 * How the gallery publishes, as the CLI decides it: `minimalgallery.publish`
 * in package.json, else `deploy` when a wrangler config exists, else null.
 */
async function publishSetting(dir: string): Promise<DoctorReport['publish']> {
  let setting: unknown;
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    setting = pkg?.minimalgallery?.publish;
  } catch {}
  if (setting === 'deploy' || setting === 'build') return setting;
  return existsSync(join(dir, 'wrangler.jsonc')) ||
    existsSync(join(dir, 'wrangler.json'))
    ? 'deploy'
    : null;
}

/** Build the report for a gallery directory. */

export async function doctor(
  dir: string,
  options: { config?: GalleryConfig } = {}
): Promise<DoctorReport> {
  const config = options.config ?? (await loadConfig(dir));
  const issues: string[] = [];
  let walked: Awaited<ReturnType<typeof walkPhotos>> | undefined;
  try {
    walked = await walkPhotos(dir);
  } catch (e) {
    issues.push((e as Error).message);
  }
  const { photos: manifests, albums, invalid } = await readManifests(dir);
  if (invalid.length)
    issues.push(
      `${invalid.length} manifest(s) are unreadable or from an older pipeline: run the pipeline (${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? ', …' : ''})`
    );

  const byId = new Map(manifests.map((m) => [m.id, m]));
  const walkedIds = new Set(walked?.photos.map((p) => p.id) ?? []);
  const missingManifests = (walked?.photos ?? [])
    .filter((p) => !byId.has(p.id))
    .map((p) => p.relativePath);
  // The same split as the pipeline’s: only photos this folder had before
  // count as deleted.
  const { deleted: orphans, absent } = walked
    ? missingPhotos(
        manifests.map((m) => m.id),
        walkedIds,
        await readSeen(dir)
      )
    : { deleted: [], absent: [] };
  const unsupported = walked?.unsupported ?? [];
  const errorsUnsupported = unsupported.filter((u) => !u.hasSibling);
  if (errorsUnsupported.length)
    issues.push(
      `${errorsUnsupported.length} HEIC or RAW file(s) without a JPEG: export them as JPEG`
    );
  if (missingManifests.length)
    issues.push(
      `${missingManifests.length} photo(s) have no manifest: run mg-pipeline`
    );
  if (orphans.length)
    issues.push(
      `${orphans.length} orphaned manifest(s): run mg-pipeline --prune`
    );

  // Visible photos: not hidden, and not in a hidden album or one of its children.
  const hiddenAlbums = new Set(
    (albums?.albums ?? []).filter((a) => a.hidden).map((a) => a.id)
  );
  const inHidden = (albumId: string) =>
    [...hiddenAlbums].some((h) => albumId === h || albumId.startsWith(`${h}/`));
  const absentIds = new Set(absent);
  const current = manifests.filter(
    (m) => !walked || walkedIds.has(m.id) || absentIds.has(m.id)
  );
  const visible = current.filter((m) => !m.hidden && !inHidden(m.album));

  let derivFiles = 0;
  let derivBytes = 0;
  let origFiles = 0;
  let origBytes = 0;
  for (const m of current) {
    for (const v of m.variants) {
      derivFiles++;
      derivBytes += v.bytes;
    }
    if (m.original.key) {
      origFiles++;
      origBytes += m.original.bytes;
    }
  }

  const facetSets: Record<string, Set<string>> = {
    year: new Set(),
    month: new Set(),
    day: new Set(),
    camera: new Set(),
    lens: new Set(),
    aperture: new Set(),
    focal: new Set(),
    keyword: new Set(),
    place: new Set(),
  };
  for (const m of visible) {
    const f = m.facets;
    if (f.year) facetSets.year.add(f.year);
    if (f.month) facetSets.month.add(f.month);
    if (f.day) facetSets.day.add(f.day);
    if (f.camera) facetSets.camera.add(f.camera.slug);
    if (f.lens) facetSets.lens.add(f.lens.slug);
    if (f.aperture) facetSets.aperture.add(String(f.aperture));
    if (f.focalBucket) facetSets.focal.add(f.focalBucket);
    for (const k of f.keywords) facetSets.keyword.add(k.slug);
    if (f.place) facetSets.place.add(f.place.slug);
  }
  const facets = Object.fromEntries(
    Object.entries(facetSets).map(([k, v]) => [k, v.size])
  );
  const visibleAlbums = (albums?.albums ?? []).filter((a) => !inHidden(a.id));
  const facetTotal = Object.values(facets).reduce((s, n) => s + n, 0);
  const contextTotal = 1 + visibleAlbums.length + facetTotal;

  let bucket: DoctorReport['bucket'] = null;
  if (config.storage.mode === 's3') {
    const pending = await pendingUploads(dir, { config });
    const credentials = bucketCredentials(dir) !== null;
    bucket = {
      staged: pending.files,
      stagedBytes: pending.bytes,
      credentials,
    };
    for (const p of configPlaceholders(config))
      issues.push(
        `${p.key} is still the setup’s stand-in, so publish and sync will not upload: ${p.fix.replace(/\.$/, '')}`
      );
    if (!credentials)
      issues.push(
        'no bucket credentials: add MG_S3_ACCESS_KEY_ID and MG_S3_SECRET_ACCESS_KEY to .env before publishing'
      );
  }

  const publish = await publishSetting(dir);
  // The owner’s own host has no file limit we know of.
  const ownHost = publish === 'build';
  const repoMedia = config.storage.mode === 'repo';
  const originalsInRepo = config.originals === 'repo';
  const mediaFiles =
    (repoMedia ? derivFiles : 0) + (originalsInRepo ? origFiles : 0);
  const siteBytes =
    (repoMedia ? derivBytes : 0) + (originalsInRepo ? origBytes : 0);
  const photoPages = visible.length;
  const contextFiles = contextTotal * 2;
  const total = photoPages + contextFiles + FIXED_SITE_FILES + mediaFiles;

  // Headroom at the current per-photo average. Contexts grow too, but far
  // more slowly than photos; they are held at today’s count.
  const n = Math.max(1, current.length);
  const filesPerPhoto =
    1 +
    (repoMedia ? derivFiles / n : 0) +
    (originalsInRepo ? origFiles / n : 0);
  const photosUntilFileLimit = Math.max(
    0,
    Math.floor((PAGES_FILE_LIMIT - total) / filesPerPhoto)
  );

  let recommendation: Recommendation;
  let message: string;
  if (ownHost) {
    recommendation = 'repo-ok';
    message = repoMedia
      ? 'Repo mode is fine: the site is built for your own host, so Cloudflare’s 20,000-file limit does not apply.'
      : 'Bucket mode: the photos are in photo storage, and the site is built for your own host.';
  } else if (total > PAGES_FILE_LIMIT) {
    recommendation = 'move-to-bucket';
    message = repoMedia
      ? `Add photo storage (bucket mode): the site is over Cloudflare’s 20,000-file limit. Set storage: { mode: "s3", ... } in minimalgallery.config.ts. ${BUCKET_COST}`
      : 'Even with the photos in photo storage, the HTML pages alone are over 20,000 files. Hide albums, drop facets, or host the site on a service without a file limit.';
  } else if (repoMedia && total > FILE_ADVICE) {
    recommendation = 'consider-bucket';
    message = `Repo mode works today, but the site is getting close to Cloudflare’s 20,000-file limit. Plan to add photo storage (bucket mode) before then. ${BUCKET_COST}`;
  } else {
    recommendation = 'repo-ok';
    message = repoMedia
      ? 'Repo mode is fine.'
      : 'Bucket mode: the photos are in photo storage, and the pages are well within the limits.';
  }

  return {
    galleryDir: dir,
    storage: config.storage.mode,
    publish,
    originals: config.originals,
    photos: walked ? walked.photos.length + absent.length : manifests.length,
    albums: walked
      ? withAbsentAlbums(
          walked.albums,
          current
            .filter((m) => absentIds.has(m.id))
            .map((m) => albumPathOf(m.source)),
          join(dir, 'photos')
        ).length
      : (albums?.albums.length ?? 0),
    missingManifests,
    orphans,
    absent,
    undated: current.filter((m) => m.dateSource === 'mtime').length,
    unsupported,
    derivatives: { files: derivFiles, bytes: derivBytes },
    publishedOriginals: { files: origFiles, bytes: origBytes },
    contexts: { total: contextTotal, albums: visibleAlbums.length, facets },
    pages: {
      photoPages,
      contextFiles,
      fixedFiles: FIXED_SITE_FILES,
      mediaFiles,
      total,
      limit: PAGES_FILE_LIMIT,
    },
    siteMedia: { bytes: siteBytes },
    bucket,
    headroom: { photosUntilFileLimit },
    recommendation,
    message,
    issues,
  };
}

export const formatBytes = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(2)} GB`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${(n / 1e3).toFixed(1)} KB`;

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

/** The report as plain text, for the CLI. */
export function formatDoctorReport(r: DoctorReport): string {
  const facetList = Object.entries(r.contexts.facets)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  const rows: Array<[string, string]> = [
    ['storage', `${r.storage}, originals ${r.originals}`],
    [
      'photos',
      `${r.photos} in ${r.albums} album(s), ${r.undated} undated` +
        (r.absent.length
          ? `, ${r.absent.length} with no original on this computer`
          : ''),
    ],
    [
      'derivatives',
      `${r.derivatives.files} files, ${formatBytes(r.derivatives.bytes)}`,
    ],
  ];
  if (r.publishedOriginals.files)
    rows.push([
      'originals',
      `${r.publishedOriginals.files} files, ${formatBytes(r.publishedOriginals.bytes)}`,
    ]);
  if (r.bucket)
    rows.push([
      'bucket',
      (r.bucket.staged
        ? `${r.bucket.staged} file(s), ${formatBytes(r.bucket.stagedBytes)}, staged and waiting for upload`
        : 'nothing waiting for upload') +
        (r.bucket.credentials ? '' : '; no credentials'),
    ]);
  rows.push(
    [
      'contexts',
      `${r.contexts.total} (archive, ${r.contexts.albums} albums, ${facetList || 'no facets'})`,
    ],
    [
      'site files',
      r.publish === 'build'
        ? `${r.pages.total}: ${r.pages.photoPages} photo pages, ${r.pages.contextFiles} context pages and JSON, ${r.pages.mediaFiles} media, ~${r.pages.fixedFiles} other`
        : `${r.pages.total} of ${r.pages.limit} (${pct(r.pages.total, r.pages.limit)}): ${r.pages.photoPages} photo pages, ${r.pages.contextFiles} context pages and JSON, ${r.pages.mediaFiles} media, ~${r.pages.fixedFiles} other`,
    ],
    ['site media', `${formatBytes(r.siteMedia.bytes)}, published with the site`]
  );
  if (r.publish !== 'build')
    rows.push([
      'headroom',
      `about ${r.headroom.photosUntilFileLimit} more photos before the file limit`,
    ]);
  const w = Math.max(...rows.map(([k]) => k.length));
  const lines = rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`);
  lines.push('', r.message);
  if (r.absent.length)
    lines.push(
      `The originals of ${r.absent.length} photo(s) are not on this computer, as in a copy of the gallery made without them. They stay in the gallery as their manifests describe them and are never pruned here; edit or delete them on the computer that has their originals.`
    );
  for (const i of r.issues) lines.push(`issue: ${i}`);
  return lines.join('\n');
}
