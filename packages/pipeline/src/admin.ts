import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from './slug.ts';

/** Where `astro dev` serves the admin, under the site's base. */
export const ADMIN_PATH = '/admin/';
/** Where the admin goes when the gallery already has an `/admin/` page. */
export const ADMIN_FALLBACK_PATH = '/mg/admin/';

const PAGE_FILES = ['admin', 'admin.astro', 'admin.md', 'admin.mdx'];

/**
 * The admin's path, without the base: `/admin/`, or `/mg/admin/` when a
 * top-level album folder in `photos/` slugs to `admin` or `src/pages` has
 * its own `admin` route, so the admin never hides a page of the gallery.
 * `root` is the Astro project root, when it is not the gallery folder.
 */
export function adminPath(galleryDir: string, root = galleryDir): string {
  let folders: string[] = [];
  try {
    folders = readdirSync(join(galleryDir, 'photos'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // no photos/ yet
  }
  const taken =
    folders.some((name) => slugify(name) === 'admin') ||
    PAGE_FILES.some((f) => existsSync(join(root, 'src', 'pages', f)));
  return taken ? ADMIN_FALLBACK_PATH : ADMIN_PATH;
}
