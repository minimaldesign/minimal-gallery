import { log } from '@clack/prompts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from '../args.ts';
import { CliError } from '../errors.ts';
import {
  detectPackageManager,
  localBin,
  run,
  runOrFail,
  type PackageManager,
} from '../exec.ts';
import { requireGalleryRoot } from '../root.ts';
import { doctorCommand } from './doctor.ts';

export const UPGRADE_USAGE = `Usage: minimalgallery upgrade

Updates the minimalgallery packages of this gallery to their latest
versions with its package manager, then runs doctor.`;

const OURS = (name: string) =>
  name === 'minimalgallery' || name.startsWith('@minimalgallery/');

/** The install commands that move `prod` and `dev` packages to latest. */
export function upgradeCommands(
  pm: PackageManager,
  prod: string[],
  dev: string[]
): string[][] {
  const latest = (names: string[]) => names.map((n) => `${n}@latest`);
  if (pm === 'npm')
    return prod.length || dev.length
      ? [['npm', 'install', ...latest([...prod, ...dev])]]
      : [];
  const devFlag = pm === 'yarn' ? '--dev' : '-D';
  const out: string[][] = [];
  if (prod.length) out.push([pm, 'add', ...latest(prod)]);
  if (dev.length) out.push([pm, 'add', devFlag, ...latest(dev)]);
  return out;
}

export async function upgradeCommand(args: string[], dir?: string) {
  parse(args, {}, UPGRADE_USAGE);
  const root = await requireGalleryRoot(dir);
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  } catch {
    throw new CliError(`There is no readable package.json in ${root}.`);
  }
  const pick = (deps: Record<string, string> = {}) =>
    Object.entries(deps)
      .filter(([name, spec]) => OURS(name) && !spec.startsWith('workspace:'))
      .map(([name]) => name);
  const prod = pick(pkg.dependencies);
  const dev = pick(pkg.devDependencies);
  if (!prod.length && !dev.length) {
    log.info(
      'No minimalgallery packages to upgrade here (workspace links are skipped).'
    );
    return 0;
  }

  const pm = detectPackageManager(root);
  for (const [cmd, ...rest] of upgradeCommands(pm, prod, dev)) {
    log.step(`${cmd} ${rest.join(' ')}`);
    await runOrFail(cmd, rest, root);
  }

  // Run the doctor of the version just installed, when there is one.
  const bin = localBin(root, 'minimalgallery');
  if (bin) return run(bin, ['doctor'], root);
  return doctorCommand([], root);
}
