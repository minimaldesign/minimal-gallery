import { log, note } from '@clack/prompts';
import { relative } from 'node:path';
import { addPhotos } from '../add.ts';
import { parse } from '../args.ts';
import { runPipeline } from '../pipeline.ts';
import { requireGalleryRoot } from '../root.ts';
import { pipelineRows, table } from '../ui.ts';

export const ADD_USAGE = `Usage: minimalgallery add <folder | files...> [--album <name>]

Copies photos into photos/<album>/ and processes them. The album name
defaults to the folder name. Photos already in the gallery are skipped.`;

const MAX_LISTED = 10;

export async function addCommand(args: string[], dir?: string) {
  const { values, positionals } = parse(
    args,
    { album: { type: 'string', short: 'a' } },
    ADD_USAGE
  );
  if (!positionals.length) {
    console.log(ADD_USAGE);
    return 1;
  }
  const root = await requireGalleryRoot(dir);
  const result = await addPhotos(root, positionals, { album: values.album });

  const show = (lines: string[]) =>
    lines.slice(0, MAX_LISTED).join('\n') +
    (lines.length > MAX_LISTED
      ? `\n…and ${lines.length - MAX_LISTED} more`
      : '');
  if (result.duplicates.length)
    log.info(
      `Already in the gallery:\n${show(result.duplicates.map((d) => `${relative(process.cwd(), d.from)} (same as ${d.sameAs})`))}`
    );
  if (result.skipped.length)
    log.warn(
      `Skipped:\n${show(result.skipped.map((s) => `${relative(process.cwd(), s.from)}: ${s.reason}`))}`
    );
  const renamed = result.added.filter((a) => a.renamed);
  if (renamed.length)
    log.info(
      `Renamed to avoid a clash:\n${show(renamed.map((a) => `${relative(process.cwd(), a.from)} -> ${a.to}`))}`
    );

  const rows: Array<[string, string | number]> = [
    ['album', result.album],
    ['folder', result.albumDir],
    ['added', result.added.length],
    ['already there', result.duplicates.length],
    ['skipped', result.skipped.length],
  ];
  if (!result.added.length) {
    note(table(rows), 'Nothing new to add');
    return 0;
  }

  const summary = await runPipeline(root);
  note(table([...rows, ...pipelineRows(summary)]), 'Added');
  return summary.errors.length ? 1 : 0;
}
