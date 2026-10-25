import { cancel, confirm, isCancel, log, note } from '@clack/prompts';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadConfig,
  type GalleryConfig,
} from '@minimalgallery/pipeline/config';
import { formatBytes } from '@minimalgallery/pipeline/doctor';
import { pendingUploads } from '@minimalgallery/pipeline';
import { parse } from '../args.ts';
import { stopOnPlaceholders, uploadStaged } from '../bucket.ts';
import { CliError } from '../errors.ts';
import { capture, localBin, runOrFail, runTee } from '../exec.ts';
import { runPipeline } from '../pipeline.ts';
import { requireGalleryRoot } from '../root.ts';

export const PUBLISH_USAGE = `Usage: minimalgallery publish [--deploy | --build] [--yes]

Processes new photos, uploads them to the bucket in bucket mode, then
publishes the gallery one of two ways:
  --deploy   build the site and upload it to Cloudflare Workers (static
             assets) with wrangler deploy, as set in wrangler.jsonc
  --build    build the site into dist/ and stop, to upload it to any host
Without a flag, the "minimalgallery.publish" field of package.json decides
("deploy" or "build"), else --deploy when wrangler.jsonc exists, else --build.
  --yes            do not ask before deploying
The last line gives the site’s address when it is known.`;

export type PublishMethod = 'deploy' | 'build';

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
  flags: { deploy?: boolean; build?: boolean }
): Promise<PublishMethod> {
  const chosen = (['deploy', 'build'] as const).filter((m) => flags[m]);
  if (chosen.length > 1)
    throw new CliError('Pick one of --deploy and --build.');
  if (chosen.length) return chosen[0];
  const pkg = await readPackageJson(root);
  const setting = (pkg?.minimalgallery as { publish?: unknown } | undefined)
    ?.publish;
  if (setting === 'deploy' || setting === 'build') return setting;
  if (setting === 'git')
    throw new CliError(
      'package.json has "minimalgallery": { "publish": "git" }, and publishing with git is gone. Use "deploy" to upload to Cloudflare, or "build" to build dist/ for another host. Keeping the gallery in git is still fine: commit and push it yourself.'
    );
  if (setting !== undefined)
    throw new CliError(
      `package.json has "minimalgallery": { "publish": ${JSON.stringify(setting)} }; use "deploy" or "build".`
    );
  return existsSync(join(root, 'wrangler.jsonc')) ||
    existsSync(join(root, 'wrangler.json'))
    ? 'deploy'
    : 'build';
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
      deploy: { type: 'boolean' },
      build: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y', default: false },
    },
    PUBLISH_USAGE
  );
  const root = await requireGalleryRoot(dir);
  const method = await choosePublishMethod(root, values);
  const config = await loadConfig(root);
  // Before the pipeline and the plan: nothing is uploaded, committed or deployed.
  stopOnPlaceholders(config, 'Nothing was published.');
  if (method === 'deploy') return deploy(root, config, values.yes);

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
