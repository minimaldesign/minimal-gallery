/** Files whose content depends on the answers. Static files live in `template/`. */

export type Host = 'cloudflare' | 'github' | 'netlify' | 'local';
export type Size = 'small' | 'large';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Answers {
  /** Gallery name, shown as the site title. */
  name: string;
  /** Your name, or empty. */
  author: string;
  host: Host;
  /** `small`: under 500 photos (repo mode); `large`: more (bucket mode, later). */
  size: Size;
  packageManager: PackageManager;
}

export const ASTRO_VERSION = '^7.4.2';
export const WRANGLER_VERSION = '^4.152.0';

/** A single-quoted JavaScript string literal. */
const str = (s: string) =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

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

const PUBLISH: Record<Host, 'deploy' | 'git' | 'build'> = {
  cloudflare: 'deploy',
  github: 'git',
  netlify: 'git',
  local: 'build',
};

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
    minimalgallery: { publish: PUBLISH[answers.host] },
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

export function galleryConfig(answers: Answers): string {
  const lines = [
    `import { defineConfig } from '@minimalgallery/pipeline/config';`,
    '',
    '// Gallery settings. Every key is optional; see the README of',
    '// @minimalgallery/pipeline for the full list.',
    'export default defineConfig({',
    `  name: ${str(answers.name)},`,
  ];
  if (answers.author) lines.push(`  author: ${str(answers.author)},`);
  lines.push(
    '  // The public address, for canonical links, the feed and share images.',
    "  // site: 'https://photos.example.com',"
  );
  if (answers.size === 'large')
    lines.push(
      '  // You expect more than 500 photos. Bucket mode, which keeps the resized',
      '  // photos in a storage bucket such as Cloudflare R2, is not available yet,',
      '  // so the gallery starts in repo mode. npm run doctor says how close it is',
      '  // to the hosting limits.'
    );
  else
    lines.push(
      '  // Repo mode: resized photos are committed and deployed with the site.',
      '  // Fine up to about 500 photos; npm run doctor says when to move on.'
    );
  lines.push("  storage: { mode: 'repo' },", '});', '');
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

export function envExample(answers: Answers): string {
  const lines = [
    '# Copy to .env for values that must stay out of git. Repo mode needs none.',
    '',
    '# Bucket mode (not available yet): keys for the S3-compatible bucket.',
    '# MG_S3_ACCESS_KEY_ID=',
    '# MG_S3_SECRET_ACCESS_KEY=',
  ];
  if (answers.host === 'cloudflare')
    lines.push(
      '',
      '# Only for deploying from CI. On your computer, npx wrangler login is enough.',
      '# CLOUDFLARE_ACCOUNT_ID=',
      '# CLOUDFLARE_API_TOKEN='
    );
  return lines.join('\n') + '\n';
}

export function wranglerJsonc(project: string, date: string): string {
  return `// Cloudflare Workers (static assets) for this gallery. npm run publish
// processes new photos, runs astro build, then wrangler deploy, which uploads
// ./dist under this name. public/_headers sets the cache headers.
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "${project}",
  "compatibility_date": "${date}",
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
}
`;
}

export const HEADERS = `# Resized photos are content-addressed (<hash8>-<variant>), so they never change.
/_mg/*
  Cache-Control: public, max-age=31536000, immutable

# Astro’s build assets (CSS, the theme script, fonts) carry a content hash in
# their names, so they never change either. Without this rule the host serves
# them with max-age=0, and browsers fetch the CSS and script again on every page.
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
`;

const RUN: Record<PackageManager, string> = {
  npm: 'npm run',
  pnpm: 'pnpm run',
  yarn: 'yarn run',
  bun: 'bun run',
};

export const runCommand = (pm: PackageManager, script: string) =>
  `${RUN[pm]} ${script}`;

export function netlifyToml(pm: PackageManager): string {
  return `# Netlify builds the site from the committed photos, manifests and resized
# copies. Photos are processed on your computer, never here.
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
