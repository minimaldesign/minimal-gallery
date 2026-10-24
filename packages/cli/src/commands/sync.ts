import { cancel, confirm, isCancel, log, note } from '@clack/prompts';
import { pendingUploads } from '@minimalgallery/pipeline';
import { loadConfig } from '@minimalgallery/pipeline/config';
import { formatBytes } from '@minimalgallery/pipeline/doctor';
import { parse } from '../args.ts';
import { pruneBucketFiles, uploadStaged } from '../bucket.ts';
import { CliError } from '../errors.ts';
import { runPipeline } from '../pipeline.ts';
import { requireGalleryRoot } from '../root.ts';
import { pipelineRows, table } from '../ui.ts';

export const SYNC_USAGE = `Usage: minimalgallery sync [--prune] [--force] [--no-upload] [--yes]

Processes every photo in photos/ that is new or changed. In bucket mode it
then uploads the new resized photos to the bucket.
  --prune      remove the derivatives and manifests of photos deleted on
               this computer (never those of photos whose originals were
               never here); in bucket mode, also delete the bucket files
               no photo uses (after the site is rebuilt, since the live
               site may still show them until then)
  --force      encode every photo again
  --no-upload  in bucket mode, keep new files staged; publish uploads them
  --yes        do not ask before deleting files from the bucket`;

export async function syncCommand(args: string[], dir?: string) {
  const { values } = parse(
    args,
    {
      prune: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-upload': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
    },
    SYNC_USAGE
  );
  const root = await requireGalleryRoot(dir);
  const config = await loadConfig(root);
  const summary = await runPipeline(root, {
    config,
    prune: values.prune,
    force: values.force,
  });
  const rows = pipelineRows(summary);
  let code = summary.errors.length ? 1 : 0;

  if (config.storage.mode === 's3') {
    if (values['no-upload']) {
      const pending = await pendingUploads(root, { config });
      rows.push(['waiting for upload', pending.files]);
    } else {
      const upload = await uploadStaged(root, config);
      rows.push(['uploaded', upload.summary?.uploaded.length ?? 0]);
      if (upload.missingCredentials) {
        rows.push(['waiting for upload', upload.pending]);
        code = 1;
      }
    }
  }
  note(table(rows), 'Synced');

  if (summary.orphans.length && !values.prune)
    console.log(
      `${summary.orphans.length} deleted photo(s) still have derivatives. Run minimalgallery sync --prune to remove them.`
    );

  if (values.prune && config.storage.mode === 's3') {
    const found = await pruneBucketFiles(root, config, false);
    if (!found.removed.length) {
      log.info('The bucket holds no unused files.');
      return code;
    }
    const what = `${found.removed.length} file(s), ${formatBytes(found.bytes)}, in the bucket are not used by any photo.`;
    if (!values.yes) {
      if (!process.stdin.isTTY)
        throw new CliError(
          `${what} Not deleting them without asking; pass --yes to delete them.`
        );
      log.info(
        `${what}\nThe live site may still show some of them until its next build.`
      );
      const ok = await confirm({ message: 'Delete them from the bucket?' });
      if (isCancel(ok) || !ok) {
        cancel('Nothing was deleted from the bucket.');
        return code;
      }
    }
    const pruned = await pruneBucketFiles(root, config, true);
    log.success(
      `Deleted ${pruned.removed.length} file(s), ${formatBytes(pruned.bytes)}, from the bucket.`
    );
  }
  return code;
}
