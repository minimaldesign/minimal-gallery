import { checkBucket, formatBucketCheck } from '@minimalgallery/pipeline';
import { doctor, formatDoctorReport } from '@minimalgallery/pipeline/doctor';
import { loadConfig } from '@minimalgallery/pipeline/config';
import { parse } from '../args.ts';
import { stopOnPlaceholders } from '../bucket.ts';
import { CliError } from '../errors.ts';
import { requireGalleryRoot } from '../root.ts';

export const DOCTOR_USAGE = `Usage: minimalgallery doctor [--bucket]

Reports photo and file counts, the projected deploy size against the
hosting limits, and anything that needs attention. Changes nothing.
  --bucket   in bucket mode, also check the bucket end to end: upload a
             small test file, list it, read it back through the public
             address (with its cache header), then delete it`;

export async function doctorCommand(args: string[], dir?: string) {
  const { values } = parse(
    args,
    { bucket: { type: 'boolean', default: false } },
    DOCTOR_USAGE
  );
  const root = await requireGalleryRoot(dir);
  console.log(formatDoctorReport(await doctor(root)));
  if (!values.bucket) return 0;
  const config = await loadConfig(root);
  if (config.storage.mode !== 's3')
    throw new CliError(
      'The gallery is in site mode, so there is no bucket to check.'
    );
  stopOnPlaceholders(config, 'The bucket was not checked.');
  let check;
  try {
    check = await checkBucket(root, { config });
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  console.log(`\n${formatBucketCheck(check)}`);
  return check.ok ? 0 : 1;
}
