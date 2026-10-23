import { log, spinner } from '@clack/prompts';
import {
  bucketCredentials,
  MISSING_CREDENTIALS,
  pendingUploads,
  pruneBucket,
  uploadToBucket,
  type GalleryConfig,
  type PruneSummary,
  type UploadSummary,
} from '@minimalgallery/pipeline';
import { formatBytes } from '@minimalgallery/pipeline/doctor';
import { CliError } from './errors.ts';
import type { RunOptions } from './pipeline.ts';

type Output = NonNullable<RunOptions['output']>;

/** The message of an error and of its cause, for errors the bucket functions throw. */
function reason(e: unknown): string {
  const err = e as Error;
  const cause = (err.cause as Error | undefined)?.message;
  return cause && !err.message.includes(cause)
    ? `${err.message}\n${cause}`
    : err.message;
}

export interface UploadResult {
  /** Files that were waiting for upload before this call. */
  pending: number;
  /** Null when nothing was waiting, or when credentials are missing and the upload was optional. */
  summary: UploadSummary | null;
  /** True when files wait for upload and there are no credentials. */
  missingCredentials: boolean;
}

/**
 * Upload the files bucket mode has staged. Does nothing in repo mode or when
 * nothing is waiting. Without credentials it warns, or, when `required`
 * (publishing), stops with a `CliError` so the site is never published
 * pointing at files that are not in the bucket. A failed upload always stops.
 */
export async function uploadStaged(
  root: string,
  config: GalleryConfig,
  options: { required?: boolean; output?: Output } = {}
): Promise<UploadResult> {
  if (config.storage.mode !== 's3')
    return { pending: 0, summary: null, missingCredentials: false };
  const pending = await pendingUploads(root, { config });
  if (!pending.files)
    return { pending: 0, summary: null, missingCredentials: false };
  if (!bucketCredentials(root)) {
    if (options.required)
      throw new CliError(
        `${pending.files} file(s) wait for upload to the bucket, so nothing was published.\n${MISSING_CREDENTIALS}`
      );
    log.warn(
      `${pending.files} file(s) (${formatBytes(pending.bytes)}) wait for upload.\n${MISSING_CREDENTIALS}`
    );
    return { pending: pending.files, summary: null, missingCredentials: true };
  }

  const output = options.output ?? (process.stdout.isTTY ? 'spinner' : 'lines');
  const spin = output === 'spinner' ? spinner() : null;
  const title = `Uploading ${pending.files} file(s), ${formatBytes(pending.bytes)}, to ${config.storage.bucket}`;
  if (spin) spin.start(title);
  else if (output === 'lines') console.log(title);
  // In plain output, a line every 5% is enough for a log.
  const every = Math.max(1, Math.round(pending.files / 20));
  let summary: UploadSummary;
  try {
    summary = await uploadToBucket(root, {
      config,
      onProgress: (p) => {
        const line = `uploaded ${p.done}/${p.total}, ${formatBytes(p.doneBytes)} of ${formatBytes(p.totalBytes)}`;
        if (spin) spin.message(line);
        else if (
          output === 'lines' &&
          (p.done % every === 0 || p.done === p.total)
        )
          console.log(line);
      },
    });
  } catch (e) {
    spin?.error('Upload stopped');
    throw new CliError(
      `The upload to the bucket stopped: ${reason(e)}\nRun the same command again to continue; files already uploaded are kept.`
    );
  }
  const done = `Uploaded ${summary.uploaded.length} file(s), ${formatBytes(summary.bytes)}, in ${summary.seconds.toFixed(1)} s`;
  if (spin) spin.stop(done);
  else if (output === 'lines') console.log(done);
  if (summary.missing.length)
    log.warn(
      `${summary.missing.length} file(s) the manifests name are neither staged nor in the bucket. Run minimalgallery sync --force to encode them again.`
    );
  return { pending: pending.files, summary, missingCredentials: false };
}

/**
 * Find, and with `apply` delete, the bucket files no manifest references.
 * Needs credentials.
 */
export async function pruneBucketFiles(
  root: string,
  config: GalleryConfig,
  apply: boolean
): Promise<PruneSummary> {
  if (!bucketCredentials(root)) throw new CliError(MISSING_CREDENTIALS);
  try {
    return await pruneBucket(root, { config, dryRun: !apply });
  } catch (e) {
    throw new CliError(`Cannot prune the bucket: ${reason(e)}`);
  }
}
