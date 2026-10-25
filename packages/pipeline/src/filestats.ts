/**
 * What this folder last knew about each photo file: its size, modification
 * time and content hash, by photo id. A run skips a photo whose size and
 * modification time still match, without reading the file again.
 *
 * Modification times belong to one copy of the gallery: git does not keep
 * them, so every clone or checkout dates its files when it writes them. They
 * live here, in `.minimalgallery/cache/files.json`, which git ignores, and
 * never in the committed manifests, so a fresh copy rewrites none of those.
 * The record names the folder it belongs to, as `seen.json` does, so a copy
 * that carries the cache folder along starts a new record.
 */
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const FILE_STATS_FILE = '.minimalgallery/cache/files.json';

export interface FileStat {
  size: number;
  mtimeMs: number;
  sourceHash: string;
}

/** The record for this folder, or an empty map. */
export async function readFileStats(
  galleryDir: string
): Promise<Map<string, FileStat>> {
  try {
    const raw = JSON.parse(
      await readFile(join(galleryDir, FILE_STATS_FILE), 'utf8')
    ) as { dir?: unknown; photos?: unknown };
    if (
      raw.dir === (await realpath(galleryDir)) &&
      raw.photos &&
      typeof raw.photos === 'object'
    )
      return new Map(
        Object.entries(raw.photos as Record<string, FileStat>).filter(
          ([, s]) =>
            typeof s?.size === 'number' &&
            typeof s.mtimeMs === 'number' &&
            typeof s.sourceHash === 'string'
        )
      );
  } catch {}
  return new Map();
}

/** Write the record, only when it changed. */
export async function writeFileStats(
  galleryDir: string,
  stats: Map<string, FileStat>
): Promise<void> {
  const path = join(galleryDir, FILE_STATS_FILE);
  const photos = Object.fromEntries(
    [...stats].sort(([a], [b]) => a.localeCompare(b))
  );
  const text = `${JSON.stringify(
    { dir: await realpath(galleryDir), photos },
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
