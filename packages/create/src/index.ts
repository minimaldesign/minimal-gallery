#!/usr/bin/env node
import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LAUNCHER_NAME, isEmptyDir, scaffold } from './scaffold.ts';
import {
  runCommand,
  type Answers,
  type Host,
  type PackageManager,
  type Size,
} from './templates.ts';

const USAGE = `Usage: npm create minimalgallery@latest [folder] [options]

  --name <text>     gallery name
  --author <text>   your name
  --host <host>     cloudflare (recommended), github, netlify or local
  --size <size>     small (under 500 photos) or large
  --pm <name>       npm, pnpm, yarn or bun
  --yes             use the defaults for anything not given, without asking
  --no-install      do not install the packages`;

const HOSTS: Array<{ value: Host; label: string; hint: string }> = [
  {
    value: 'cloudflare',
    label: 'Cloudflare',
    hint: 'recommended, free: Workers static assets',
  },
  { value: 'github', label: 'GitHub Pages', hint: 'free, up to 1 GB' },
  {
    value: 'netlify',
    label: 'Netlify',
    hint: 'works, not recommended for large galleries',
  },
  {
    value: 'local',
    label: 'Just build it locally',
    hint: 'upload dist/ anywhere',
  },
];
const PMS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

const BUCKET_NOTE =
  'Bucket mode keeps the resized photos in a storage bucket such as Cloudflare R2 instead of the repository, so large galleries stay under the hosts’ limits. It is not available yet: your gallery starts in repo mode, and npm run doctor tells you when the limits get close.';

class Exit extends Error {
  code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

function detectPackageManager(): PackageManager {
  const name = process.env.npm_config_user_agent?.split('/')[0];
  return PMS.includes(name as PackageManager)
    ? (name as PackageManager)
    : 'npm';
}

function answered<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel('Canceled. Nothing was written.');
    throw new Exit('', 130);
  }
  return value as Exclude<T, symbol>;
}

function oneOf<T extends string>(
  flag: string,
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T))
    throw new Exit(`--${flag} must be one of: ${allowed.join(', ')}`);
  return value as Exclude<T, symbol>;
}

function install(dir: string, pm: PackageManager): Promise<boolean> {
  return new Promise((done) => {
    const child = spawn(pm, ['install'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (e) => {
      output += e.message;
      done(false);
    });
    child.on('close', (code) => {
      if (code !== 0)
        console.error(output.trim().split('\n').slice(-20).join('\n'));
      done(code === 0);
    });
  });
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        name: { type: 'string' },
        author: { type: 'string' },
        host: { type: 'string' },
        size: { type: 'string' },
        pm: { type: 'string' },
        yes: { type: 'boolean', short: 'y', default: false },
        'no-install': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    throw new Exit(`${(e as Error).message}\n\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const version = (
    JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version: string }
  ).version;
  const host = oneOf(
    'host',
    values.host,
    HOSTS.map((h) => h.value)
  );
  const size = oneOf<Size>('size', values.size, ['small', 'large']);
  const pmFlag = oneOf('pm', values.pm, PMS);
  // Without a terminal to ask in, use the defaults.
  const ask = !values.yes && Boolean(process.stdin.isTTY);

  intro('create-minimalgallery');

  const folder =
    positionals[0] ??
    (ask
      ? answered(
          await text({
            message: 'Where should the gallery go?',
            placeholder: 'my-gallery',
            defaultValue: 'my-gallery',
          })
        )
      : 'my-gallery');
  const dir = resolve(folder);
  if (!(await isEmptyDir(dir)))
    throw new Exit(`${dir} is not empty. Pick a new folder name.`);

  const name =
    values.name ??
    (ask
      ? answered(
          await text({
            message: 'Gallery name',
            placeholder: 'Photos',
            defaultValue: 'Photos',
          })
        )
      : 'Photos');
  const author =
    values.author ??
    (ask
      ? answered(
          await text({
            message: 'Your name',
            placeholder: 'shown as the author; leave empty to skip',
            defaultValue: '',
          })
        )
      : '');
  const chosenHost =
    host ??
    (ask
      ? answered(
          await select<Host>({
            message: 'Where will it live?',
            options: HOSTS,
            initialValue: 'cloudflare',
          })
        )
      : 'cloudflare');
  const chosenSize =
    size ??
    (ask
      ? answered(
          await select<Size>({
            message: 'Roughly how many photos?',
            options: [
              {
                value: 'small',
                label: 'Under 500',
                hint: 'the photos live in the repository',
              },
              {
                value: 'large',
                label: 'More than 500',
                hint: 'bucket mode, coming later',
              },
            ],
            initialValue: 'small',
          })
        )
      : 'small');
  if (chosenSize === 'large') log.info(BUCKET_NOTE);
  const detected = detectPackageManager();
  const pm =
    pmFlag ??
    (ask
      ? answered(
          await select<PackageManager>({
            message: 'Package manager',
            options: PMS.map((p) => ({
              value: p,
              label: p,
              hint: p === detected ? 'detected' : undefined,
            })),
            initialValue: detected,
          })
        )
      : detected);

  const answers: Answers = {
    name: name.trim() || 'Photos',
    author: author.trim(),
    host: chosenHost,
    size: chosenSize,
    packageManager: pm,
  };
  const written = await scaffold(dir, answers, { version });
  log.success(`Created ${written.length} files in ${dir}`);

  let installed = false;
  if (!values['no-install']) {
    const spin = spinner();
    spin.start(`Installing packages with ${pm}`);
    installed = await install(dir, pm);
    if (installed) spin.stop('Packages installed');
    else spin.error(`${pm} install failed; run it yourself in the folder`);
  }

  const cd = relative(process.cwd(), dir) || '.';
  const steps = [`cd ${cd.includes(' ') ? `"${cd}"` : cd}`];
  if (!installed) steps.push(`${pm} install`);
  steps.push(runCommand(pm, 'admin'));
  const lines = [...steps.map((s) => `  ${s}`), ''];
  if (written.includes(LAUNCHER_NAME))
    lines.push(
      `Next time, double-click “${LAUNCHER_NAME}” in the folder instead.`
    );
  lines.push(
    'Add photos: put a folder of JPEGs in photos/ (one folder per album),',
    'or run npx minimalgallery add ~/Pictures/Export/japan',
    `Publish: ${runCommand(pm, 'publish')}`
  );
  const hostNote: Record<Host, string> = {
    cloudflare:
      'The first publish asks you to run npx wrangler login once, to connect Cloudflare.',
    github:
      'Before the first publish: create a GitHub repository, push this folder to it, and set Pages to GitHub Actions in its settings.',
    netlify:
      'Before the first publish: push this folder to a git repository and import it in Netlify.',
    local:
      'Publish builds the site into dist/, ready to upload to any static host.',
  };
  lines.push(hostNote[answers.host]);
  note(lines.join('\n'), 'Next steps');
  outro('Your gallery is ready.');
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Exit) {
    if (e.message) console.error(e.message);
    process.exitCode = e.code;
  } else {
    console.error(`Error: ${(e as Error).message}`);
    if (process.env.MG_DEBUG) console.error((e as Error).stack);
    process.exitCode = 1;
  }
}
