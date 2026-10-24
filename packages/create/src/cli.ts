import {
  cancel,
  intro,
  isCancel,
  log,
  outro,
  password,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setUpGit } from './git.ts';
import { spawnRunner, type Runner } from './run.ts';
import { LAUNCHER_NAME, isEmptyDir, scaffold } from './scaffold.ts';
import { nextSteps, type Outcome } from './steps.ts';
import {
  BUCKET_NAME,
  HOST_PUBLISH,
  bucketName,
  galleryConfig,
  projectName,
  type Answers,
  type BucketToken,
  type Host,
  type PackageManager,
  type PublishMethod,
  type StorageMode,
} from './templates.ts';
import { createBucket, whoami, type Account } from './wrangler.ts';

const USAGE = `Usage: npm create minimalgallery@latest [folder] [options]

  --name <text>              gallery name
  --author <text>            your name
  --host <host>              cloudflare (recommended), github, netlify or local
  --storage <mode>           repo (the default): the resized photos are published
                             with the site, up to Cloudflare's 20,000-file limit,
                             roughly 3,000 photos; bucket: in a Cloudflare R2
                             bucket, for larger galleries (enabling R2 asks for a
                             payment method, even on the free tier)
  --publish <method>         on Cloudflare: deploy (upload from this computer; the
                             default) or git (push to GitHub, Cloudflare builds it)
  --bucket <name>            R2 bucket name (default: <folder>-media)
  --media-domain <domain>    the bucket’s custom domain, such as media.example.com
  --account-id <id>          Cloudflare account id (default: from wrangler whoami)
  --access-key-id <id>       the R2 API token, written to .env
  --secret-access-key <key>
  --pm <name>                npm, pnpm, yarn or bun
  --yes                      use the defaults for anything not given, without asking
  --no-install               do not install the packages
  --no-git                   do not create the git repository`;

const HOSTS: Array<{ value: Host; label: string; hint: string }> = [
  {
    value: 'cloudflare',
    label: 'Cloudflare',
    hint: 'recommended, free: publish straight from this computer',
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
  'Bucket mode keeps the resized photos in a Cloudflare R2 bucket, served from a media domain of yours, instead of publishing them with the site. Enabling R2 asks for a payment method in the Cloudflare dashboard, even on the free tier.';

const DOMAIN =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

export class Exit extends Error {
  code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

export interface CliDeps {
  /** Runs the package install, wrangler and git. Default: spawns them. */
  run?: Runner;
  /** Ask questions. Default: when stdin is a terminal. */
  interactive?: boolean;
  /** Default: the process’s working directory. */
  cwd?: string;
  /** Default: the process’s environment. */
  env?: NodeJS.ProcessEnv;
  /** Writes the double-click launcher on `darwin`. Default: this machine. */
  platform?: NodeJS.Platform;
  /** For wrangler.jsonc. Default: today. */
  date?: string;
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
  return value as T;
}

/** `media.example.com` from what was typed; '' for nothing, null when it is not a domain. */
export function mediaDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  if (!host) return '';
  return DOMAIN.test(host) ? host : null;
}

const BUCKET_RULE =
  'R2 bucket names have 3 to 63 lowercase letters, digits and dashes, with no dash at either end.';

async function install(
  run: Runner,
  dir: string,
  pm: PackageManager
): Promise<boolean> {
  const out = await run(pm, ['install'], { cwd: dir });
  if (out.code !== 0)
    console.error(
      `${out.stdout}${out.stderr}`.trim().split('\n').slice(-20).join('\n')
    );
  return out.code === 0;
}

async function chooseAccount(
  accounts: Account[],
  ask: boolean
): Promise<string> {
  if (accounts.length <= 1) return accounts[0]?.id ?? '';
  if (!ask) {
    log.info(
      `Using the Cloudflare account “${accounts[0].name}”. Pass --account-id to pick another.`
    );
    return accounts[0].id;
  }
  return answered(
    await select<string>({
      message: 'Which Cloudflare account should hold the bucket?',
      options: accounts.map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.id,
      })),
    })
  );
}

/**
 * Reads the account id and creates the bucket, when wrangler is logged in.
 * Never stops the scaffold: what it cannot do ends up in the next steps.
 */
async function setUpBucket(
  run: Runner,
  dir: string,
  answers: Answers,
  ask: boolean
): Promise<NonNullable<Outcome['cloudflare']>> {
  const bucket = answers.bucket!;
  const spin = spinner();
  let login: 'logged-in' | 'logged-out' | 'unknown' = 'unknown';
  let tryCreate = Boolean(bucket.accountId);

  if (!bucket.accountId) {
    spin.start('Checking your Cloudflare login');
    const who = await whoami(run, dir);
    if (who.status === 'logged-in') {
      login = 'logged-in';
      tryCreate = true;
      spin.stop(
        who.accounts.length
          ? 'Logged in to Cloudflare'
          : 'Logged in to Cloudflare, but wrangler shows no account id'
      );
      bucket.accountId = await chooseAccount(who.accounts, ask);
      if (bucket.accountId)
        await writeFile(
          join(dir, 'minimalgallery.config.ts'),
          galleryConfig(answers)
        );
    } else if (who.status === 'logged-out') {
      login = 'logged-out';
      spin.stop('Not logged in to Cloudflare yet');
    } else if (who.status === 'unavailable')
      spin.stop('wrangler is not available');
    else spin.stop(`wrangler whoami failed: ${who.message}`);
  }

  const result: NonNullable<Outcome['cloudflare']> = {
    login,
    accountId: bucket.accountId,
    bucket: 'not-tried',
  };
  if (!tryCreate) return result;

  spin.start(`Creating the R2 bucket ${bucket.name}`);
  const made = await createBucket(run, dir, bucket.name, bucket.accountId);
  result.bucket = made.status;
  if (made.status === 'created')
    spin.stop(`Created the R2 bucket ${bucket.name}`);
  else if (made.status === 'exists') {
    spin.stop(`The bucket ${bucket.name} already exists; the gallery uses it`);
    log.warn(
      'Keep that bucket for the gallery alone: minimalgallery sync --prune deletes the files no photo uses.'
    );
  } else if (made.status === 'r2-disabled')
    spin.stop('R2 is not enabled on this Cloudflare account yet');
  else if (made.status === 'logged-out') {
    result.login = 'logged-out';
    spin.stop('Not logged in to Cloudflare yet');
  } else if (made.status === 'unavailable')
    spin.stop('wrangler is not available');
  else {
    result.error = made.message;
    spin.stop(`Could not create the bucket: ${made.message}`);
  }
  return result;
}

async function gitRepository(
  run: Runner,
  dir: string
): Promise<NonNullable<Outcome['git']>> {
  const spin = spinner();
  spin.start('Creating the git repository');
  const git = await setUpGit(run, dir);
  if (git.status === 'committed')
    spin.stop('Created the git repository, with a first commit');
  else if (git.status === 'unavailable') spin.stop('git is not installed');
  else if (git.status === 'inside')
    spin.stop(`The folder is inside the git repository at ${git.root}`);
  else spin.stop(`git could not make the first commit: ${git.message}`);
  return git;
}

export async function main(
  argv: string[],
  deps: CliDeps = {}
): Promise<number> {
  const run = deps.run ?? spawnRunner;
  const cwd = deps.cwd ?? process.cwd();
  const env = deps.env ?? process.env;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        name: { type: 'string' },
        author: { type: 'string' },
        host: { type: 'string' },
        storage: { type: 'string' },
        // The old name of --storage: small is repo, large is bucket.
        size: { type: 'string' },
        publish: { type: 'string' },
        bucket: { type: 'string' },
        'media-domain': { type: 'string' },
        'account-id': { type: 'string' },
        'access-key-id': { type: 'string' },
        'secret-access-key': { type: 'string' },
        pm: { type: 'string' },
        yes: { type: 'boolean', short: 'y', default: false },
        'no-install': { type: 'boolean', default: false },
        'no-git': { type: 'boolean', default: false },
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

  const hostFlag = oneOf(
    'host',
    values.host,
    HOSTS.map((h) => h.value)
  );
  const size = oneOf('size', values.size, ['small', 'large']);
  const storageFlag =
    oneOf<StorageMode>('storage', values.storage, ['bucket', 'repo']) ??
    (size && (size === 'large' ? 'bucket' : 'repo'));
  const publishFlag = oneOf<PublishMethod>('publish', values.publish, [
    'git',
    'deploy',
  ]);
  const pmFlag = oneOf('pm', values.pm, PMS);
  if (values.bucket !== undefined && !BUCKET_NAME.test(values.bucket))
    throw new Exit(`--bucket: ${BUCKET_RULE}`);
  const domainFlag =
    values['media-domain'] === undefined
      ? undefined
      : mediaDomain(values['media-domain']);
  if (domainFlag === null)
    throw new Exit('--media-domain takes a domain, such as media.example.com');
  const accountFlag = values['account-id']?.trim().toLowerCase();
  if (accountFlag !== undefined && !ACCOUNT_ID.test(accountFlag))
    throw new Exit('--account-id takes the 32-character Cloudflare account id');
  const keyFlag = values['access-key-id']?.trim();
  const secretFlag = values['secret-access-key']?.trim();
  if (Boolean(keyFlag) !== Boolean(secretFlag))
    throw new Exit('Pass --access-key-id and --secret-access-key together.');
  if (hostFlag && hostFlag !== 'cloudflare') {
    if (values.storage === 'bucket')
      throw new Exit(
        'Bucket mode is set up with Cloudflare R2: use --host cloudflare, or --storage repo.'
      );
    if (publishFlag && publishFlag !== HOST_PUBLISH[hostFlag])
      throw new Exit(`--publish ${publishFlag} needs --host cloudflare.`);
  }
  // Without a terminal to ask in, use the defaults.
  const ask = !values.yes && (deps.interactive ?? Boolean(process.stdin.isTTY));

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
  const dir = resolve(cwd, folder);
  if (!(await isEmptyDir(dir)))
    throw new Exit(`${dir} is not empty. Pick a new folder name.`);
  const project = projectName(basename(dir));

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
  // Bucket mode and direct deploys are set up on Cloudflare only.
  const cloudflareOnly =
    values.storage === 'bucket' || publishFlag === 'deploy';
  const host: Host =
    hostFlag ??
    (ask && !cloudflareOnly
      ? answered(
          await select<Host>({
            message: 'Where will it live?',
            options: HOSTS,
            initialValue: 'cloudflare',
          })
        )
      : 'cloudflare');

  let storage: StorageMode = 'repo';
  let publish = HOST_PUBLISH[host];
  let bucket: Answers['bucket'];
  let token: BucketToken | undefined;
  // The simplest path is the default: the resized photos go up with the
  // site. Bucket mode (R2) is an opt-in, with --storage bucket.
  if (host === 'cloudflare') {
    // A bucket-only flag (--bucket, --media-domain, the R2 token) asks for
    // bucket mode as well.
    const bucketFlags = [values.bucket, values['media-domain'], keyFlag].some(
      (v) => v !== undefined
    );
    storage = storageFlag ?? (bucketFlags ? 'bucket' : 'repo');
    if (storage === 'bucket') log.info(BUCKET_NOTE);
  }

  if (storage === 'bucket') {
    const defaultBucket = bucketName(project);
    const bucketAnswer =
      values.bucket ??
      (ask
        ? answered(
            await text({
              message: 'Bucket name',
              placeholder: defaultBucket,
              defaultValue: defaultBucket,
              validate: (v) =>
                !v || BUCKET_NAME.test(v) ? undefined : BUCKET_RULE,
            })
          )
        : defaultBucket);
    const domain =
      domainFlag ??
      (ask
        ? mediaDomain(
            answered(
              await text({
                message: 'Media domain, where the photos are served from',
                placeholder:
                  'media.example.com; leave empty to set it up later',
                defaultValue: '',
                validate: (v) =>
                  mediaDomain(v ?? '') === null
                    ? 'Type a domain such as media.example.com, or leave it empty.'
                    : undefined,
              })
            )
          )!
        : '');
    bucket = { name: bucketAnswer, domain, accountId: accountFlag ?? '' };

    if (keyFlag && secretFlag)
      token = { accessKeyId: keyFlag, secretAccessKey: secretFlag };
    else if (ask) {
      log.info(
        `Publish uploads the photos with an R2 API token: in the Cloudflare dashboard, R2, Manage API tokens, Object Read & Write on ${bucketAnswer}. You can add it to .env later.`
      );
      const accessKeyId = answered(
        await text({
          message: 'R2 access key id',
          placeholder: 'leave empty to add the token later',
          defaultValue: '',
          validate: (v) =>
            /\s/.test(v?.trim() ?? '') ? 'The key has no spaces.' : undefined,
        })
      ).trim();
      if (accessKeyId) {
        const secretAccessKey = answered(
          await password({
            message: 'R2 secret access key',
            validate: (v) =>
              v?.trim() && !/\s/.test(v.trim())
                ? undefined
                : 'Paste the secret that came with the access key id.',
          })
        ).trim();
        token = { accessKeyId, secretAccessKey };
      }
    }
  }

  // Publishing from this computer is the default; git (Cloudflare builds
  // from a GitHub repository) is an opt-in, with --publish git or later in
  // the admin.
  if (host === 'cloudflare') publish = publishFlag ?? 'deploy';

  const agent = env.npm_config_user_agent?.split('/')[0];
  const detected = PMS.includes(agent as PackageManager)
    ? (agent as PackageManager)
    : 'npm';
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
    host,
    storage,
    bucket,
    token,
    publish,
    packageManager: pm,
  };
  const written = await scaffold(dir, answers, {
    version,
    platform: deps.platform,
    date: deps.date,
  });
  log.success(`Created ${written.length} files in ${dir}`);

  let installed = false;
  if (!values['no-install']) {
    const spin = spinner();
    spin.start(`Installing packages with ${pm}`);
    installed = await install(run, dir, pm);
    if (installed) spin.stop('Packages installed');
    else spin.error(`${pm} install failed; run it yourself in the folder`);
  }

  const outcome: Outcome = {
    folder: relative(cwd, dir) || '.',
    dir,
    installed,
    launcher: written.includes(LAUNCHER_NAME),
  };
  if (storage === 'bucket')
    outcome.cloudflare = await setUpBucket(run, dir, answers, ask);
  // After the install and the account id, so the first commit has the
  // lockfile and the final config.
  if (publish === 'git')
    outcome.git = values['no-git']
      ? { status: 'skipped' }
      : await gitRepository(run, dir);

  outro('Your gallery is ready.');
  process.stdout.write(`\n${nextSteps(answers, outcome)}`);
  return 0;
}
