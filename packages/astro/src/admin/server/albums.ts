/** Album folders and `_album.md`: create, edit, reorder. */
import { mkdir, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { parseUserDate, PHOTO_EXTENSIONS } from '@minimalgallery/pipeline';
import {
  fileSlug,
  photoIdFor,
  slugify,
  stripExtension,
} from '@minimalgallery/pipeline/slug';
import { badRequest, conflict, notFound, onlyKeys } from './http.ts';
import {
  bodyOf,
  readMarkdown,
  setValue,
  writeMarkdown,
} from './frontmatter.ts';
import { listAlbumDirs, type AlbumDir } from './state.ts';

/**
 * The folder path for a new album, slugged as the pipeline slugs album ids
 * (and as `minimalgallery add` does), so the folder path is also the id.
 */
export function albumSlug(path: string): string {
  return path
    .split(/[\\/]+/)
    .map((segment) => slugify(segment).replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export async function findAlbum(
  galleryDir: string,
  id: string
): Promise<AlbumDir> {
  const album = (await listAlbumDirs(galleryDir)).find((a) => a.id === id);
  if (!album) throw notFound(`There is no album ${id}.`);
  return album;
}

export async function createAlbum(
  galleryDir: string,
  body: Record<string, unknown>
): Promise<string> {
  onlyKeys(body, ['path', 'title']);
  if (typeof body.path !== 'string') throw badRequest('path must be a string.');
  const id = albumSlug(body.path);
  if (!id) throw badRequest('The album name has no letters or digits.');
  if (body.title !== undefined && typeof body.title !== 'string')
    throw badRequest('title must be a string.');
  const existing = (await listAlbumDirs(galleryDir)).find((a) => a.id === id);
  if (existing) throw conflict(`The album ${id} exists.`, { id });
  const abs = join(galleryDir, 'photos', ...id.split('/'));
  await mkdir(abs, { recursive: true });
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title) {
    const file = await readMarkdown(join(abs, '_album.md'));
    setValue(file.doc, ['title'], title);
    await writeMarkdown(file);
  }
  return id;
}

/** Photo files directly in an album folder. */
async function photoFiles(abs: string): Promise<string[]> {
  return (await readdir(abs, { withFileTypes: true }))
    .filter(
      (e) =>
        e.isFile() &&
        !e.name.startsWith('.') &&
        PHOTO_EXTENSIONS.has(extname(e.name).toLowerCase())
    )
    .map((e) => e.name);
}

const SORTS = ['date', 'name', 'manual'];

export async function updateAlbum(
  galleryDir: string,
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  onlyKeys(body, ['title', 'description', 'sort', 'cover', 'hidden', 'date']);
  const album = await findAlbum(galleryDir, id);
  const file = await readMarkdown(join(album.abs, '_album.md'));
  if ('title' in body) {
    const v = body.title;
    if (v !== null && typeof v !== 'string')
      throw badRequest('title must be a string or null.');
    setValue(file.doc, ['title'], v && v.trim() ? v.trim() : null);
  }
  if ('description' in body) {
    const v = body.description;
    if (v !== null && typeof v !== 'string')
      throw badRequest('description must be a string or null.');
    file.body = bodyOf(v);
  }
  if ('sort' in body) {
    const v = body.sort;
    if (v !== null && !SORTS.includes(v as string))
      throw badRequest("sort must be 'date', 'name', 'manual' or null.");
    setValue(file.doc, ['sort'], v);
  }
  if ('hidden' in body) {
    const v = body.hidden;
    if (v !== null && typeof v !== 'boolean')
      throw badRequest('hidden must be true, false or null.');
    setValue(file.doc, ['hidden'], v);
  }
  if ('date' in body) {
    const v = body.date;
    if (v !== null && (typeof v !== 'string' || !parseUserDate(v)))
      throw badRequest('date must look like 2005-02-27, or be null.');
    setValue(file.doc, ['date'], v);
  }
  if ('cover' in body) {
    const v = body.cover;
    if (v === null) setValue(file.doc, ['cover'], null);
    else if (typeof v !== 'string')
      throw badRequest('cover must be a string or null.');
    else {
      const files = await photoFiles(album.abs);
      const match = files.find(
        (f) =>
          f === v ||
          stripExtension(f) === v ||
          photoIdFor(album.id, f) === v ||
          fileSlug(f) === v
      );
      if (!match) throw badRequest(`${v} is not a photo in ${album.id}.`);
      setValue(file.doc, ['cover'], match);
    }
  }
  await writeMarkdown(file);
}

export async function orderAlbum(
  galleryDir: string,
  id: string,
  body: Record<string, unknown>
): Promise<void> {
  onlyKeys(body, ['order']);
  const order = body.order;
  if (!Array.isArray(order) || !order.every((f) => typeof f === 'string'))
    throw badRequest('order must be an array of file names.');
  const album = await findAlbum(galleryDir, id);
  const files = new Set(await photoFiles(album.abs));
  const unknown = order.filter((f) => !files.has(f));
  if (unknown.length)
    throw badRequest(
      `Not photos in ${album.id}: ${unknown.slice(0, 5).join(', ')}.`
    );
  if (new Set(order).size !== order.length)
    throw badRequest('order lists a file twice.');
  const file = await readMarkdown(join(album.abs, '_album.md'));
  setValue(file.doc, ['sort'], 'manual');
  setValue(file.doc, ['order'], order);
  await writeMarkdown(file);
}

/** True when `abs` is a folder. */
export const isDir = (abs: string) =>
  stat(abs).then(
    (s) => s.isDirectory(),
    () => false
  );
