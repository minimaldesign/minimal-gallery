import { adminPath, ADMIN_PATH } from '@minimalgallery/pipeline/admin';
import { parse } from '../args.ts';
import { CliError } from '../errors.ts';
import { localBin, run } from '../exec.ts';
import { requireGalleryRoot } from '../root.ts';

export const ADMIN_USAGE = `Usage: minimalgallery admin [--port <number>] [-- <astro dev options>]

Starts the Astro dev server and opens the browser admin at /admin/:
add photos by dropping them in, edit titles, captions and albums, change
the settings and publish. The admin processes photos as they land in
photos/, including files you copy there in Finder, and the preview reloads
as they do. It runs only on this computer and is never part of the built
site. Press Ctrl+C to stop it.

The admin is at http://localhost:4800/admin/ unless server.port in
astro.config.mjs or --port chooses another port. When an album or a page
already uses /admin/, the admin is at /mg/admin/ instead.`;

export { ADMIN_PATH };

/** The `astro dev` arguments for the admin: open it, unless the caller already chose. */
export function adminDevArgs(extra: string[], path = ADMIN_PATH): string[] {
  const opens = extra.some((a) => a === '--open' || a.startsWith('--open='));
  return ['dev', ...(opens ? [] : ['--open', path]), ...extra];
}

export async function adminCommand(args: string[], dir?: string) {
  const { values, positionals } = parse(
    args,
    { port: { type: 'string' } },
    ADMIN_USAGE
  );
  const port = values.port;
  if (port !== undefined && !/^\d+$/.test(port))
    throw new CliError(`--port needs a number, not ${port}.\n\n${ADMIN_USAGE}`);
  const root = await requireGalleryRoot(dir);
  const astro = localBin(root, 'astro');
  if (!astro)
    throw new CliError(
      'Astro is not installed in this gallery. Run npm install first.'
    );
  // Ctrl+C reaches astro too; wait for it to exit.
  process.on('SIGINT', () => {});
  const extra =
    port === undefined ? positionals : ['--port', port, ...positionals];
  return run(astro, adminDevArgs(extra, adminPath(root)), root);
}
