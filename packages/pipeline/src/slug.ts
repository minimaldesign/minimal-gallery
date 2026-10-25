/**
 * Slugs and ids, following the v0.8 convention in legacy `mg_brain.php`:
 * lowercase, with non-alphanumeric characters replaced by `_`.
 *
 * Difference from v0.8: the legacy regex replaced each character on its own
 * and kept `+`. Here every run of non-alphanumeric characters becomes a
 * single `_`, as specified for v2. The two agree for every file in examples/demo
 * gallery.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

/** Strip the last extension from a file name. */
export function stripExtension(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** Album id: slugged folder path segments joined by `/`. */
export function albumIdFromPath(relativeDir: string): string {
  return relativeDir
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(slugify)
    .join('/');
}

/** Photo id: `<album-slug>__<file-slug>`, where nested album segments are joined by `_`. */
export function photoIdFor(albumId: string, file: string): string {
  return `${albumId.replaceAll('/', '_')}__${slugify(stripExtension(file))}`;
}

/** The last path segment of a photo id, used as the URL slug inside its album. */
export function fileSlug(file: string): string {
  return slugify(stripExtension(file));
}

/**
 * Title from a file name, used only when no sidecar, XMP or IPTC title
 * exists: basename with `_` and `-` turned into spaces and the first letter
 * capitalized (`lazy-sunday-afternoons.jpg` gives `Lazy sunday afternoons`).
 * The other letters keep their case.
 */
export function titleFromFile(file: string): string {
  const name = stripExtension(file)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/**
 * Album title from its folder path: the last segment, with `_` and `-` turned
 * into spaces and the first letter capitalized (`light` gives `Light`,
 * `japan-2025/kyoto_east` gives `Kyoto east`). Used when `_album.md` sets no
 * title.
 */
export function titleFromFolder(path: string): string {
  const name = (path.split('/').pop() ?? path)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}
