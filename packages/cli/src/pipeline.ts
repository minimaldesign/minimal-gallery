import { log, spinner } from '@clack/prompts';
import { processGallery, type ProcessSummary } from '@minimalgallery/pipeline';
import { loadConfig } from '@minimalgallery/pipeline/config';
import { CliError } from './errors.ts';

export const BUCKET_MODE_MESSAGE =
  "Bucket mode (storage: { mode: 's3' }) is not available yet: this version cannot upload to a bucket.\n" +
  "Set storage: { mode: 'repo' } in minimalgallery.config.ts to process this gallery now. Repo mode is fine up to about 500 photos.";

export interface RunOptions {
  prune?: boolean;
  force?: boolean;
  /** `spinner` for one-off commands, `lines` for long-running ones, `silent` for none. */
  output?: 'spinner' | 'lines' | 'silent';
}

/**
 * Run the pipeline over the gallery. Stops before encoding anything when the
 * gallery is in bucket mode, which this version cannot upload to. Warnings and
 * failed photos are printed; the caller decides the exit code.
 */
export async function runPipeline(
  root: string,
  options: RunOptions = {}
): Promise<ProcessSummary> {
  const config = await loadConfig(root);
  if (config.storage.mode === 's3') throw new CliError(BUCKET_MODE_MESSAGE);

  const output = options.output ?? (process.stdout.isTTY ? 'spinner' : 'lines');
  const spin = output === 'spinner' ? spinner() : null;
  spin?.start('Processing photos');
  let summary: ProcessSummary;
  try {
    summary = await processGallery(root, {
      config,
      prune: options.prune,
      force: options.force,
      log:
        output === 'silent'
          ? undefined
          : (message) =>
              spin ? spin.message(message.slice(0, 70)) : console.log(message),
    });
  } catch (e) {
    spin?.error('Processing stopped');
    throw e;
  }
  spin?.stop(`Processed ${summary.photos} photos`);

  for (const w of summary.warnings) log.warn(w);
  for (const e of summary.errors) log.error(`${e.path}: ${e.message}`);
  return summary;
}
