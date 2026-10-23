import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CliError } from './errors.ts';

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command with the terminal attached. Resolves with its exit code. */
export function run(
  command: string,
  args: string[],
  cwd: string
): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', (e) =>
      fail(
        (e as NodeJS.ErrnoException).code === 'ENOENT'
          ? new CliError(`${command} is not installed or not on the PATH.`)
          : e
      )
    );
    child.on('close', (code) => done(code ?? 1));
  });
}

/** Run a command and collect its output. A missing command gives code 127. */
export function capture(
  command: string,
  args: string[],
  cwd: string
): Promise<Captured> {
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', () => done({ code: 127, stdout, stderr }));
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

/** Run a command and stop with an error when it fails. */
export async function runOrFail(
  command: string,
  args: string[],
  cwd: string
): Promise<void> {
  const code = await run(command, args, cwd);
  if (code !== 0)
    throw new CliError(
      `${[command, ...args].join(' ')} failed with exit code ${code}.`,
      code
    );
}

/** A binary from the gallery’s `node_modules/.bin`, looking up the tree. Null when absent. */
export function localBin(root: string, name: string): string | null {
  let dir = resolve(root);
  for (;;) {
    const bin = join(dir, 'node_modules', '.bin', name);
    if (existsSync(bin)) return bin;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCKFILES: Array<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/**
 * The package manager of a project: from its lockfile (looking up the tree),
 * else from the one running this command, else npm.
 */
export function detectPackageManager(
  root: string,
  userAgent = process.env.npm_config_user_agent
): PackageManager {
  let dir = resolve(root);
  for (;;) {
    for (const [file, pm] of LOCKFILES)
      if (existsSync(join(dir, file))) return pm;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const name = userAgent?.split('/')[0];
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm';
}
