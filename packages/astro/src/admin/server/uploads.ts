/**
 * Chunked uploads with dedupe by content hash. Chunks go to
 * `.minimalgallery/cache/uploads/<id>`; on completion the file is hashed
 * (xxhash64, the pipeline’s `sourceHash`), compared with every manifest and
 * with the photos added earlier in this session, then moved into its album
 * under a free name, with its modification time set from the browser’s
 * `lastModified`.
 */
import { randomBytes } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  hashBytes,
  HEIC_EXTENSIONS,
  isHeic,
  PHOTO_EXTENSIONS,
  RAW_EXTENSIONS,
} from '@minimalgallery/pipeline';
import {
  fileSlug,
  photoIdFor,
  stripExtension,
} from '@minimalgallery/pipeline/slug';
import { badRequest, conflict, notFound, onlyKeys } from './http.ts';
import type { GalleryEntry } from './registry.ts';
import { validAlbumId, validFileName } from './security.ts';
import { listAlbumDirs, readManifests } from './state.ts';

export const UPLOAD_DIR = '.minimalgallery/cache/uploads';
export const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_SIZE = 4 * 1024 * 1024 * 1024;
const MAX_SIDECAR_SIZE = 16 * 1024 * 1024;
export const SIDECAR_EXTENSIONS = new Set(['.xmp', '.md', '.json']);
const STALE_MS = 24 * 60 * 60 * 1000;

export type CompleteResult =
  | { status: 'added'; photoId?: string; path: string }
  | { status: 'duplicate'; sameAs: string; path: string }
  | { status: 'skipped'; reason: string }
  | { status: 'waiting' };

export interface Upload {
  id: string;
  album: string;
  name: string;
  size: number;
  lastModified: number;
  received: number;
  file: string;
  sidecarOf?: string;
  createdAt: number;
  /** Set once completed. */
  result?: CompleteResult;
  /** For an added photo: its folder and file name without extension, for its sidecars. */
  placed?: { dir: string; stem: string };
  /** Sidecars that completed before this photo. */
  waiting: Upload[];
  /** Chunk writes run one after another. */
  writing: Promise<unknown>;
}

export interface UploadContext {
  galleryDir: string;
  entry: GalleryEntry;
  /** Called after something was added to `photos/`. */
  added: () => void;
}

/** Why a file is not accepted, from its name; null when it is a photo. */
export function skipReason(name: string): string | null {
  const ext = extname(name).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) return null;
  if (HEIC_EXTENSIONS.has(ext)) return 'HEIC: export a JPEG instead';
  if (RAW_EXTENSIONS.has(ext)) return 'RAW: export a JPEG instead';
  if (SIDECAR_EXTENSIONS.has(ext))
    return 'a sidecar is added with its photo, in the same drop';
  return 'not a supported photo format';
}

/** Remove chunk files older than a day, and uploads whose files are gone. */
export async function sweepUploads(ctx: UploadContext): Promise<void> {
  const dir = join(ctx.galleryDir, UPLOAD_DIR);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {}
  const now = Date.now();
  for (const name of names) {
    const path = join(dir, name);
    const s = await stat(path).catch(() => null);
    if (s && now - s.mtimeMs > STALE_MS) await rm(path, { force: true });
  }
  for (const [id, u] of ctx.entry.uploads)
    if (now - u.createdAt > STALE_MS) ctx.entry.uploads.delete(id);
}

export async function createUpload(
  ctx: UploadContext,
  body: Record<string, unknown>
): Promise<{ id: string; chunkSize: number } | CompleteResult> {
  onlyKeys(body, ['album', 'name', 'size', 'lastModified', 'sidecarOf']);
  const { album, name, size, lastModified, sidecarOf } = body;
  if (typeof album !== 'string' || !validAlbumId(album))
    throw badRequest('album must be an album id, such as japan_2025/kyoto.');
  if (typeof name !== 'string' || !validFileName(name))
    throw badRequest('name must be a file name, with no folder.');
  if (!Number.isInteger(size) || (size as number) < 0)
    throw badRequest('size must be the file size in bytes.');
  if (
    lastModified !== undefined &&
    (typeof lastModified !== 'number' || !Number.isFinite(lastModified))
  )
    throw badRequest('lastModified must be milliseconds since 1970.');
  const ext = extname(name).toLowerCase();
  if (sidecarOf !== undefined) {
    const parent =
      typeof sidecarOf === 'string' ? ctx.entry.uploads.get(sidecarOf) : null;
    if (!parent || parent.sidecarOf)
      throw badRequest('sidecarOf must be the upload id of a photo.');
    if (!SIDECAR_EXTENSIONS.has(ext))
      throw badRequest('A sidecar is an .xmp, .md or .json file.');
    if ((size as number) > MAX_SIDECAR_SIZE)
      throw badRequest('This sidecar is too large.');
  } else {
    const reason = skipReason(name);
    if (reason) return { status: 'skipped', reason };
    if ((size as number) > MAX_SIZE)
      throw badRequest('This file is too large.');
  }
  // Completed uploads are kept a while, for sidecars that follow their photo.
  for (const [key, u] of ctx.entry.uploads)
    if (u.result && Date.now() - u.createdAt > 60 * 60 * 1000)
      ctx.entry.uploads.delete(key);
  const id = randomBytes(12).toString('base64url');
  const dir = join(ctx.galleryDir, UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  const file = join(dir, id);
  await (await open(file, 'w')).close();
  ctx.entry.uploads.set(id, {
    id,
    album,
    name,
    size: size as number,
    lastModified: (lastModified as number | undefined) ?? Date.now(),
    received: 0,
    file,
    ...(typeof sidecarOf === 'string' ? { sidecarOf } : {}),
    createdAt: Date.now(),
    waiting: [],
    writing: Promise.resolve(),
  });
  return { id, chunkSize: CHUNK_SIZE };
}

export function getUpload(ctx: UploadContext, id: string): Upload {
  const u = ctx.entry.uploads.get(id);
  if (!u) throw notFound(`There is no upload ${id}.`);
  return u;
}

/** Write one chunk at `offset`. A retry of an offset already received rewrites from there. */
export function writeChunk(
  ctx: UploadContext,
  id: string,
  offset: number,
  bytes: Buffer
): Promise<{ received: number }> {
  const u = getUpload(ctx, id);
  const job = u.writing.then(async () => {
    if (u.result)
      throw conflict('This upload is complete.', { received: u.received });
    if (offset > u.received)
      throw conflict(`Expected offset ${u.received}.`, {
        received: u.received,
      });
    if (offset + bytes.length > u.size)
      throw badRequest('This chunk goes past the declared size.');
    const handle = await open(u.file, 'r+');
    try {
      if (offset < u.received) await handle.truncate(offset);
      await handle.write(bytes, 0, bytes.length, offset);
    } finally {
      await handle.close();
    }
    u.received = offset + bytes.length;
    return { received: u.received };
  });
  u.writing = job.catch(() => {});
  return job;
}

export async function discardUpload(ctx: UploadContext, id: string) {
  const u = getUpload(ctx, id);
  await u.writing;
  ctx.entry.uploads.delete(id);
  await rm(u.file, { force: true });
  for (const s of u.waiting) {
    ctx.entry.uploads.delete(s.id);
    await rm(s.file, { force: true });
  }
}

/** Completions run one at a time, so two never pick the same name. */
function serialized<T>(entry: GalleryEntry, fn: () => Promise<T>): Promise<T> {
  const run = entry.lock.then(fn);
  entry.lock = run.catch(() => {});
  return run;
}

export function completeUpload(
  ctx: UploadContext,
  id: string
): Promise<CompleteResult> {
  const u = getUpload(ctx, id);
  return serialized(ctx.entry, async () => {
    await u.writing;
    if (u.result) return u.result;
    if (u.received !== u.size)
      throw conflict(`${u.size - u.received} bytes are missing.`, {
        received: u.received,
      });
    if (u.sidecarOf) return (u.result = await completeSidecar(ctx, u));
    u.result = await completePhoto(ctx, u);
    // Sidecars that arrived first follow the photo, or are dropped with it.
    for (const s of u.waiting) s.result = await placeSidecar(ctx, s, u);
    u.waiting = [];
    return u.result;
  });
}

async function moveFile(from: string, to: string) {
  try {
    await rename(from, to);
  } catch (e: any) {
    if (e?.code !== 'EXDEV') throw e;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

async function albumFolder(galleryDir: string, album: string) {
  const found = (await listAlbumDirs(galleryDir)).find((a) => a.id === album);
  if (found) return found.abs;
  const abs = join(galleryDir, 'photos', ...album.split('/'));
  await mkdir(abs, { recursive: true });
  return abs;
}

async function completePhoto(
  ctx: UploadContext,
  u: Upload
): Promise<CompleteResult> {
  const { galleryDir, entry } = ctx;
  const bytes = await readFile(u.file);
  if (isHeic(bytes)) {
    await rm(u.file, { force: true });
    return { status: 'skipped', reason: 'HEIC: export a JPEG instead' };
  }
  const hash = await hashBytes(bytes);
  const manifests = await readManifests(galleryDir);
  for (const m of manifests.values())
    if (
      m.sourceHash === hash &&
      (await stat(join(galleryDir, m.original.relativePath)).catch(() => null))
    ) {
      await rm(u.file, { force: true });
      return {
        status: 'duplicate',
        sameAs: m.id,
        path: m.original.relativePath,
      };
    }
  const earlier = entry.added.get(hash);
  if (earlier) {
    const still = await stat(join(galleryDir, earlier.path)).catch(() => null);
    if (still) {
      await rm(u.file, { force: true });
      return {
        status: 'duplicate',
        sameAs: earlier.photoId,
        path: earlier.path,
      };
    }
    entry.added.delete(hash);
  }

  const dir = await albumFolder(galleryDir, u.album);
  const entries = await readdir(dir);
  const stems = new Set(entries.map((e) => stripExtension(e).toLowerCase()));
  const slugs = new Set(
    entries
      .filter((e) => PHOTO_EXTENSIONS.has(extname(e).toLowerCase()))
      .map((e) => fileSlug(e))
  );
  const ids = new Set([
    ...manifests.keys(),
    ...[...entry.added.values()].map((a) => a.photoId),
  ]);
  const ext = extname(u.name);
  const stem = stripExtension(u.name);
  let name = u.name;
  for (
    let n = 2;
    stems.has(stripExtension(name).toLowerCase()) ||
    slugs.has(fileSlug(name)) ||
    ids.has(photoIdFor(u.album, name));
    n++
  )
    name = `${stem}-${n}${ext}`;
  const target = join(dir, name);
  await moveFile(u.file, target);
  const mtime = new Date(u.lastModified);
  await utimes(target, new Date(), mtime);

  const path = `photos/${relativeToPhotos(galleryDir, target)}`;
  const photoId = photoIdFor(u.album, name);
  entry.added.set(hash, { photoId, path });
  u.placed = { dir, stem: stripExtension(name) };
  ctx.added();
  return { status: 'added', photoId, path };
}

function relativeToPhotos(galleryDir: string, abs: string) {
  return abs
    .slice(join(galleryDir, 'photos').length + 1)
    .split(/[\\/]/)
    .join('/');
}

async function completeSidecar(
  ctx: UploadContext,
  u: Upload
): Promise<CompleteResult> {
  const parent = ctx.entry.uploads.get(u.sidecarOf!);
  if (!parent) {
    await rm(u.file, { force: true });
    return { status: 'skipped', reason: 'its photo upload is gone' };
  }
  if (!parent.result) {
    parent.waiting.push(u);
    return { status: 'waiting' };
  }
  const result = await placeSidecar(ctx, u, parent);
  if (result.status === 'added') ctx.added();
  return result;
}

async function placeSidecar(
  ctx: UploadContext,
  u: Upload,
  photo: Upload
): Promise<CompleteResult> {
  if (photo.result?.status !== 'added' || !photo.placed) {
    await rm(u.file, { force: true });
    return { status: 'skipped', reason: 'its photo was not added' };
  }
  const target = join(
    photo.placed.dir,
    `${photo.placed.stem}${extname(u.name).toLowerCase()}`
  );
  if (await stat(target).catch(() => null)) {
    await rm(u.file, { force: true });
    return { status: 'skipped', reason: 'a sidecar with that name exists' };
  }
  await moveFile(u.file, target);
  await utimes(target, new Date(), new Date(u.lastModified));
  return {
    status: 'added',
    path: `photos/${relativeToPhotos(ctx.galleryDir, target)}`,
  };
}
