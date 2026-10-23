#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { CliError } from './errors.ts';
import { ADD_USAGE, addCommand } from './commands/add.ts';
import { ADMIN_USAGE, adminCommand } from './commands/admin.ts';
import { DOCTOR_USAGE, doctorCommand } from './commands/doctor.ts';
import { PUBLISH_USAGE, publishCommand } from './commands/publish.ts';
import { SYNC_USAGE, syncCommand } from './commands/sync.ts';
import { UPGRADE_USAGE, upgradeCommand } from './commands/upgrade.ts';
import { WATCH_USAGE, watchCommand } from './commands/watch.ts';

type Command = (args: string[], dir?: string) => Promise<number>;

const COMMANDS: Record<string, [Command, string, string]> = {
  add: [addCommand, ADD_USAGE, 'copy photos into an album and process them'],
  sync: [syncCommand, SYNC_USAGE, 'process new and changed photos'],
  doctor: [
    doctorCommand,
    DOCTOR_USAGE,
    'check the gallery against the hosting limits',
  ],
  publish: [publishCommand, PUBLISH_USAGE, 'push or deploy the gallery'],
  watch: [watchCommand, WATCH_USAGE, 'process photos as they land in photos/'],
  admin: [
    adminCommand,
    ADMIN_USAGE,
    'start the local preview (the admin comes later)',
  ],
  upgrade: [
    upgradeCommand,
    UPGRADE_USAGE,
    'update the minimalgallery packages, then run doctor',
  ],
};

const version = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  ) as { version: string }
).version;

const USAGE = `minimalgallery ${version}

Usage: minimalgallery <command> [options] [--dir <gallery folder>]

Commands:
${Object.entries(COMMANDS)
  .map(([name, [, , summary]]) => `  ${name.padEnd(8)}  ${summary}`)
  .join('\n')}

Run minimalgallery <command> --help for its options. The gallery is the
nearest folder, from here upward, with a minimalgallery.config.ts file or a
photos/ folder.`;

async function main(argv: string[]): Promise<number> {
  // --dir applies to every command; take it out before the command parses.
  let dir: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') {
      dir = argv[++i];
      if (!dir) throw new CliError('--dir needs a folder.');
    } else if (a.startsWith('--dir=')) dir = a.slice(6);
    else args.push(a);
  }
  const [name, ...rest] = args;
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    console.log(USAGE);
    return name ? 0 : 1;
  }
  if (name === '--version' || name === '-v') {
    console.log(version);
    return 0;
  }
  const entry = COMMANDS[name];
  if (!entry) throw new CliError(`Unknown command: ${name}\n\n${USAGE}`);
  const [command, usage] = entry;
  if (rest.includes('--help') || rest.includes('-h')) {
    console.log(usage);
    return 0;
  }
  return command(rest, dir);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof CliError) {
    console.error(e.message);
    process.exitCode = e.exitCode;
  } else {
    const err = e as Error;
    console.error(`Error: ${err.message}`);
    if (process.env.MG_DEBUG) console.error(err.stack);
    process.exitCode = 1;
  }
}
