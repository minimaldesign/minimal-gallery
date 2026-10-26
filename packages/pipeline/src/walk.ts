import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  HEIC_EXTENSIONS,
  unsupportedKindOfExtension,
  type UnsupportedKind,
} from './formats.ts';
import { albumIdFromPath, photoIdFor, fileSlug } from './slug.ts';

export const PHOTO_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.tif',
  '.tiff',
  ...HEIC_EXTENSIONS,
]);

export interface WalkedAlbum {
  id: string;
  /** Folder path relative to `photos/`, `/`-separated. */
  path: string;
  parent: string | null;
  absDir: string;
  children: string[];
}

export interface WalkedPhoto {
  id: string;
  albumId: string;
  file: string;
  slug: string;
  abs: string;
  /** Absolute path without the extension, for sidecar lookup. */
  absNoExt: string;
  /** Relative to the gallery directory, `/`-separated. */
  relativePath: string;
  /** Relative to `photos/`, `/`-separated: the manifest’s `source`. */
  source: string;
}

/** A RAW file, or a HEIC file that loses to a photo of the same name. */
export interface UnsupportedFile {
  /** Relative to the gallery directory. */
  relativePath: string;
  kind: UnsupportedKind;
  /**
   * True when a supported image with the same name sits next to it (a RAW +
   * JPEG or HEIC + JPEG pair): the JPEG is used and this file is ignored,
   * which is not an error. Always true for HEIC.
   */
  hasSibling: boolean;
}

export interface WalkResult {
  albums: WalkedAlbum[];
  photos: WalkedPhoto[];
  unsupported: UnsupportedFile[];
  warnings: string[];
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/**
 * Walk `<gallery>/photos/`. Every folder is an album; nesting is allowed.
 * Dotfiles and dot-folders are skipped, as are sidecars (`.md`, `.xmp`,
 * `.json`) and any file that is not a supported image. RAW files, and HEIC
 * files with a JPEG or other non-HEIC photo of the same name, are listed in
 * `unsupported`.
 * Throws when two albums or two photos map to the same id.
 */
export async function walkPhotos(galleryDir: string): Promise<WalkResult> {
  const root = join(galleryDir, 'photos');
  const albums: WalkedAlbum[] = [];
  const photos: WalkedPhoto[] = [];
  const warnings: string[] = [];
  const unsupported: UnsupportedFile[] = [];
  const albumPaths = new Map<string, string>();
  const photoPaths = new Map<string, string>();
  const errors: string[] = [];

  const visit = async (
    rel: string,
    parent: string | null
  ): Promise<string | null> => {
    const absDir = rel ? join(root, ...rel.split('/')) : root;
    const entries = (await readdir(absDir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    );
    // Names of the photos that win over a RAW or HEIC file of the same name.
    const stems = new Set(
      entries
        .filter(
          (e) =>
            e.isFile() &&
            PHOTO_EXTENSIONS.has(extOf(e.name)) &&
            !HEIC_EXTENSIONS.has(extOf(e.name))
        )
        .map((e) =>
          e.name.slice(0, e.name.length - extOf(e.name).length).toLowerCase()
        )
    );
    let album: WalkedAlbum | null = null;
    if (rel) {
      const id = albumIdFromPath(rel);
      const clash = albumPaths.get(id);
      if (clash)
        errors.push(`album id “${id}” is used by both “${clash}” and “${rel}”`);
      albumPaths.set(id, rel);
      album = { id, path: rel, parent, absDir, children: [] };
      albums.push(album);
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const childId = await visit(childRel, album?.id ?? null);
        if (album && childId) album.children.push(childId);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = extOf(e.name);
      const hasSibling = stems.has(
        e.name.slice(0, e.name.length - ext.length).toLowerCase()
      );
      const badKind = unsupportedKindOfExtension(ext);
      if (badKind || (HEIC_EXTENSIONS.has(ext) && hasSibling)) {
        unsupported.push({
          relativePath: `photos/${childRel}`,
          kind: badKind ?? 'heic',
          hasSibling,
        });
        continue;
      }
      if (!PHOTO_EXTENSIONS.has(ext)) continue;
      if (!album) {
        warnings.push(
          `skipped “${e.name}”: photos must be inside an album folder under photos/`
        );
        continue;
      }
      const id = photoIdFor(album.id, e.name);
      const clash = photoPaths.get(id);
      if (clash)
        errors.push(
          `photo id “${id}” is used by both “${clash}” and “${childRel}”`
        );
      photoPaths.set(id, childRel);
      const abs = join(absDir, e.name);
      photos.push({
        id,
        albumId: album.id,
        file: e.name,
        slug: fileSlug(e.name),
        abs,
        absNoExt: abs.slice(0, abs.length - extOf(e.name).length),
        relativePath: `photos/${childRel}`,
        source: childRel,
      });
    }
    return album?.id ?? null;
  };

  await visit('', null);
  if (errors.length) {
    throw new Error(
      `id collision:\n  ${errors.join('\n  ')}\nRename one of the files or folders.`
    );
  }
  return { albums, photos, unsupported, warnings };
}
