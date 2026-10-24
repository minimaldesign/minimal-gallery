import { log, spinner } from '@clack/prompts';
import {
  processGallery,
  type GalleryConfig,
  type ProcessSummary,
} from '@minimalgallery/pipeline';
import { loadConfig } from '@minimalgallery/pipeline/config';

export interface RunOptions {
  prune?: boolean;
  force?: boolean;
  /** `spinner` for one-off commands, `lines` for long-running ones, `silent` for none. */
  output?: 'spinner' | 'lines' | 'silent';
  /** Default: `loadConfig(root)`. */
  config?: GalleryConfig;
}

/**
 * Run the pipeline over the gallery. In bucket mode the derivatives are
 * staged locally; uploading them is a separate step (`uploadStaged`).
 * Warnings and failed photos are printed; the caller decides the exit code.
 */
export async function runPipeline(
  root: string,
  options: RunOptions = {}
): Promise<ProcessSummary> {
  const config = options.config ?? (await loadConfig(root));
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
