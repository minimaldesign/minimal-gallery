/**
 * The next steps printed at the end: numbered, and only what is left to do
 * after the scaffold has done what it could.
 */
import { relative } from 'node:path';
import { FIRST_COMMIT, type GitSetup } from './git.ts';
import { runCommand, type Answers } from './templates.ts';
import type { BucketCreation } from './wrangler.ts';

export interface Outcome {
  /** The gallery folder, as typed after `cd`. */
  folder: string;
  /** Absolute path of the gallery folder. */
  dir: string;
  installed: boolean;
  /** The double-click launcher was written. */
  launcher: boolean;
  /** Bucket mode: what wrangler said. */
  cloudflare?: {
    /** `unknown` when wrangler was not asked or could not tell. */
    login: 'logged-in' | 'logged-out' | 'unknown';
    accountId: string;
    bucket: BucketCreation['status'] | 'not-tried';
    /** wrangler’s error, when the bucket creation failed. */
    error?: string;
  };
  /** Git publishing: what the repository setup did; `skipped` with --no-git. */
  git?: GitSetup | { status: 'skipped' };
}

const shellPath = (p: string) => (/[\s'"$]/.test(p) ? `"${p}"` : p);

const HOST_BUILDS = {
  cloudflare: 'Cloudflare',
  github: 'GitHub Pages',
  netlify: 'Netlify',
  local: '',
};

/** Each step is a first line and optional indented lines below it. */
type Step = string[];

function bucketSteps(answers: Answers, outcome: Outcome): Step[] {
  const bucket = answers.bucket!;
  const cf = outcome.cloudflare ?? {
    login: 'unknown',
    accountId: bucket.accountId,
    bucket: 'not-tried',
  };
  const steps: Step[] = [];
  const create = `npx wrangler r2 bucket create ${bucket.name}`;
  const account =
    'copy your account id from npx wrangler whoami into endpoint, in minimalgallery.config.ts.';

  let creation: Step | null = null;
  if (cf.bucket === 'r2-disabled')
    creation = [
      'Enable R2 in the Cloudflare dashboard (R2 Object Storage), then create the bucket:',
      create,
    ];
  else if (cf.bucket === 'failed')
    creation = [
      `Create the bucket (wrangler said: ${cf.error ?? 'it failed'}):`,
      create,
    ];
  else if (cf.bucket !== 'created' && cf.bucket !== 'exists')
    creation = [
      'Connect Cloudflare (once on this computer) and create the bucket:',
      'npx wrangler login',
      create,
    ];
  if (creation) {
    if (!cf.accountId) creation.push(`Then ${account}`);
    steps.push(creation);
  } else if (!cf.accountId)
    steps.push([account[0].toUpperCase() + account.slice(1)]);

  const domain = bucket.domain || 'media.<your domain>';
  steps.push([
    `Connect ${bucket.domain || 'a media domain'} to the bucket: in the Cloudflare dashboard, R2, ${bucket.name}, Settings, Custom Domains, Connect Domain. Or:`,
    `npx wrangler r2 bucket domain add ${bucket.name} --domain ${domain} --zone-id <zone id>`,
    'The zone id is on the domain’s Overview page in the dashboard.',
    ...(bucket.domain
      ? []
      : [
          'Then set publicUrl in minimalgallery.config.ts to that address (https://media.<your domain>).',
        ]),
  ]);

  if (!answers.token)
    steps.push([
      `Create an R2 API token: Cloudflare dashboard, R2, Manage API tokens, Object Read & Write on ${bucket.name}.`,
      'Copy .env.example to .env and paste the access key id and the secret into it.',
    ]);
  return steps;
}

function gitSteps(answers: Answers, outcome: Outcome): Step[] {
  const pm = answers.packageManager;
  const git = outcome.git ?? { status: 'skipped' };
  const steps: Step[] = [];
  const commit = `git init -b main && git add -A && git commit -m "${FIRST_COMMIT}"`;
  if (git.status === 'unavailable')
    steps.push([
      'Install git (https://git-scm.com), then in the folder:',
      commit,
    ]);
  else if (git.status === 'skipped')
    steps.push(['Make the folder a git repository:', commit]);
  else if (git.status === 'failed')
    steps.push([
      `Make the first commit (git said: ${git.message}):`,
      `git add -A && git commit -m "${FIRST_COMMIT}"`,
    ]);

  let rootDir = '';
  if (git.status === 'inside') {
    rootDir = relative(git.root, outcome.dir);
    steps.push([
      `Commit the folder and push it with the repository it is in, ${git.root}.`,
    ]);
  } else {
    // GitHub Pages needs a public repository on the free plan.
    const visibility = answers.host === 'github' ? 'public' : 'private';
    steps.push([
      `Put it on GitHub: gh repo create --${visibility} --source . --push`,
      `Without the GitHub CLI, create a ${visibility} repository on github.com and push this folder to it.`,
    ]);
  }

  if (answers.host === 'cloudflare')
    steps.push([
      'Connect the repository in the Cloudflare dashboard: Workers and Pages, Create, Import a repository.',
      `Build command: ${runCommand(pm, 'build')}. Deploy command: npx wrangler deploy.${rootDir ? ` Root directory: ${rootDir}.` : ''}`,
    ]);
  else if (answers.host === 'github')
    steps.push([
      'In the repository’s settings, under Pages, set the source to GitHub Actions.',
    ]);
  else if (answers.host === 'netlify')
    steps.push([
      `Import the repository in Netlify: Add new project, Import an existing project.${rootDir ? ` Base directory: ${rootDir}.` : ''}`,
    ]);
  return steps;
}

export function nextSteps(answers: Answers, outcome: Outcome): string {
  const pm = answers.packageManager;
  const now: Step[] = [[`cd ${shellPath(outcome.folder)}`]];
  if (!outcome.installed) now.push([`${pm} install`]);
  now.push([
    runCommand(pm, 'admin'),
    'It opens the admin in your browser: add photos and preview the gallery.',
    ...(outcome.launcher
      ? [
          'Next time, double-click “Open minimalgallery.command” in the folder instead.',
        ]
      : []),
  ]);

  const before: Step[] = [];
  if (answers.storage === 'bucket' && answers.bucket)
    before.push(...bucketSteps(answers, outcome));
  if (answers.publish === 'git') before.push(...gitSteps(answers, outcome));

  const publish = runCommand(pm, 'publish');
  const upload =
    answers.storage === 'bucket'
      ? 'uploads new photos to the bucket, then '
      : '';
  let last: string;
  if (answers.publish === 'git')
    last = `Then publish from the admin, or with ${publish}: it ${upload}commits and pushes, and ${HOST_BUILDS[answers.host]} builds the site.`;
  else if (answers.publish === 'deploy') {
    const login =
      outcome.cloudflare?.login === 'logged-in'
        ? ''
        : ' The first time, it asks you to run npx wrangler login.';
    last = `Then publish from the admin, or with ${publish}: it ${upload}builds the site and deploys it to Cloudflare.${login}`;
  } else
    last = `${publish} builds the site into dist/, ready to upload to any static host.`;

  let n = 0;
  const render = (steps: Step[]) =>
    steps.flatMap(([first, ...rest]) => {
      n++;
      const pad = ' '.repeat(String(n).length + 4);
      return [`  ${n}. ${first}`, ...rest.map((l) => pad + l)];
    });
  const lines = ['Next steps:', '', ...render(now), ''];
  if (before.length)
    lines.push('Before the first publish:', '', ...render(before), '');
  lines.push(last, '');
  return lines.join('\n');
}
