import { chmod, cp, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  astroConfig,
  dotEnv,
  envExample,
  galleryConfig,
  githubPagesWorkflow,
  headers,
  launcher,
  netlifyToml,
  packageJson,
  projectName,
  wranglerJsonc,
  type Answers,
} from './templates.ts';

export const TEMPLATE_DIR = fileURLToPath(
  new URL('../template', import.meta.url)
);
export const LAUNCHER_NAME = 'Open minimalgallery.command';

export interface ScaffoldOptions {
  /** Version range base for the minimalgallery packages. */
  version: string;
  /** Writes the double-click launcher on `darwin`. Default: this machine. */
  platform?: NodeJS.Platform;
  /** For wrangler.jsonc. Default: today. */
  date?: string;
  /** package.json’s `packageManager`, `pnpm@10.20.0`; none when unknown. */
  packageManager?: string;
}

/** True when `dir` does not exist or holds nothing but `.DS_Store` or `.git`. */
export async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).every((f) => f === '.DS_Store' || f === '.git');
  } catch {
    return true;
  }
}

/**
 * Write a new gallery into `dir`. Returns the paths written, relative to
 * `dir`. Installs nothing.
 */
export async function scaffold(
  dir: string,
  answers: Answers,
  options: ScaffoldOptions
): Promise<string[]> {
  const written: string[] = [];
  const write = async (path: string, content: string, mode?: number) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content, { mode });
    written.push(path);
  };

  await mkdir(dir, { recursive: true });
  await cp(TEMPLATE_DIR, dir, { recursive: true });
  // npm drops .gitignore from published packages, so the template carries it as _gitignore.
  await rename(join(dir, '_gitignore'), join(dir, '.gitignore'));
  for (const entry of await readdir(TEMPLATE_DIR, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile()) {
      const path = relative(TEMPLATE_DIR, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/');
      written.push(path === '_gitignore' ? '.gitignore' : path);
    }

  const project = projectName(basename(dir));
  const pm = answers.packageManager;
  await write(
    'package.json',
    packageJson(answers, project, options.version, options.packageManager)
  );
  await write('astro.config.mjs', astroConfig(answers));
  await write('minimalgallery.config.ts', galleryConfig(answers));
  await write('.env.example', envExample(answers));
  // The bucket token, when given: only here, never in the config. Git ignores .env.
  if (answers.storage === 'bucket' && answers.bucket && answers.token)
    await write('.env', dotEnv(answers.bucket.name, answers.token), 0o600);

  if (answers.host === 'cloudflare') {
    const date = options.date ?? new Date().toISOString().slice(0, 10);
    await write('wrangler.jsonc', wranglerJsonc(answers, project, date));
    await write('public/_headers', headers(answers.storage));
  } else if (answers.host === 'github') {
    await write('.github/workflows/deploy.yml', githubPagesWorkflow(pm));
  } else if (answers.host === 'netlify') {
    await write('netlify.toml', netlifyToml(pm));
  }

  if ((options.platform ?? process.platform) === 'darwin') {
    await write(LAUNCHER_NAME, launcher(pm));
    await chmod(join(dir, LAUNCHER_NAME), 0o755);
  }
  return written.sort();
}
