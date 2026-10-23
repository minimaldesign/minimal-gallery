import { note } from '@clack/prompts';
import { parse } from '../args.ts';
import { runPipeline } from '../pipeline.ts';
import { requireGalleryRoot } from '../root.ts';
import { pipelineRows, table } from '../ui.ts';

export const SYNC_USAGE = `Usage: minimalgallery sync [--prune] [--force]

Processes every photo in photos/ that is new or changed.
  --prune   remove the derivatives and manifests of deleted photos
  --force   encode every photo again`;

export async function syncCommand(args: string[], dir?: string) {
  const { values } = parse(
    args,
    {
      prune: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
    SYNC_USAGE
  );
  const root = await requireGalleryRoot(dir);
  const summary = await runPipeline(root, {
    prune: values.prune,
    force: values.force,
  });
  note(table(pipelineRows(summary)), 'Synced');
  if (summary.orphans.length && !values.prune)
    console.log(
      `${summary.orphans.length} deleted photo(s) still have derivatives. Run minimalgallery sync --prune to remove them.`
    );
  return summary.errors.length ? 1 : 0;
}
