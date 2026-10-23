import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { findConfigFile } from '@minimalgallery/pipeline/config';
import { CliError } from './errors.ts';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The gallery root: the nearest directory, from `start` upward, that holds a
 * `minimalgallery.config.*` file or a `photos/` folder. Null when there is none.
 * `stopAt` is the last directory checked.
 */
export async function findGalleryRoot(
  start: string = process.cwd(),
  options: { stopAt?: string } = {}
): Promise<string | null> {
  let dir = resolve(start);
  const stopAt = options.stopAt && resolve(options.stopAt);
  for (;;) {
    if (await findConfigFile(dir)) return dir;
    if (await isDirectory(join(dir, 'photos'))) return dir;
    const parent = dirname(dir);
    if (parent === dir || dir === stopAt) return null;
    dir = parent;
  }
}

/** Like `findGalleryRoot`, but stops with a readable error when there is no gallery. */
export async function requireGalleryRoot(start?: string): Promise<string> {
  const root = await findGalleryRoot(start);
  if (root) return root;
  throw new CliError(
    `No gallery found in ${resolve(start ?? process.cwd())} or any folder above it.\n` +
      'A gallery folder has a minimalgallery.config.ts file or a photos/ folder.\n' +
      'Run this inside one, pass --dir <folder>, or create one with: npm create minimalgallery@latest'
  );
}
