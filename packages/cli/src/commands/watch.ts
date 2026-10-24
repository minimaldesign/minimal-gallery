import { log } from '@clack/prompts';
import { watch } from 'chokidar';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pendingUploads } from '@minimalgallery/pipeline';
import { loadConfig } from '@minimalgallery/pipeline/config';
import { parse } from '../args.ts';
import { CliError } from '../errors.ts';
import { runPipeline } from '../pipeline.ts';
import { requireGalleryRoot } from '../root.ts';
import { pipelineLine } from '../ui.ts';

export const WATCH_USAGE = `Usage: minimalgallery watch [--delay <ms>]

Processes photos as they are added, changed or removed in photos/.
Runs once at start, then after each batch of changes. In bucket mode the
new files stay staged; minimalgallery sync or publish uploads them. The
admin (minimalgallery admin) does the same while it runs.
  --delay   wait this long after the last change before processing (default 1500)`;

const timeNow = () => new Date().toTimeString().slice(0, 8);

/**
 * Watch `photos/` and run the pipeline after each batch of changes. A run
 * that removes photos also prunes their derivatives. Changes that arrive
 * during a run start another run when it finishes. Returns a function that
 * stops watching.
 */
export async function watchGallery(
  root: string,
  delay = 1500
): Promise<() => Promise<void>> {
  const photosDir = join(root, 'photos');
  if (!existsSync(photosDir))
    throw new CliError(`There is no photos/ folder in ${root}.`);

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let prune = true;
  let changes = 0;

  const process_ = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    const count = changes;
    const withPrune = prune;
    changes = 0;
    prune = false;
    try {
      if (count) console.log(`${timeNow()}  ${count} change(s), processing`);
      const config = await loadConfig(root);
      const summary = await runPipeline(root, {
        config,
        prune: withPrune,
        output: 'silent',
      });
      let line = pipelineLine(summary);
      if (config.storage.mode === 's3') {
        const pending = await pendingUploads(root, { config });
        if (pending.files) line += `; ${pending.files} file(s) wait for upload`;
      }
      console.log(`${timeNow()}  ${line}`);
    } catch (e) {
      log.error((e as Error).message);
    } finally {
      running = false;
      if (again) {
        again = false;
        void process_();
      }
    }
  };

  const watcher = watch(photosDir, {
    ignoreInitial: true,
    ignored: /(^|[\\/])\../,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 100 },
  });
  watcher.on('all', (event) => {
    changes++;
    if (event === 'unlink' || event === 'unlinkDir') prune = true;
    clearTimeout(timer);
    timer = setTimeout(() => void process_(), delay);
  });
  watcher.on('error', (e) => log.error(`watch: ${(e as Error).message}`));

  await process_();
  return async () => {
    clearTimeout(timer);
    await watcher.close();
  };
}

export async function watchCommand(args: string[], dir?: string) {
  const { values } = parse(args, { delay: { type: 'string' } }, WATCH_USAGE);
  const delay = values.delay === undefined ? 1500 : Number(values.delay);
  if (!Number.isFinite(delay) || delay < 0)
    throw new CliError('--delay must be a number of milliseconds.');
  const root = await requireGalleryRoot(dir);
  console.log(`Watching ${join(root, 'photos')}. Press Ctrl+C to stop.`);
  const stop = await watchGallery(root, delay);
  await new Promise<void>((done) => {
    process.once('SIGINT', () => void stop().then(done));
    process.once('SIGTERM', () => void stop().then(done));
  });
  return 0;
}
