import { realpath } from 'node:fs/promises';
import type { Captured, Runner } from './run.ts';

export const FIRST_COMMIT = 'Create the gallery';

export type GitSetup =
  | { status: 'committed' }
  | { status: 'unavailable' }
  /** The folder is inside another repository, which is left alone. */
  | { status: 'inside'; root: string }
  | { status: 'failed'; message: string };

const real = (path: string) => realpath(path).catch(() => path);

function failure(out: Captured): GitSetup {
  const lines = `${out.stderr}\n${out.stdout}`
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    status: 'failed',
    message:
      lines.find((l) => /^(fatal|error):/.test(l)) ??
      lines[0] ??
      `exit code ${out.code}`,
  };
}

/**
 * Makes the folder a git repository on `main` with a first commit. A folder
 * that is already the root of a repository (an empty clone) gets the commit;
 * one inside another repository is left alone.
 */
export async function setUpGit(run: Runner, dir: string): Promise<GitSetup> {
  const git = (args: string[]) => run('git', args, { cwd: dir });
  const top = await git(['rev-parse', '--show-toplevel']);
  if (top.code === 127) return { status: 'unavailable' };
  if (top.code === 0) {
    const root = top.stdout.trim();
    if ((await real(root)) !== (await real(dir)))
      return { status: 'inside', root };
  } else {
    const init = await git(['init', '-b', 'main']);
    if (init.code !== 0) return failure(init);
  }
  const add = await git(['add', '-A']);
  if (add.code !== 0) return failure(add);
  const commit = await git(['commit', '-m', FIRST_COMMIT]);
  if (commit.code !== 0) return failure(commit);
  return { status: 'committed' };
}
