import { cancel, confirm, isCancel, log, note } from '@clack/prompts';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CONFIG_FILES,
  loadConfig,
  type GalleryConfig,
} from '@minimalgallery/pipeline/config';
import { formatBytes } from '@minimalgallery/pipeline/doctor';
import { pendingUploads } from '@minimalgallery/pipeline';
import { parse } from '../args.ts';
import { uploadStaged } from '../bucket.ts';
import { CliError } from '../errors.ts';
import { capture, localBin, runOrFail, runTee } from '../exec.ts';
import { runPipeline } from '../pipeline.ts';
import { requireGalleryRoot } from '../root.ts';

export const PUBLISH_USAGE = `Usage: minimalgallery publish [--git | --deploy | --build] [--yes]

Processes new photos, uploads them to the bucket in bucket mode, then
publishes the gallery one of three ways:
  --git      commit the gallery changes and push; your host builds the site
  --deploy   build the site and upload it to Cloudflare Workers (static
             assets) with wrangler deploy, as set in wrangler.jsonc
  --build    build the site into dist/ and stop
Without a flag, the "minimalgallery.publish" field of package.json decides
("git", "deploy" or "build"), else --deploy when wrangler.jsonc exists.
  --yes            do not ask before pushing or deploying
The last line gives the site’s address when it is known.`;

export type PublishMethod = 'git' | 'deploy' | 'build';

/** The paths a gallery commit includes, when they exist. */
const GALLERY_PATHS = [
  'photos',
  '.minimalgallery',
  'public',
  'custom.css',
  'about.md',
  ...CONFIG_FILES,
];

const ASTRO_CONFIGS = [
  'astro.config.mjs',
  'astro.config.ts',
  'astro.config.mts',
  'astro.config.js',
];

/**
 * The site’s public address: `site` in minimalgallery.config.ts, else an
 * uncommented `site: '…'` line in the Astro config. Null when neither says.
 */
export async function siteUrl(
  root: string,
  config: Pick<GalleryConfig, 'site'>
): Promise<string | null> {
  if (config.site) return config.site;
  for (const file of ASTRO_CONFIGS) {
    let text: string;
    try {
      text = await readFile(join(root, file), 'utf8');
    } catch {
      continue;
    }
    const match = /^\s*site\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/m.exec(text);
    if (match) return match[1];
  }
  return null;
}

/** The last `https://` address in some output (wrangler prints the deployed URLs last). */
export function lastUrl(output: string): string | null {
  const urls = output.match(/https:\/\/[^\s"'<>()]+/g);
  return urls ? urls[urls.length - 1].replace(/[.,;:]+$/, '') : null;
}

/** The plan line for the bucket upload, or null when nothing waits. */
async function uploadStep(
  root: string,
  config: GalleryConfig
): Promise<string | null> {
  if (config.storage.mode !== 's3') return null;
  const pending = await pendingUploads(root, { config });
  return pending.files
    ? `upload ${pending.files} new file(s), ${formatBytes(pending.bytes)}, to the ${config.storage.bucket} bucket`
    : null;
}

async function readPackageJson(
  root: string
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** The publish method: flags first, then package.json, then the files present. */
export async function choosePublishMethod(
  root: string,
  flags: { git?: boolean; deploy?: boolean; build?: boolean }
): Promise<PublishMethod> {
  const chosen = (['git', 'deploy', 'build'] as const).filter((m) => flags[m]);
  if (chosen.length > 1)
    throw new CliError('Pick one of --git, --deploy and --build.');
  if (chosen.length) return chosen[0];
  const pkg = await readPackageJson(root);
  const setting = (pkg?.minimalgallery as { publish?: unknown } | undefined)
    ?.publish;
  if (setting === 'git' || setting === 'deploy' || setting === 'build')
    return setting;
  if (setting !== undefined)
    throw new CliError(
      `package.json has "minimalgallery": { "publish": ${JSON.stringify(setting)} }; use "git", "deploy" or "build".`
    );
  if (existsSync(join(root, 'wrangler.jsonc'))) return 'deploy';
  throw new CliError(
    'Say how to publish: --deploy uploads to Cloudflare Workers (static assets), --git commits and pushes, --build only builds.\n' +
      'To set it once, add "minimalgallery": { "publish": "deploy" } to package.json.'
  );
}

/** The `name` in wrangler.jsonc or wrangler.json, or null. */
export async function wranglerProjectName(
  root: string
): Promise<string | null> {
  for (const file of ['wrangler.jsonc', 'wrangler.json']) {
    try {
      const text = await readFile(join(root, file), 'utf8');
      const match = /^\s*"name"\s*:\s*"([^"]+)"/m.exec(text);
      if (match) return match[1];
    } catch {}
  }
  return null;
}

async function confirmPlan(title: string, steps: string[], yes: boolean) {
  note(steps.map((s, i) => `${i + 1}. ${s}`).join('\n'), title);
  if (yes) return;
  if (!process.stdin.isTTY)
    throw new CliError(
      'Not asking in a non-interactive shell. Pass --yes to go ahead.'
    );
  const ok = await confirm({ message: 'Go ahead?' });
  if (isCancel(ok) || !ok) {
    cancel('Nothing was published.');
    throw new CliError('Canceled.', 130);
  }
}

function astroBin(root: string): string {
  const bin = localBin(root, 'astro');
  if (!bin)
    throw new CliError(
      'Astro is not installed in this gallery. Run npm install first.'
    );
  return bin;
}

async function build(root: string) {
  await runOrFail(astroBin(root), ['build'], root);
}

export async function publishCommand(args: string[], dir?: string) {
  const { values } = parse(
    args,
    {
      git: { type: 'boolean' },
      deploy: { type: 'boolean' },
      build: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y', default: false },
    },
    PUBLISH_USAGE
  );
  const root = await requireGalleryRoot(dir);
  const method = await choosePublishMethod(root, values);
  const config = await loadConfig(root);
  if (method === 'deploy') return deploy(root, config, values.yes);
  if (method === 'git') return gitPublish(root, config, values.yes);

  astroBin(root);
  const summary = await runPipeline(root, { config });
  if (summary.errors.length) log.warn('Some photos failed and are left out.');
  // The built pages point at the bucket, so its files must be there.
  await uploadStaged(root, config, { required: true });
  await build(root);
  log.success('The site is in dist/, ready to upload to any static host.');
  return 0;
}

async function deploy(root: string, config: GalleryConfig, yes: boolean) {
  if (
    !existsSync(join(root, 'wrangler.jsonc')) &&
    !existsSync(join(root, 'wrangler.json'))
  )
    throw new CliError(
      'There is no wrangler.jsonc in this gallery. It names the Cloudflare Worker and points its assets at ./dist.'
    );
  const project = await wranglerProjectName(root);
  if (!project)
    throw new CliError(
      'Set "name" in wrangler.jsonc: it names the Cloudflare Worker.'
    );
  astroBin(root);
  const local = localBin(root, 'wrangler');
  const [wrangler, prefix] = local ? [local, []] : ['npx', ['wrangler']];

  const who = await capture(wrangler, [...prefix, 'whoami'], root);
  const output = who.stdout + who.stderr;
  if (who.code === 127)
    throw new CliError('wrangler is not available. Run npm install first.');
  if (who.code !== 0 || /not authenticated|not logged in/i.test(output)) {
    log.warn(
      'You are not logged in to Cloudflare yet. This is needed once per computer:\n\n' +
        '  npx wrangler login\n\n' +
        'It opens your browser to sign in. Then run publish again.'
    );
    return 1;
  }

  const summary = await runPipeline(root, { config });
  if (summary.errors.length)
    log.warn('Some photos failed and will be left out of the site.');
  const deployArgs = [...prefix, 'deploy'];
  const upload = await uploadStep(root, config);
  await confirmPlan(
    `Publishing to Cloudflare Workers (static assets): ${project}`,
    [
      ...(upload ? [upload] : []),
      `astro build, in ${root}`,
      `wrangler ${deployArgs.slice(prefix.length).join(' ')}`,
    ],
    yes
  );
  await uploadStaged(root, config, { required: true });
  await build(root);
  const out = await runTee(wrangler, deployArgs, root);
  if (out.code !== 0)
    throw new CliError(
      `wrangler ${deployArgs.slice(prefix.length).join(' ')} failed with exit code ${out.code}.`,
      out.code
    );
  const url = (await siteUrl(root, config)) ?? lastUrl(out.stdout + out.stderr);
  log.success(url ? `Published. Live at ${url}` : 'Published.');
  return 0;
}

/**
 * File paths from `git status --porcelain -z`, relative to the repository
 * root. A rename entry is followed by its old path, which is skipped.
 */
export function changedFiles(porcelainZ: string): string[] {
  const out: string[] = [];
  const entries = porcelainZ.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    out.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i++;
  }
  return out;
}

async function git(root: string, args: string[]) {
  return capture('git', args, root);
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function gitPublish(root: string, config: GalleryConfig, yes: boolean) {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code === 127) throw new CliError('git is not installed.');
  if (inside.code !== 0)
    throw new CliError(
      'This gallery is not a git repository. Run git init, add a remote and push once, or publish with --deploy.'
    );

  const summary = await runPipeline(root, { config });
  if (summary.errors.length)
    log.warn('Some photos failed and will be left out of the site.');
  const upload = await uploadStep(root, config);

  const paths = GALLERY_PATHS.filter((p) => existsSync(join(root, p)));
  const status = await git(root, [
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=all',
    '--',
    ...paths,
  ]);
  // Porcelain paths are relative to the repository root, not to the gallery.
  const prefix = (
    await git(root, ['rev-parse', '--show-prefix'])
  ).stdout.trim();
  const changed = changedFiles(status.stdout).map((f) =>
    f.startsWith(prefix) ? f.slice(prefix.length) : f
  );
  const changedPaths = paths.filter((p) =>
    changed.some((f) => f === p || f.startsWith(p + '/'))
  );

  const upstream = await git(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ]);
  let pushArgs: string[];
  let target: string;
  let unpushed = 0;
  if (upstream.code === 0) {
    target = upstream.stdout.trim();
    pushArgs = ['push'];
    const ahead = await git(root, ['rev-list', '--count', '@{u}..HEAD']);
    unpushed = Number(ahead.stdout.trim()) || 0;
  } else {
    const remotes = (await git(root, ['remote'])).stdout.split('\n');
    if (!remotes.includes('origin'))
      throw new CliError(
        'This repository has no remote to push to. Add one with: git remote add origin <url>'
      );
    target = 'origin (new branch)';
    pushArgs = ['push', '-u', 'origin', 'HEAD'];
    unpushed = 1;
  }

  if (!changed.length && !unpushed && !upload) {
    log.info('Nothing to publish: the gallery has no new changes.');
    return 0;
  }

  const message = `Update gallery, ${today()}`;
  const steps: string[] = upload ? [upload] : [];
  if (changed.length)
    steps.push(
      `git commit ${changed.length} changed file(s) in ${changedPaths.join(', ')}: “${message}”`
    );
  steps.push(`git ${pushArgs.join(' ')}, to ${target}`);
  await confirmPlan('Publishing with git', steps, yes);

  // Upload first: the commit names the new files, and the host builds from it.
  await uploadStaged(root, config, { required: true });
  if (!changed.length && !unpushed) {
    log.success('Uploaded. The site had no other changes to push.');
    return 0;
  }
  if (changed.length) {
    await runOrFail('git', ['add', '-A', '--', ...changedPaths], root);
    await runOrFail(
      'git',
      ['commit', '-m', message, '--', ...changedPaths],
      root
    );
  }
  await runOrFail('git', pushArgs, root);
  const url = await siteUrl(root, config);
  log.success(
    url
      ? `Pushed. Your host builds and publishes the site from here, usually within a few minutes. Live at ${url}`
      : 'Pushed. Your host builds and publishes the site from here, usually within a few minutes.'
  );
  return 0;
}
