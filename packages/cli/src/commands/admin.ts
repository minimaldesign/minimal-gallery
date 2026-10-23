import { log } from '@clack/prompts';
import { parse } from '../args.ts';
import { CliError } from '../errors.ts';
import { localBin, run } from '../exec.ts';
import { requireGalleryRoot } from '../root.ts';
import { watchGallery } from './watch.ts';

export const ADMIN_USAGE = `Usage: minimalgallery admin [-- <astro dev options>]

The browser admin is not built yet. Until it is, this processes photos as
they land in photos/ and starts the Astro dev server, which shows the
gallery and reloads as it changes.`;

export async function adminCommand(args: string[], dir?: string) {
  const { positionals } = parse(args, {}, ADMIN_USAGE);
  const root = await requireGalleryRoot(dir);
  const astro = localBin(root, 'astro');
  if (!astro)
    throw new CliError(
      'Astro is not installed in this gallery. Run npm install first.'
    );
  log.info(
    'The browser admin (drag and drop, editing, a publish button) arrives in a later version.\n' +
      'For now: drop photos into photos/<album>/ in Finder or run minimalgallery add, and the preview below updates.'
  );
  const stop = await watchGallery(root);
  // Ctrl+C reaches astro too; wait for it to exit, then stop watching.
  process.on('SIGINT', () => {});
  try {
    return await run(astro, ['dev', '--open', ...positionals], root);
  } finally {
    await stop();
  }
}
