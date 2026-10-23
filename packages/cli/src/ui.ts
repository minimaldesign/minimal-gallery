import type { ProcessSummary } from '@minimalgallery/pipeline';
import { formatBytes } from '@minimalgallery/pipeline/doctor';

/** A two-column table with the first column padded. */
export function table(rows: Array<[string, string | number]>): string {
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join('\n');
}

export function pipelineRows(
  s: ProcessSummary
): Array<[string, string | number]> {
  const rows: Array<[string, string | number]> = [
    ['albums', s.albums],
    ['photos', s.photos],
    ['encoded', s.encoded],
    ['metadata only', s.metadataOnly],
    ['unchanged', s.skipped],
    ['failed', s.errors.length],
    ['bytes written', formatBytes(s.bytesWritten)],
    ['time', `${s.wallSeconds.toFixed(1)} s`],
  ];
  if (s.pruned.ids.length) rows.splice(6, 0, ['pruned', s.pruned.ids.length]);
  return rows;
}

/** One line for `watch`: what the last run did. */
export function pipelineLine(s: ProcessSummary): string {
  const parts = [
    `${s.photos} photos`,
    `${s.encoded} encoded`,
    `${s.metadataOnly} metadata only`,
    `${s.skipped} unchanged`,
  ];
  if (s.pruned.ids.length) parts.push(`${s.pruned.ids.length} pruned`);
  if (s.errors.length) parts.push(`${s.errors.length} failed`);
  return `${parts.join(', ')} (${s.wallSeconds.toFixed(1)} s)`;
}
