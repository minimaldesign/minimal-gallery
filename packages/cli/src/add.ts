import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  constants,
  copyFile,
  mkdir,
  readdir,
  stat,
  utimes,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { HEIC_EXTENSIONS, RAW_EXTENSIONS } from '@minimalgallery/pipeline';
import { fileSlug, stripExtension } from '@minimalgallery/pipeline/slug';
import { albumSlug } from './album.ts';
import { CliError } from './errors.ts';

/** Formats the pipeline reads (kept in step with the pipeline’s walker). */
export const PHOTO_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.tif',
  '.tiff',
]);
/** Sidecars copied with their photo when they sit next to it. */
const SIDECAR_EXTENSIONS = ['.xmp'];

export interface AddedFile {
  /** Source path. */
  from: string;
  /** Destination, relative to the gallery root. */
  to: string;
  /** True when the file was given a new name to avoid a clash. */
  renamed: boolean;
  sidecars: string[];
}

export interface DuplicateFile {
  from: string;
  /** The file with the same content: relative to the gallery root, or a source path. */
  sameAs: string;
}

export interface SkippedFile {
  from: string;
  reason: string;
}

export interface AddResult {
  album: string;
  /** Relative to the gallery root, `photos/<album>`. */
  albumDir: string;
  added: AddedFile[];
  duplicates: DuplicateFile[];
  skipped: SkippedFile[];
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const isHidden = (name: string) => name.startsWith('.');

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (isHidden(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function skipReason(file: string): string {
  const ext = extname(file).toLowerCase();
  if (HEIC_EXTENSIONS.has(ext)) return 'HEIC: export a JPEG instead';
  if (RAW_EXTENSIONS.has(ext)) return 'RAW: export a JPEG instead';
  return 'not a supported photo format';
}

/** The default album name: the folder given, or the folder of the first file. */
function defaultAlbumName(inputs: string[], dirs: Set<string>): string {
  const first = inputs[0];
  return dirs.has(first) ? basename(first) : basename(dirname(first));
}

/**
 * Copy photos into `photos/<album>/` under the gallery root. Files whose
 * content is already somewhere in `photos/` (or earlier in the same batch)
 * are reported as duplicates and not copied. A name already used in the
 * album, or one that would give the same photo id, gets a `-2`, `-3` suffix.
 * Sidecars (`photo.jpg.xmp` and `photo.xmp`) come along.
 * Modification times are kept, since the pipeline falls back to them for
 * undated photos. Nothing is processed here.
 */
export async function addPhotos(
  root: string,
  inputs: string[],
  options: { album?: string } = {}
): Promise<AddResult> {
  if (!inputs.length) throw new CliError('Give a folder or some photo files.');
  const resolved = inputs.map((p) => resolve(p));
  const dirs = new Set<string>();
  const candidates: string[] = [];
  for (const input of resolved) {
    let info;
    try {
      info = await stat(input);
    } catch {
      throw new CliError(`Not found: ${input}`);
    }
    if (info.isDirectory()) {
      dirs.add(input);
      candidates.push(...(await listFiles(input)));
    } else candidates.push(input);
  }

  const album = albumSlug(options.album ?? defaultAlbumName(resolved, dirs));
  if (!album)
    throw new CliError(
      'The album name has no letters or digits. Pass --album <name>.'
    );
  const photosDir = join(root, 'photos');
  const albumDir = join(photosDir, ...album.split('/'));

  const result: AddResult = {
    album,
    albumDir: relative(root, albumDir),
    added: [],
    duplicates: [],
    skipped: [],
  };

  const sidecarSet = new Set<string>();
  const photos: string[] = [];
  for (const file of [...new Set(candidates)].sort()) {
    const ext = extname(file).toLowerCase();
    if (PHOTO_EXTENSIONS.has(ext)) photos.push(file);
    else if (SIDECAR_EXTENSIONS.includes(ext)) sidecarSet.add(file);
    else result.skipped.push({ from: file, reason: skipReason(file) });
  }
  if (!photos.length) return result;

  // Hash only the existing files whose size matches an incoming one.
  const existing = (await pathExists(photosDir))
    ? (await listFiles(photosDir)).filter((f) =>
        PHOTO_EXTENSIONS.has(extname(f).toLowerCase())
      )
    : [];
  const incomingSizes = new Set(
    await Promise.all(photos.map(async (f) => (await stat(f)).size))
  );
  const known = new Map<string, string>();
  for (const file of existing) {
    if (!incomingSizes.has((await stat(file)).size)) continue;
    known.set(await hashFile(file), relative(root, file));
  }

  // Names and photo slugs already taken in the album folder.
  const takenNames = new Set<string>();
  const takenSlugs = new Set<string>();
  if (await pathExists(albumDir)) {
    for (const entry of await readdir(albumDir)) {
      takenNames.add(entry.toLowerCase());
      if (PHOTO_EXTENSIONS.has(extname(entry).toLowerCase()))
        takenSlugs.add(fileSlug(entry));
    }
  }

  await mkdir(albumDir, { recursive: true });
  for (const from of photos) {
    const hash = await hashFile(from);
    const sameAs = known.get(hash);
    if (sameAs) {
      result.duplicates.push({ from, sameAs });
      continue;
    }

    const ext = extname(from);
    const stem = stripExtension(basename(from));
    let name = basename(from);
    for (
      let n = 2;
      takenNames.has(name.toLowerCase()) || takenSlugs.has(fileSlug(name));
      n++
    )
      name = `${stem}-${n}${ext}`;
    const newStem = stripExtension(name);
    const to = join(albumDir, name);
    await copyAndKeepTime(from, to);
    takenNames.add(name.toLowerCase());
    takenSlugs.add(fileSlug(name));
    known.set(hash, relative(root, to));

    const sidecars: string[] = [];
    // `photo.jpg.xmp`, named after the whole file, then `photo.xmp`.
    const bases: Array<[from: string, to: string]> = [
      [basename(from), name],
      [stem, newStem],
    ];
    for (const [fromBase, toBase] of bases) {
      for (const variant of ['.xmp', '.XMP']) {
        const side = join(dirname(from), `${fromBase}${variant}`);
        if (!sidecarSet.has(side) && !(await pathExists(side))) continue;
        const sideName = `${toBase}.xmp`;
        if (takenNames.has(sideName.toLowerCase())) break;
        await copyAndKeepTime(side, join(albumDir, sideName));
        takenNames.add(sideName.toLowerCase());
        sidecars.push(join(result.albumDir, sideName));
        break;
      }
    }

    result.added.push({
      from,
      to: relative(root, to),
      renamed: name !== basename(from),
      sidecars,
    });
  }
  return result;
}

async function copyAndKeepTime(from: string, to: string): Promise<void> {
  await copyFile(from, to, constants.COPYFILE_EXCL);
  const s = await stat(from);
  await utimes(to, s.atime, s.mtime);
}
