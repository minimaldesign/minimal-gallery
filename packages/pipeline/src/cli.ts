#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { doctor, formatBytes, formatDoctorReport } from './doctor.ts';
import { processGallery } from './process.ts';

const USAGE = `Usage:
  mg-pipeline <galleryDir> [--prune] [--force] [--concurrency N] [--threads N] [--quiet] [--json summary.json]
  mg-pipeline doctor <galleryDir> [--json report.json]

Processing reads minimalgallery.config.ts in <galleryDir> when present.
  --prune         remove manifests, derivatives and empty folders of deleted photos
  --force         re-encode every photo
  --concurrency   encoding workers (default: min(CPUs, photos to encode))
  --threads       libvips threads per worker (default: max(1, CPUs / workers))
  --quiet         print only the summary
  --json          also write the summary or report as JSON`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prune: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    concurrency: { type: 'string' },
    threads: { type: 'string' },
    quiet: { type: 'boolean', short: 'q', default: false },
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const isDoctor = positionals[0] === 'doctor';
const args = isDoctor ? positionals.slice(1) : positionals;
if (values.help || args.length !== 1) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

const positiveInt = (name: string, v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`error: --${name} must be a whole number of 1 or more`);
    process.exit(1);
  }
  return n;
};
const fmtS = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(3)} s`);
const dir = resolve(args[0]);

try {
  if (isDoctor) {
    const report = await doctor(dir);
    console.log(formatDoctorReport(report));
    if (values.json)
      await writeFile(values.json, JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const s = await processGallery(dir, {
    prune: values.prune,
    force: values.force,
    concurrency: positiveInt('concurrency', values.concurrency),
    threadsPerWorker: positiveInt('threads', values.threads),
    log: values.quiet ? undefined : (m) => console.log(m),
  });
  for (const w of s.warnings) console.warn(`warning: ${w}`);
  const rows: Array<[string, string]> = [
    ['albums', String(s.albums)],
    ['photos', String(s.photos)],
    ['  encoded', String(s.encoded)],
    ['  metadata only', String(s.metadataOnly)],
    ['  skipped', String(s.skipped)],
    ['  failed', String(s.errors.length)],
    ...(s.absent.length
      ? [['  original not here', String(s.absent.length)] as [string, string]]
      : []),
    ['workers', `${s.workers} × ${s.threadsPerWorker} thread(s)`],
    ['manifests written', String(s.manifestsWritten)],
    ['files written', String(s.filesWritten)],
    ['bytes written', formatBytes(s.bytesWritten)],
    [
      'derivatives (all)',
      `${s.derivativeFiles} files, ${formatBytes(s.derivativeBytes)}`,
    ],
    ['encode s/photo, mean', fmtS(s.meanEncodeSeconds)],
    ['encode s/photo, p95', fmtS(s.p95EncodeSeconds)],
    ['throughput s/photo', s.encoded ? fmtS(s.wallSeconds / s.encoded) : 'n/a'],
    ['wall time', fmtS(s.wallSeconds)],
  ];
  if (values.prune)
    rows.push([
      'pruned',
      `${s.pruned.ids.length} photo(s): ${s.pruned.manifests} manifests, ${s.pruned.files} files; ${s.pruned.swept.length} leftover(s) swept`,
    ]);
  const w = Math.max(...rows.map(([k]) => k.length));
  console.log('');
  for (const [k, v] of rows) console.log(`${k.padEnd(w)}  ${v}`);
  if (values.prune && !values.quiet)
    for (const p of s.pruned.swept) console.log(`swept    ${p}`);
  for (const e of s.errors)
    console.error(`error: ${e.path}: ${e.message.replace(`${e.path}: `, '')}`);
  if (values.json) await writeFile(values.json, JSON.stringify(s, null, 2));
  process.exit(s.errors.length ? 1 : 0);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
