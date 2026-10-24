/**
 * Photos whose originals are not in this gallery folder.
 *
 * Git publishing leaves the originals out of the repository, so a clone on
 * another computer, or in CI, has manifests for photos whose files are
 * somewhere else. A manifest without its photo is taken for a deleted photo
 * only when this folder had that photo before; otherwise the photo is
 * absent: it stays in the gallery as its manifest describes it, and is
 * never pruned. The folder’s record of the photos it has had is
 * `.minimalgallery/cache/seen.json`, which git ignores. The record names
 * the folder it belongs to, so a copy that carries the cache folder along
 * starts a new record instead of trusting the old one.
 */
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { albumIdFromPath } from './slug.ts';
import type { WalkedAlbum } from './walk.ts';

export const SEEN_FILE = '.minimalgallery/cache/seen.json';

/** The ids of the photos this folder has had, or an empty set. */
export async function readSeen(galleryDir: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(
      await readFile(join(galleryDir, SEEN_FILE), 'utf8')
    ) as { dir?: unknown; photos?: unknown };
    if (raw.dir === (await realpath(galleryDir)) && Array.isArray(raw.photos))
      return new Set(raw.photos.filter((id) => typeof id === 'string'));
  } catch {}
  return new Set();
}

/** Write the record, only when it changed. */
export async function writeSeen(
  galleryDir: string,
  ids: Iterable<string>
): Promise<void> {
  const path = join(galleryDir, SEEN_FILE);
  const text = `${JSON.stringify(
    { dir: await realpath(galleryDir), photos: [...ids].sort() },
    null,
    2
  )}\n`;
  try {
    if ((await readFile(path, 'utf8')) === text) return;
  } catch {}
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/**
 * Split the photos that have a manifest but no file here: `deleted` were in
 * this folder before (their manifests and derivatives may be pruned),
 * `absent` never were.
 */
export function missingPhotos(
  manifestIds: Iterable<string>,
  walkedIds: Set<string>,
  seen: Set<string>
): { deleted: string[]; absent: string[] } {
  const deleted: string[] = [];
  const absent: string[] = [];
  for (const id of manifestIds) {
    if (walkedIds.has(id)) continue;
    (seen.has(id) ? deleted : absent).push(id);
  }
  return { deleted: deleted.sort(), absent: absent.sort() };
}

/** The album folder of a manifest’s `source` (`japan/kyoto/a.jpg` gives `japan/kyoto`). */
export const albumPathOf = (source: string) =>
  source.slice(0, Math.max(0, source.lastIndexOf('/')));

/** Folder paths in walk order: depth first, each level by name. */
function comparePaths(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const c = x[i].localeCompare(y[i]);
    if (c) return c;
  }
  return x.length - y.length;
}

/**
 * The walked albums plus the album folders of absent photos (and their
 * parents) that are not in this folder, in the order and with the children
 * the walk would give if every folder were here. Returns `walked` itself
 * when nothing is missing.
 */
export function withAbsentAlbums(
  walked: WalkedAlbum[],
  albumPaths: Iterable<string>,
  photosDir: string
): WalkedAlbum[] {
  const byPath = new Map(walked.map((a) => [a.path, a]));
  let added = false;
  for (const path of albumPaths) {
    const segments = path.split('/').filter(Boolean);
    for (let i = 1; i <= segments.length; i++) {
      const p = segments.slice(0, i).join('/');
      if (byPath.has(p)) continue;
      byPath.set(p, {
        id: albumIdFromPath(p),
        path: p,
        parent:
          i > 1 ? albumIdFromPath(segments.slice(0, i - 1).join('/')) : null,
        absDir: join(photosDir, ...segments.slice(0, i)),
        children: [],
      });
      added = true;
    }
  }
  if (!added) return walked;
  const albums = [...byPath.values()]
    .sort((a, b) => comparePaths(a.path, b.path))
    .map((a) => ({ ...a, children: [] as string[] }));
  const byId = new Map(albums.map((a) => [a.id, a]));
  for (const a of albums) if (a.parent) byId.get(a.parent)?.children.push(a.id);
  return albums;
}
