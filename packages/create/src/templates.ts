/** Files whose content depends on the answers. Static files live in `template/`. */

export type Host = 'cloudflare' | 'github' | 'netlify' | 'local';
/** `repo`: resized photos committed with the site. `bucket`: in a Cloudflare R2 bucket. */
export type StorageMode = 'repo' | 'bucket';
/** The `minimalgallery.publish` setting in package.json. */
export type PublishMethod = 'git' | 'deploy' | 'build';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface BucketAnswers {
  /** R2 bucket name. */
  name: string;
  /** The bucket’s custom domain (`media.example.com`), or empty when it is not set up yet. */
  domain: string;
  /** Cloudflare account id, or empty when it is not known yet. */
  accountId: string;
}

/** An R2 API token’s S3 keys. They go to `.env`, never to the config. */
export interface BucketToken {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface Answers {
  /** Gallery name, shown as the site title. */
  name: string;
  /** Your name, or empty. */
  author: string;
  host: Host;
  storage: StorageMode;
  /** Bucket mode only. */
  bucket?: BucketAnswers;
  /** Bucket mode only, and optional. */
  token?: BucketToken;
  publish: PublishMethod;
  packageManager: PackageManager;
}

export const ASTRO_VERSION = '^7.4.2';
export const WRANGLER_VERSION = '^4.152.0';

/** Written to the config while the account id is not known. */
export const ACCOUNT_ID_PLACEHOLDER = 'your-account-id';
/** Written to the config while the bucket has no custom domain. */
export const PUBLIC_URL_PLACEHOLDER = 'https://media.example.com';

/** A single-quoted JavaScript string literal. */
const str = (s: string) =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/**
 * `key: 'value',` at an indent, broken after the colon past 80 columns the
 * way Prettier does, so a formatter on save leaves the file alone.
 */
function prop(indent: number, key: string, value: string): string[] {
  const pad = ' '.repeat(indent);
  const line = `${pad}${key}: ${str(value)},`;
  return line.length <= 80
    ? [line]
    : [`${pad}${key}:`, `${pad}  ${str(value)},`];
}

/** Cloudflare Worker names: lowercase letters, digits and dashes. */
export function projectName(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58)
    .replace(/-+$/, '');
  return slug || 'my-gallery';
}

/** R2 bucket names: 3 to 63 lowercase letters, digits and dashes, no dash at either end. */
export const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** The default bucket name for a project: `<project>-media`. */
export function bucketName(project: string): string {
  return `${project.slice(0, 57).replace(/-+$/, '')}-media`;
}

/** The publishing method each host uses. Cloudflare asks; the others have one. */
export const HOST_PUBLISH: Record<Host, PublishMethod> = {
  cloudflare: 'deploy',
  github: 'git',
  netlify: 'git',
  local: 'build',
};

export function r2Endpoint(accountId: string): string {
  return `https://${accountId || ACCOUNT_ID_PLACEHOLDER}.r2.cloudflarestorage.com`;
}

export function packageJson(
  answers: Answers,
  name: string,
  version: string
): string {
  const ours = `^${version}`;
  const pkg = {
    name,
    private: true,
    type: 'module',
    scripts: {
      dev: 'astro dev',
      build: 'astro build',
      preview: 'astro preview',
      admin: 'minimalgallery admin',
      publish: 'minimalgallery publish',
      doctor: 'minimalgallery doctor',
      ...(answers.host === 'cloudflare'
        ? { deploy: 'astro build && wrangler deploy' }
        : {}),
    },
    minimalgallery: { publish: answers.publish },
    engines: { node: '>=22.18' },
    dependencies: {
      '@minimalgallery/astro': ours,
      '@minimalgallery/pipeline': ours,
      astro: ASTRO_VERSION,
      minimalgallery: ours,
    },
    ...(answers.host === 'cloudflare'
      ? { devDependencies: { wrangler: WRANGLER_VERSION } }
      : {}),
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

function storageLines(answers: Answers): string[] {
  if (answers.storage === 'repo' || !answers.bucket)
    return [
      '  // Repo mode: the resized photos are published with the site. Good up to',
      '  // a few thousand photos (Cloudflare takes 20,000 files per site);',
      `  // ${runCommand(answers.packageManager, 'doctor')} says how close the gallery is.`,
      "  storage: { mode: 'repo' },",
    ];
  const { name, domain, accountId } = answers.bucket;
  const lines = [
    '  // Bucket mode: the resized photos live in the Cloudflare R2 bucket below,',
    '  // served from its custom domain. Publish uploads new ones before it',
    '  // commits or deploys. The API token is in .env, never in this file.',
    '  storage: {',
    "    mode: 's3',",
    ...prop(4, 'bucket', name),
  ];
  if (!accountId)
    lines.push(
      `    // Placeholder: replace ${ACCOUNT_ID_PLACEHOLDER} with your Cloudflare account id,`,
      '    // which npx wrangler whoami prints.'
    );
  lines.push(
    ...prop(4, 'endpoint', r2Endpoint(accountId)),
    "    region: 'auto',"
  );
  if (!domain)
    lines.push(
      '    // Placeholder: connect a custom domain to the bucket (R2, the bucket,',
      '    // Settings, Custom Domains), then put its address here.'
    );
  lines.push(
    ...prop(
      4,
      'publicUrl',
      domain ? `https://${domain}` : PUBLIC_URL_PLACEHOLDER
    ),
    '  },'
  );
  return lines;
}

export function galleryConfig(answers: Answers): string {
  const lines = [
    `import { defineConfig } from '@minimalgallery/pipeline/config';`,
    '',
    '// Gallery settings. Every key is optional; see the README of',
    '// @minimalgallery/pipeline for the full list.',
    'export default defineConfig({',
    ...prop(2, 'name', answers.name),
  ];
  if (answers.author) lines.push(...prop(2, 'author', answers.author));
  lines.push(
    '  // The public address, for canonical links, the feed and share images.',
    "  // site: 'https://photos.example.com',",
    ...storageLines(answers),
    '});',
    ''
  );
  return lines.join('\n');
}

export function astroConfig(answers: Answers): string {
  const site =
    answers.host === 'github'
      ? [
          '  // GitHub Pages serves a project at https://<user>.github.io/<repo>/:',
          "  // site: 'https://<user>.github.io',",
          "  // base: '/<repo>',",
        ]
      : ["  // site: 'https://photos.example.com',"];
  return [
    '// @ts-check',
    "import { defineConfig } from 'astro/config';",
    "import minimalgallery from '@minimalgallery/astro';",
    '',
    '// The gallery’s own settings (name, author, viewer defaults) are in',
    '// minimalgallery.config.ts, which the integration reads.',
    'export default defineConfig({',
    ...site,
    "  output: 'static',",
    "  trailingSlash: 'always',",
    '  integrations: [minimalgallery()],',
    '  experimental: {',
    '    // Pages whose photos and code are unchanged are not rendered again.',
    '    incrementalBuild: true,',
    '  },',
    '});',
    '',
  ].join('\n');
}

const ENV_INTRO =
  '# Copy to .env, which git ignores, for values that must stay out of the repository.';

export function envExample(answers: Answers): string {
  const lines =
    answers.storage === 'bucket' && answers.bucket
      ? [
          ENV_INTRO,
          '',
          `# The R2 API token that publish uses to upload photos to ${answers.bucket.name}.`,
          '# Create it in the Cloudflare dashboard: R2, Manage API tokens, with the',
          `# permission Object Read & Write on ${answers.bucket.name} only. Cloudflare`,
          '# shows the two values once.',
          'MG_S3_ACCESS_KEY_ID=',
          'MG_S3_SECRET_ACCESS_KEY=',
        ]
      : [
          ENV_INTRO,
          '# Repo mode needs none.',
          '',
          '# Bucket mode only: the API token for the S3-compatible bucket.',
          '# MG_S3_ACCESS_KEY_ID=',
          '# MG_S3_SECRET_ACCESS_KEY=',
        ];
  if (answers.host === 'cloudflare')
    lines.push(
      '',
      '# Only for running wrangler deploy from another CI service. On your computer,',
      '# npx wrangler login is enough, and Cloudflare’s own builds need neither.',
      '# CLOUDFLARE_ACCOUNT_ID=',
      '# CLOUDFLARE_API_TOKEN='
    );
  return lines.join('\n') + '\n';
}

/** `.env` with the bucket token. Git ignores it. */
export function dotEnv(bucket: string, token: BucketToken): string {
  return [
    '# Secrets for this gallery. Git ignores this file: never commit it.',
    `# The R2 API token for the bucket ${bucket}.`,
    `MG_S3_ACCESS_KEY_ID=${token.accessKeyId}`,
    `MG_S3_SECRET_ACCESS_KEY=${token.secretAccessKey}`,
    '',
  ].join('\n');
}

export function wranglerJsonc(
  answers: Answers,
  project: string,
  date: string
): string {
  const pm = answers.packageManager;
  const comment =
    answers.publish === 'git'
      ? [
          '// Cloudflare Workers (static assets) for this gallery. Cloudflare builds it',
          '// from the connected repository on every push (build command',
          `// ${runCommand(pm, 'build')}, deploy command npx wrangler deploy), and`,
          '// wrangler deploy uploads ./dist under this name.',
        ]
      : [
          `// Cloudflare Workers (static assets) for this gallery. ${runCommand(pm, 'publish')}`,
          '// processes new photos, runs astro build, then wrangler deploy, which uploads',
          '// ./dist under this name.',
        ];
  if (answers.storage === 'bucket')
    comment.push(
      '// The photos are not in ./dist: the R2 bucket’s custom domain serves them,',
      '// so this Worker needs no bucket binding.'
    );
  comment.push('// public/_headers sets the cache headers.');
  return `${comment.join('\n')}
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "${project}",
  "compatibility_date": "${date}",
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
`;
}

const ASTRO_HEADERS = `# Astro’s build assets (CSS, the theme script, fonts) carry a content hash in
# their names, so they never change. Without this rule the host serves them
# with max-age=0, and browsers fetch the CSS and script again on every page.
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`;

/** `public/_headers` for Cloudflare. */
export function headers(storage: StorageMode): string {
  return storage === 'bucket'
    ? `# The photos come from the R2 bucket, uploaded by publish with their own
# Cache-Control header, so only the site’s files need a rule here.

${ASTRO_HEADERS}`
    : `# Resized photos are content-addressed (<hash8>-<variant>), so they never change.
/_mg/*
  Cache-Control: public, max-age=31536000, immutable

${ASTRO_HEADERS}`;
}

const RUN: Record<PackageManager, string> = {
  npm: 'npm run',
  pnpm: 'pnpm run',
  yarn: 'yarn run',
  bun: 'bun run',
};

export const runCommand = (pm: PackageManager, script: string) =>
  `${RUN[pm]} ${script}`;

export function netlifyToml(pm: PackageManager): string {
  return `# Netlify builds the site from the committed manifests and resized copies.
# Photos are processed on your computer, never here.
[build]
  command = "${runCommand(pm, 'build')}"
  publish = "dist"

[build.environment]
  NODE_VERSION = "24"

[[headers]]
  for = "/_mg/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

# Astro’s build assets carry a content hash in their names, so they never change.
[[headers]]
  for = "/_astro/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
`;
}

export function githubPagesWorkflow(pm: PackageManager): string {
  const setup: Record<PackageManager, string> = {
    npm: `      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci`,
    pnpm: `      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile`,
    yarn: `      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: yarn
      - run: yarn install --immutable`,
    bun: `      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile`,
  };
  return `# Builds the site from the committed photos, manifests and resized copies,
# and publishes it to GitHub Pages. In the repository settings, under Pages,
# set the source to GitHub Actions.
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
${setup[pm]}
      - run: ${runCommand(pm, 'build')}
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}

export function launcher(pm: PackageManager): string {
  return `#!/bin/sh
# Double-click to open your gallery. Close the Terminal window to stop it.
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then
  ${pm} install || exit 1
fi
${runCommand(pm, 'admin')}
`;
}
