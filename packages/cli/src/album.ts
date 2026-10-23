import { slugify } from '@minimalgallery/pipeline/slug';

/**
 * The folder name for an album, slugged the way the pipeline slugs album ids
 * (lowercase, every run of other characters replaced by `_`), so the folder
 * name and the album id are the same. `/` separates nested albums. Leading
 * and trailing `_` are dropped. Empty when nothing usable is left.
 */
export function albumSlug(name: string): string {
  return name
    .split(/[\\/]+/)
    .map((segment) => slugify(segment).replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('/');
}
