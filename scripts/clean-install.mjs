#!/usr/bin/env node
// Tests the four packages the way a new user gets them, before they are on
// npm: packs them, publishes the tarballs to a throwaway Verdaccio registry,
// then runs `npm create minimalgallery@latest` with an empty home folder, an
// empty npm cache and a PATH with nothing but Node and the system folders, so
// nothing from this repository or from Homebrew can stand in for a missing
// dependency. The new gallery gets a few photos (one of them HEIC) and runs
// what Getting started tells a user to run: publish (built, not deployed),
// doctor, and wrangler’s dry run of the deploy.
//
//   node scripts/clean-install.mjs              on this computer
//   node scripts/clean-install.mjs --docker     in a Linux container (node:24)
//   node scripts/clean-install.mjs --host local the “my own host” scaffold
//   node scripts/clean-install.mjs --keep       keep the temporary folder
//
// Only Node 24 is needed. Packages other than ours come from the real npm
// registry through Verdaccio. Nothing is published to npm.

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const VERDACCIO = 'verdaccio@6.11.1';
const DOCKER_IMAGE = 'node:24';
const PACKAGES = ['pipeline', 'astro', 'cli', 'create'];
const OURS = [
  '@minimalgallery/pipeline',
  '@minimalgallery/astro',
  'minimalgallery',
  'create-minimalgallery',
];
// A few small photos from minimalgallery.net, in two albums, and an iPhone HEIC.
const PHOTOS = [
  ['examples/demo/photos/colors/Au_Port.jpg', 'colors/Au_Port.jpg'],
  ['examples/demo/photos/colors/Bistro_Latino.jpg', 'colors/Bistro_Latino.jpg'],
  ['packages/pipeline/test/fixtures/ronin.heic', 'iphone/ronin.heic'],
];

const { values: opts } = parseArgs({
  options: {
    docker: { type: 'boolean', default: false },
    host: { type: 'string', default: 'cloudflare' },
    pm: { type: 'string', default: 'npm' },
    keep: { type: 'boolean', default: false },
    'no-build': { type: 'boolean', default: false },
    // Internal: the second half, given a folder of tarballs and photos.
    bundle: { type: 'string' },
  },
});
if (!['cloudflare', 'local'].includes(opts.host))
  fail(`--host takes cloudflare or local, not ${opts.host}`);
if (!['npm', 'pnpm'].includes(opts.pm))
  fail(`--pm takes npm or pnpm, not ${opts.pm}`);

const started = Date.now();

if (opts.bundle) {
  await test(resolve(opts.bundle));
} else {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const work = mkdtempSync(join(tmpdir(), 'mg-clean-install-'));
  const bundle = join(work, 'bundle');
  try {
    await pack(repo, bundle);
    if (opts.docker) await inDocker(bundle);
    else await test(bundle, work);
  } finally {
    if (opts.keep) log(`Kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}
log(`Passed in ${Math.round((Date.now() - started) / 1000)} s.`);

/** Builds the packages and packs them, with workspace:* rewritten, plus the photos. */
async function pack(repo, bundle) {
  mkdirSync(join(bundle, 'packs'), { recursive: true });
  if (!opts['no-build']) {
    step('Building the packages');
    await shAsync('pnpm', ['build'], { cwd: repo });
  }
  step('Packing them');
  for (const p of PACKAGES)
    await shAsync(
      'pnpm',
      ['pack', '--pack-destination', join(bundle, 'packs')],
      {
        cwd: join(repo, 'packages', p),
        quiet: true,
      }
    );
  for (const [from, to] of PHOTOS) {
    mkdirSync(dirname(join(bundle, 'photos', to)), { recursive: true });
    copyFileSync(join(repo, from), join(bundle, 'photos', to));
  }
  copyFileSync(
    fileURLToPath(import.meta.url),
    join(bundle, 'clean-install.mjs')
  );
}

/** Runs the second half in a fresh Linux container: no ExifTool, no sips. */
async function inDocker(bundle) {
  step(`Running in ${DOCKER_IMAGE}`);
  await shAsync('docker', [
    'run',
    '--rm',
    '-v',
    `${bundle}:/bundle`,
    DOCKER_IMAGE,
    'node',
    '/bundle/clean-install.mjs',
    '--bundle',
    '/bundle',
    '--host',
    opts.host,
    '--pm',
    opts.pm,
  ]);
}

async function test(bundle, work = mkdtempSync(join(tmpdir(), 'mg-clean-'))) {
  const port = await freePort();
  const registry = `http://127.0.0.1:${port}/`;
  const verdaccio = await startRegistry(join(work, 'registry'), port);
  try {
    // The user’s computer: nothing but Node, the system folders and an empty home.
    const home = join(work, 'home');
    mkdirSync(home, { recursive: true });
    const token = await addUser(registry);
    writeFileSync(
      join(home, '.npmrc'),
      `registry=${registry}\n//127.0.0.1:${port}/:_authToken=${token}\n`
    );
    const env = cleanEnv(home);

    step('Publishing to the test registry');
    for (const tgz of readdirSync(join(bundle, 'packs')))
      await shAsync(
        'npm',
        [
          'publish',
          join(bundle, 'packs', tgz),
          '--tag',
          'latest',
          '--provenance=false',
        ],
        { cwd: home, env, quiet: true }
      );

    if (opts.pm === 'pnpm') {
      step('Installing pnpm');
      await shAsync(
        'npm',
        ['install', '-g', '--prefix', join(home, '.npm-global'), 'pnpm@10'],
        {
          cwd: home,
          env,
          quiet: true,
        }
      );
      env.PATH = `${join(home, '.npm-global', 'bin')}:${env.PATH}`;
    }

    step(`${opts.pm} create minimalgallery@latest (host: ${opts.host})`);
    const createArgs = [
      'mg',
      '--yes',
      '--host',
      opts.host,
      '--name',
      'Clean install',
      '--author',
      'Test',
    ];
    if (opts.pm === 'npm')
      await shAsync(
        'npm',
        ['create', 'minimalgallery@latest', '--', ...createArgs],
        { cwd: home, env }
      );
    else
      await shAsync(
        'pnpm',
        ['create', 'minimalgallery@latest', ...createArgs],
        { cwd: home, env }
      );

    const gallery = join(home, 'mg');
    const pkg = JSON.parse(readFileSync(join(gallery, 'package.json'), 'utf8'));
    const installed = OURS.filter((n) => n !== 'create-minimalgallery').map(
      (n) =>
        JSON.parse(
          readFileSync(join(gallery, 'node_modules', n, 'package.json'), 'utf8')
        )
    );
    for (const p of installed)
      if (p.version !== packVersion(bundle, p.name))
        fail(
          `${p.name} ${p.version} is installed, not the packed ${packVersion(bundle, p.name)}`
        );
    if (JSON.stringify(pkg).includes('workspace:'))
      fail('package.json still has a workspace: range');

    step('Adding photos');
    cpSync(join(bundle, 'photos'), join(gallery, 'photos'), {
      recursive: true,
    });

    // `npm run publish` and `pnpm run publish`, as the next steps say: a bare
    // `pnpm publish` is pnpm’s own command. npm needs `--` before the flags.
    const run = (script, ...flags) => [
      opts.pm,
      [
        'run',
        script,
        ...(flags.length && opts.pm === 'npm' ? ['--'] : []),
        ...flags,
      ],
    ];
    step('publish --build');
    await shAsync(...run('publish', '--build'), { cwd: gallery, env });
    checkSite(gallery);

    step('doctor');
    await shAsync(...run('doctor'), { cwd: gallery, env });

    if (opts.host === 'cloudflare') {
      step('wrangler deploy --dry-run');
      await shAsync(
        opts.pm === 'npm' ? 'npx' : 'pnpm',
        [
          ...(opts.pm === 'npm' ? [] : ['exec']),
          'wrangler',
          'deploy',
          '--dry-run',
        ],
        {
          cwd: gallery,
          env,
        }
      );
    }
  } finally {
    verdaccio.kill();
  }
}

/** The built site has a home page, both albums, a page per photo and the resized photos. */
function checkSite(gallery) {
  const dist = join(gallery, 'dist');
  const must = (path, what) => {
    if (!existsSync(join(dist, path)))
      fail(`dist/${path} is missing (${what})`);
  };
  must('index.html', 'the home page');
  const manifest = join(gallery, '.minimalgallery', 'manifest');
  // One manifest per photo, plus _albums.json.
  const photos = readdirSync(manifest).filter(
    (f) => f !== '_albums.json' && f.endsWith('.json')
  );
  if (photos.length !== PHOTOS.length)
    fail(`the manifests list ${photos.length} photos, not ${PHOTOS.length}`);
  const html = listFiles(dist).filter((f) => f.endsWith('.html'));
  const media = listFiles(join(dist, '_mg')).filter((f) =>
    /\.(avif|jpe?g|webp)$/.test(f)
  );
  if (media.length < PHOTOS.length * 2)
    fail(
      `dist/_mg has ${media.length} resized photos, expected at least ${PHOTOS.length * 2}`
    );
  log(`${html.length} pages, ${media.length} resized photos`);
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
}

function packVersion(bundle, name) {
  const base = name.replace('@', '').replace('/', '-');
  const tgz = readdirSync(join(bundle, 'packs')).find((f) =>
    new RegExp(`^${base}-\\d`).test(f)
  );
  return tgz?.slice(base.length + 1, -'.tgz'.length);
}

/** Our packages come only from the test registry; everything else from npm. */
async function startRegistry(dir, port) {
  mkdirSync(dir, { recursive: true });
  const local = OURS.map(
    (name) => `  '${name}':\n    access: $all\n    publish: $authenticated\n`
  ).join('');
  writeFileSync(
    join(dir, 'config.yaml'),
    [
      `storage: ${join(dir, 'storage')}`,
      'auth:',
      '  htpasswd:',
      `    file: ${join(dir, 'htpasswd')}`,
      'uplinks:',
      '  npmjs:',
      '    url: https://registry.npmjs.org/',
      '    timeout: 60s',
      'packages:',
      local.trimEnd(),
      "  '**':",
      '    access: $all',
      '    proxy: npmjs',
      'max_body_size: 200mb',
      'log: { type: stdout, format: pretty, level: error }',
      '',
    ].join('\n')
  );
  step(`Starting Verdaccio on ${port}`);
  const child = spawn(
    'npx',
    [
      '--yes',
      VERDACCIO,
      '--config',
      join(dir, 'config.yaml'),
      '--listen',
      `127.0.0.1:${port}`,
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, npm_config_cache: join(dir, 'npx-cache') },
    }
  );
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) fail('Verdaccio stopped while starting');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/-/ping`);
      if (res.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  fail('Verdaccio did not start within two minutes');
}

async function addUser(registry) {
  const res = await fetch(`${registry}-/user/org.couchdb.user:test`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'test', password: 'test-password' }),
  });
  if (!res.ok)
    fail(`Could not add the test user: ${res.status} ${await res.text()}`);
  return (await res.json()).token;
}

/**
 * The environment of a new user: an empty home, a PATH of Node plus the
 * system folders (no Homebrew, so no ExifTool or cjxl), and nothing else
 * from this shell.
 */
function cleanEnv(home) {
  const system =
    process.platform === 'darwin'
      ? ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
      : ['/usr/local/sbin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'];
  return {
    HOME: home,
    PATH: [dirname(process.execPath), ...system].join(':'),
    TMPDIR: join(home, 'tmp'),
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    npm_config_cache: join(home, '.npm'),
    npm_config_userconfig: join(home, '.npmrc'),
    npm_config_update_notifier: 'false',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ASTRO_TELEMETRY_DISABLED: '1',
    WRANGLER_SEND_METRICS: 'false',
    ...(process.env.CI ? { CI: process.env.CI } : {}),
  };
}

function freePort() {
  return new Promise((ok, no) => {
    const s = createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function shAsync(cmd, args, { cwd, env, quiet = false } = {}) {
  if (env) mkdirSync(env.TMPDIR, { recursive: true });
  return new Promise((ok) => {
    const child = spawn(cmd, args, {
      cwd,
      env: env ?? process.env,
      stdio: quiet
        ? ['ignore', 'pipe', 'pipe']
        : ['ignore', 'inherit', 'inherit'],
    });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', (e) => fail(`${cmd}: ${e.message}`));
    child.on('close', (code) => {
      if (code !== 0) {
        if (quiet) process.stderr.write(out);
        fail(`${cmd} ${args.join(' ')} exited with ${code}`);
      }
      ok(out);
    });
  });
}

function step(text) {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`\n▸ ${text} (${s} s)`);
}
function log(text) {
  console.log(text);
}
function fail(text) {
  console.error(`\n✗ ${text}`);
  process.exit(1);
}
