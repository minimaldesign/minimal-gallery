/**
 * The admin page reads its token and API address here. The values live on
 * `globalThis` because the page runs in a module that Vite loads apart from
 * the integration, and because they must survive a dev-server restart.
 * This file imports nothing, so the page pulls no server code into its bundle.
 */

export const REGISTRY_KEY = Symbol.for('@minimalgallery/astro/admin');

export interface AdminInfo {
  /** Sent as `x-mg-admin` on every API call (`?token=` for the event stream). */
  token: string;
  /** The API base URL, `<base>admin/api`, without a trailing slash. */
  api: string;
}

/** The part of the registry this file needs; the server keeps more in each entry. */
export interface RegistryRoot {
  /** The gallery directory of the last admin created in this process. */
  current?: string;
  galleries: Map<string, AdminInfo>;
}

export function registryRoot(): RegistryRoot {
  const g = globalThis as Record<symbol, RegistryRoot | undefined>;
  return (g[REGISTRY_KEY] ??= { galleries: new Map() });
}

/** The token and API address of the running admin (the last one created, by default). */
export function getAdminInfo(galleryDir?: string): AdminInfo {
  const root = registryRoot();
  const entry = root.galleries.get(galleryDir ?? root.current ?? '');
  if (!entry)
    throw new Error(
      'The minimalgallery admin is not running: it exists only under astro dev.'
    );
  return { token: entry.token, api: entry.api };
}

export function getAdminToken(galleryDir?: string): string {
  return getAdminInfo(galleryDir).token;
}

/**
 * The admin page's URL (`<base>admin/`), or undefined when the admin is not
 * running: under `astro build`, or before the dev server has started it.
 */
export function adminPage(galleryDir?: string): string | undefined {
  const root = registryRoot();
  const entry = root.galleries.get(galleryDir ?? root.current ?? '');
  return entry?.api.replace(/api$/, '');
}
