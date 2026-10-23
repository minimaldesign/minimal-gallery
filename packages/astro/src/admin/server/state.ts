/**
 * The gallery as the admin shows it: albums (folders, `_albums.json` and
 * `_album.md`), photo summaries from the manifests, the config, and the
 * admin’s own small state file.
 */
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseUserDate } from '@minimalgallery/pipeline';
import type { GalleryConfig } from '@minimalgallery/pipeline/config';
import {
  ALBUMS_FILE,
  MANIFEST_DIR,
  STAGE_DIR,
  type AlbumManifest,
  type AlbumSort,
  type PhotoManifest,
} from '@minimalgallery/pipeline/schema';
import {
  albumIdFromPath,
  photoIdFor,
  titleFromFolder,
} from '@minimalgallery/pipeline/slug';
import { readMarkdown, toPlain } from './frontmatter.ts';

export const ADMIN_FILE = '.minimalgallery/cache/admin.json';

export type Attention = 'date-from-mtime' | 'no-exif' | 'duplicate';

export interface PhotoSummary {
  id: string;
  album: string;
  file: string;
  source: string;
  slug: string;
  title: string;
  date: string;
  dateSource: PhotoManifest['dateSource'];
  width: number;
  height: number;
  hidden: boolean;
  rating: number | null;
  color: string;
  thumb: string;
  attention: Attention[];
  duplicateOf?: string[];
}

export interface AlbumSummary {
  id: string;
  path: string;
  parent: string | null;
  title: string;
  description: string | null;
  sort: AlbumSort;
  order: string[];
  cover: string | null;
  hidden: boolean;
  date: string | null;
  count: number;
  children: string[];
}

export interface AlbumDir {
  id: string;
  /** Folder path under `photos/`, `/`-separated. */
  path: string;
  parent: string | null;
  abs: string;
  children: string[];
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e: any) {
    if (e?.code === 'ENOENT' || e instanceof SyntaxError) return undefined;
    throw e;
  }
}

export async function writeJsonFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

const looksLikeManifest = (v: any): v is PhotoManifest =>
  v &&
  typeof v.id === 'string' &&
  typeof v.album === 'string' &&
  Array.isArray(v.variants);

/** Every photo manifest, by id. Files that do not parse are left out. */
export async function readManifests(
  galleryDir: string
): Promise<Map<string, PhotoManifest>> {
  const dir = join(galleryDir, MANIFEST_DIR);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return new Map();
    throw e;
  }
  const out = new Map<string, PhotoManifest>();
  await Promise.all(
    files
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map(async (f) => {
        const m = await readJsonFile(join(dir, f));
        if (looksLikeManifest(m)) out.set(m.id, m);
      })
  );
  return out;
}

export async function readManifest(
  galleryDir: string,
  id: string
): Promise<PhotoManifest | null> {
  const m = await readJsonFile(join(galleryDir, MANIFEST_DIR, `${id}.json`));
  return looksLikeManifest(m) ? m : null;
}

export async function readAlbumsFile(
  galleryDir: string
): Promise<AlbumManifest[]> {
  const v = (await readJsonFile(
    join(galleryDir, MANIFEST_DIR, ALBUMS_FILE)
  )) as { albums?: AlbumManifest[] } | undefined;
  return Array.isArray(v?.albums) ? v.albums : [];
}

/** Album folders under `photos/`, depth first in name order, as the pipeline walks them. */
export async function listAlbumDirs(galleryDir: string): Promise<AlbumDir[]> {
  const root = join(galleryDir, 'photos');
  const out: AlbumDir[] = [];
  const visit = async (rel: string, parent: AlbumDir | null) => {
    let entries;
    try {
      entries = await readdir(rel ? join(root, ...rel.split('/')) : root, {
        withFileTypes: true,
      });
    } catch (e: any) {
      if (e?.code === 'ENOENT') return;
      throw e;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      const album: AlbumDir = {
        id: albumIdFromPath(path),
        path,
        parent: parent?.id ?? null,
        abs: join(root, ...path.split('/')),
        children: [],
      };
      out.push(album);
      parent?.children.push(album.id);
      await visit(path, album);
    }
  };
  await visit('', null);
  return out;
}

/** Photo ids by source hash, for the `duplicate` badge. */
export function duplicateIndex(
  manifests: Iterable<PhotoManifest>
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of manifests) {
    const list = out.get(m.sourceHash);
    if (list) list.push(m.id);
    else out.set(m.sourceHash, [m.id]);
  }
  return out;
}

/** `<base>_mg/`, where the dev server serves media. */
export const mediaBaseOf = (base: string) =>
  `${base.endsWith('/') ? base : `${base}/`}_mg/`;

export const colorCss = ({ l, c, h }: PhotoManifest['color']) =>
  `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${(h || 0).toFixed(1)})`;

export function photoSummary(
  m: PhotoManifest,
  mediaBase: string,
  dupes: Map<string, string[]>
): PhotoSummary {
  const e = m.exposure;
  const attention: Attention[] = [];
  if (m.dateSource === 'mtime') attention.push('date-from-mtime');
  if (
    m.camera === null &&
    m.lens === null &&
    Object.values(e ?? {}).every((v) => v === null)
  )
    attention.push('no-exif');
  const others = (dupes.get(m.sourceHash) ?? []).filter((id) => id !== m.id);
  if (others.length) attention.push('duplicate');
  const grid =
    m.variants.find((v) => v.name === 'grid') ??
    [...m.variants].sort((a, b) => a.width - b.width)[0];
  return {
    id: m.id,
    album: m.album,
    file: m.file,
    source: m.source,
    slug: m.slug,
    title: m.title,
    date: m.date,
    dateSource: m.dateSource,
    width: m.width,
    height: m.height,
    hidden: m.hidden,
    rating: m.rating,
    color: colorCss(m.color),
    thumb: grid ? `${mediaBase}${grid.key}` : '',
    attention,
    ...(others.length ? { duplicateOf: others } : {}),
  };
}

const asString = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v : undefined;

/**
 * Albums in tree order. Values come from `_albums.json` (the last run), then
 * from each `_album.md` as it is now, so an edit shows before the next run.
 * Folders the last run has not seen are included.
 */
export async function albumSummaries(
  galleryDir: string,
  config: Pick<GalleryConfig, 'albums'>,
  ordered: PhotoManifest[]
): Promise<AlbumSummary[]> {
  const [dirs, entries] = await Promise.all([
    listAlbumDirs(galleryDir),
    readAlbumsFile(galleryDir),
  ]);
  const byId = new Map(entries.map((a) => [a.id, a]));
  const counts = new Map<string, number>();
  for (const m of ordered) counts.set(m.album, (counts.get(m.album) ?? 0) + 1);
  return Promise.all(
    dirs.map(async (d): Promise<AlbumSummary> => {
      const entry = byId.get(d.id);
      let fm: Record<string, unknown> = {};
      let description: string | null | undefined;
      try {
        const file = await readMarkdown(join(d.abs, '_album.md'));
        if (file.exists) {
          fm = toPlain(file.doc);
          description = file.body.trim() || null;
        }
      } catch {
        // An unreadable _album.md: the run reports it; show the last good values.
      }
      const sort = (['date', 'name', 'manual'] as const).find(
        (s) => s === fm.sort
      );
      const coverFile = asString(fm.cover);
      return {
        id: d.id,
        path: d.path,
        parent: d.parent,
        title: asString(fm.title) ?? entry?.title ?? titleFromFolder(d.path),
        description:
          description !== undefined
            ? description
            : (entry?.description ?? null),
        sort: sort ?? entry?.sort ?? config.albums.sort,
        order: Array.isArray(fm.order)
          ? fm.order.map(String)
          : (entry?.order ?? []),
        cover: coverFile ? photoIdFor(d.id, coverFile) : (entry?.cover ?? null),
        hidden:
          typeof fm.hidden === 'boolean' ? fm.hidden : (entry?.hidden ?? false),
        date:
          fm.date !== undefined
            ? (parseUserDate(fm.date) ?? null)
            : (entry?.date ?? null),
        count: counts.get(d.id) ?? 0,
        children: d.children,
      };
    })
  );
}

/**
 * Photos album by album, each in its display order from `_albums.json`. A
 * manifest the albums file does not list yet (written during a run) follows
 * its album’s listed photos, when its file still exists.
 */
export async function orderedPhotos(
  galleryDir: string,
  manifests: Map<string, PhotoManifest>
): Promise<PhotoManifest[]> {
  const [dirs, entries] = await Promise.all([
    listAlbumDirs(galleryDir),
    readAlbumsFile(galleryDir),
  ]);
  const listed = new Map(entries.map((a) => [a.id, a.photoIds]));
  const unlisted = new Map<string, PhotoManifest[]>();
  const seen = new Set(entries.flatMap((a) => a.photoIds));
  for (const m of manifests.values()) {
    if (seen.has(m.id)) continue;
    const list = unlisted.get(m.album);
    if (list) list.push(m);
    else unlisted.set(m.album, [m]);
  }
  const out: PhotoManifest[] = [];
  for (const d of dirs) {
    for (const id of listed.get(d.id) ?? []) {
      const m = manifests.get(id);
      if (m) out.push(m);
    }
    const extra = (unlisted.get(d.id) ?? []).sort((a, b) =>
      a.file.localeCompare(b.file)
    );
    for (const m of extra) {
      const exists = await stat(join(galleryDir, m.original.relativePath)).then(
        () => true,
        () => false
      );
      if (exists) out.push(m);
    }
  }
  return out;
}

export interface AdminFile {
  previewed?: boolean;
  published?: boolean;
  lastPublish?: {
    method: string;
    state: 'done' | 'failed';
    url: string | null;
    code: number | null;
    at: string;
  };
}

export async function readAdminFile(galleryDir: string): Promise<AdminFile> {
  const v = await readJsonFile(join(galleryDir, ADMIN_FILE));
  return v && typeof v === 'object' ? (v as AdminFile) : {};
}

export async function updateAdminFile(
  galleryDir: string,
  patch: Partial<AdminFile>
): Promise<AdminFile> {
  const next = { ...(await readAdminFile(galleryDir)), ...patch };
  await writeJsonFile(join(galleryDir, ADMIN_FILE), next);
  return next;
}

/** `{ pending }` in bucket mode: staged files that wait for an upload. */
export async function bucketState(
  galleryDir: string,
  config: Pick<GalleryConfig, 'storage' | 'originals'>,
  manifests: Iterable<PhotoManifest>
): Promise<{ pending: number } | null> {
  if (config.storage.mode !== 's3') return null;
  // TODO(bucket mode): after the merge, use `planBucketSync(galleryDir,
  // config)` from @minimalgallery/pipeline: `upload.length` is the exact
  // count, since it also knows which staged keys the bucket already holds.
  // Until then: every key a manifest references that is still in the stage.
  const keys: string[] = [];
  for (const m of manifests) {
    for (const v of m.variants) keys.push(v.key);
    if (config.originals === 'bucket' && m.original.key)
      keys.push(m.original.key);
  }
  const stage = join(galleryDir, STAGE_DIR);
  const staged = await Promise.all(
    keys.map((k) =>
      stat(join(stage, ...k.split('/'))).then(
        () => true,
        () => false
      )
    )
  );
  return { pending: staged.filter(Boolean).length };
}
