import { parseArgs, type ParseArgsConfig } from 'node:util';
import { CliError } from './errors.ts';

/** `parseArgs` with readable errors. */
export function parse<O extends NonNullable<ParseArgsConfig['options']>>(
  args: string[],
  options: O,
  usage: string
) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (e) {
    throw new CliError(`${(e as Error).message}\n\n${usage}`);
  }
}
