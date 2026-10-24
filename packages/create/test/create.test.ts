import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  ACCOUNT_ID_PLACEHOLDER as PIPELINE_ACCOUNT_ID,
  configPlaceholders,
  loadConfig,
  PUBLIC_URL_PLACEHOLDER as PIPELINE_PUBLIC_URL,
} from '@minimalgallery/pipeline/config';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Exit, main } from '../src/cli.ts';
import { spawnRunner, type Captured, type Runner } from '../src/run.ts';
import { LAUNCHER_NAME, scaffold } from '../src/scaffold.ts';
import {
  ACCOUNT_ID_PLACEHOLDER,
  bucketName,
  projectName,
  PUBLIC_URL_PLACEHOLDER,
} from '../src/templates.ts';
import {
  R2_DISABLED,
  WHOAMI_LOGGED_OUT,
  WHOAMI_ONE,
  WHOAMI_TWO,
} from './fixtures.ts';

const execFileAsync = promisify(execFile);
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const pipelineDir = fileURLToPath(new URL('../../pipeline', import.meta.url));

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'mg-create-'));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false
  );
const read = (dir: string, file: string) => readFile(join(dir, file), 'utf8');

/** Load the generated config the way the pipeline does: loadConfig, with validation. */
async function loadGalleryConfig(dir: string) {
  await mkdir(join(dir, 'node_modules', '@minimalgallery'), {
    recursive: true,
  });
  await symlink(
    pipelineDir,
    join(dir, 'node_modules', '@minimalgallery', 'pipeline')
  );
  return loadConfig(dir);
}

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const ok = (stdout = ''): Captured => ({ code: 0, stdout, stderr: '' });

/** git outside any repository, as in a fresh folder. */
const freshGit: Runner = async (_command, args) =>
  args[0] === 'rev-parse'
    ? { code: 128, stdout: '', stderr: 'fatal: not a git repository' }
    : ok();

interface Call {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * A runner that spawns nothing: the install succeeds, wrangler answers with
 * captured output, git succeeds. Records every call.
 */
function fakeRunner(
  answers: {
    whoami?: Captured;
    create?: Captured;
    git?: Runner;
  } = {}
) {
  const calls: Call[] = [];
  const run: Runner = async (command, args, options) => {
    calls.push({ command, args, env: options.env });
    if (args.includes('install')) return ok();
    if (args[0] === '--version') return ok('10.20.0\n');
    if (args.includes('whoami')) return answers.whoami ?? ok(WHOAMI_ONE);
    if (args.includes('r2')) return answers.create ?? ok('Created bucket');
    if (command === 'git')
      return (answers.git ?? freshGit)(command, args, options);
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
  };
  const wrangler = () =>
    calls.filter((c) => c.args.includes('wrangler')).map((c) => c.args);
  return { run, calls, wrangler };
}

let output = '';
beforeEach(() => {
  output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function create(argv: string[], run: Runner) {
  return main(argv, {
    run,
    interactive: false,
    cwd: tmp,
    platform: 'linux',
    date: '2026-10-23',
    env: { npm_config_user_agent: 'npm/11.0.0 node/v24' },
  });
}

describe('create-minimalgallery', () => {
  it('writes the stand-ins the pipeline checks for', () => {
    expect(ACCOUNT_ID_PLACEHOLDER).toBe(PIPELINE_ACCOUNT_ID);
    expect(PUBLIC_URL_PLACEHOLDER).toBe(PIPELINE_PUBLIC_URL);
  });

  it('scaffolds a Cloudflare gallery in repo mode with --yes --no-install', async () => {
    const dir = join(tmp, 'My Gallery');
    // The real command, spawned. Repo mode and direct deploys run neither
    // wrangler nor git, and --size small is the old spelling of --storage repo.
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        entry,
        dir,
        '--yes',
        '--no-install',
        '--name',
        'Yann’s photos',
        '--author',
        "O'Neil",
        '--host',
        'cloudflare',
        '--size',
        'small',
        '--publish',
        'deploy',
      ],
      { env: { ...process.env, npm_config_user_agent: 'npm/11.0.0 node/v24' } }
    );
    expect(stdout).toContain('npm install');
    expect(stdout).toContain('npm run admin');
    expect(stdout).not.toContain('not available yet');

    for (const file of [
      'package.json',
      'astro.config.mjs',
      'minimalgallery.config.ts',
      'src/content.config.ts',
      'src/pages/index.astro',
      'src/pages/[...album]/[photo].astro',
      'src/pages/404.astro',
      'src/pages/feed.xml.ts',
      'src/pages/feed.json.ts',
      'src/pages/sitemap.xml.ts',
      'src/pages/robots.txt.ts',
      'src/pages/random.astro',
      'photos/README.md',
      '.gitignore',
      '.env.example',
      'tsconfig.json',
      'wrangler.jsonc',
      'public/_headers',
    ])
      expect(await exists(join(dir, file)), file).toBe(true);
    expect(await exists(join(dir, '_gitignore'))).toBe(false);
    expect(await exists(join(dir, 'netlify.toml'))).toBe(false);
    expect(await exists(join(dir, '.env'))).toBe(false);
    expect(await exists(join(dir, '.git'))).toBe(false);

    if (process.platform === 'darwin') {
      const mode = (await stat(join(dir, LAUNCHER_NAME))).mode;
      expect(mode & 0o111).toBeTruthy();
    }

    const pkg = JSON.parse(await read(dir, 'package.json'));
    expect(pkg.name).toBe('my-gallery');
    expect(Object.keys(pkg.scripts)).toEqual([
      'dev',
      'build',
      'preview',
      'admin',
      'publish',
      'doctor',
      'deploy',
    ]);
    expect(pkg.scripts.deploy).toBe('astro build && wrangler deploy');
    expect(Object.keys(pkg.dependencies)).toEqual([
      '@minimalgallery/astro',
      '@minimalgallery/pipeline',
      'astro',
      'minimalgallery',
    ]);
    expect(pkg.minimalgallery.publish).toBe('deploy');
    // npm needs no pinned version
    expect(pkg.packageManager).toBeUndefined();
    const wrangler = await read(dir, 'wrangler.jsonc');
    expect(wrangler).toContain('"name": "my-gallery"');
    expect(wrangler).toContain(
      '"assets": { "directory": "./dist", "not_found_handling": "404-page" }'
    );
    expect(wrangler).not.toContain('pages_build_output_dir');
    expect(wrangler).not.toContain('r2_buckets');
    const headers = await read(dir, 'public/_headers');
    for (const path of ['/_mg/*', '/_astro/*'])
      expect(headers).toContain(
        `${path}\n  Cache-Control: public, max-age=31536000, immutable`
      );

    const config = await loadGalleryConfig(dir);
    expect(config.name).toBe('Yann’s photos');
    expect(config.author).toBe("O'Neil");
    expect(config.storage.mode).toBe('repo');
  });

  it('refuses a folder that is not empty', async () => {
    await expect(
      execFileAsync(process.execPath, [
        entry,
        join(tmp, 'My Gallery'),
        '--yes',
        '--no-install',
      ])
    ).rejects.toMatchObject({ code: 1 });
  });

  it('publishes from this computer in repo mode by default on Cloudflare', async () => {
    const fake = fakeRunner({ git: freshGit });
    expect(await create(['cf-default', '--yes'], fake.run)).toBe(0);
    const dir = join(tmp, 'cf-default');
    // No bucket, no git: nothing to ask wrangler or git for.
    expect(fake.wrangler()).toEqual([]);
    expect(fake.calls.some((c) => c.command === 'git')).toBe(false);
    const config = await loadGalleryConfig(dir);
    expect(config.storage).toEqual({ mode: 'repo' });
    const pkg = JSON.parse(await read(dir, 'package.json'));
    expect(pkg.minimalgallery.publish).toBe('deploy');
    expect(await read(dir, 'public/_headers')).toContain('/_mg/*');
    expect(await read(dir, 'wrangler.jsonc')).toContain('wrangler deploy');
    expect(output).not.toContain('bucket');
    expect(output).not.toContain('gh repo create');
    expect(output).toContain('connects Cloudflare');
  });

  it('sets up bucket mode and git publishing when asked', async () => {
    const fake = fakeRunner({ git: freshGit });
    expect(
      await create(
        ['cf-bucket', '--yes', '--storage', 'bucket', '--publish', 'git'],
        fake.run
      )
    ).toBe(0);
    const dir = join(tmp, 'cf-bucket');

    // wrangler: the account id, then the bucket in that account.
    expect(fake.wrangler()).toEqual([
      ['--yes', 'wrangler', 'whoami'],
      ['--yes', 'wrangler', 'r2', 'bucket', 'create', 'cf-bucket-media'],
    ]);
    const createCall = fake.calls.find((c) => c.args.includes('r2'));
    expect(createCall?.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
    // git: after the install, so the first commit has the lockfile.
    const order = fake.calls.map((c) =>
      c.command === 'git' ? `git ${c.args[0]}` : c.args.at(-1)
    );
    expect(order).toEqual([
      'install',
      'whoami',
      'cf-bucket-media',
      'git rev-parse',
      'git init',
      'git add',
      'git commit',
    ]);

    const config = await loadGalleryConfig(dir);
    expect(config.storage).toEqual({
      mode: 's3',
      bucket: 'cf-bucket-media',
      endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
      region: 'auto',
      publicUrl: 'https://media.example.com',
    });
    const source = await read(dir, 'minimalgallery.config.ts');
    expect(source).toContain('// Placeholder: connect a custom domain');
    expect(source).not.toContain('your-account-id');
    expect(source).not.toMatch(/not available yet/);

    const pkg = JSON.parse(await read(dir, 'package.json'));
    expect(pkg.minimalgallery.publish).toBe('git');
    expect(pkg.devDependencies.wrangler).toBeDefined();
    expect(await exists(join(dir, '.env'))).toBe(false);
    const example = await read(dir, '.env.example');
    expect(example).toMatch(/^MG_S3_ACCESS_KEY_ID=$/m);
    expect(example).toMatch(/^MG_S3_SECRET_ACCESS_KEY=$/m);
    expect(example).toContain('R2, Manage API tokens');
    expect(example).toContain('Object Read & Write on cf-bucket-media');
    const gitignore = await read(dir, '.gitignore');
    expect(gitignore).toMatch(/^\.minimalgallery\/cache$/m);
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).not.toMatch(/^\.minimalgallery\/?$/m);
    const headers = await read(dir, 'public/_headers');
    expect(headers).toContain('/_astro/*');
    expect(headers).not.toContain('/_mg/*');
    const wrangler = await read(dir, 'wrangler.jsonc');
    expect(wrangler).toContain('needs no bucket binding');
    expect(wrangler).toContain('npx wrangler deploy');

    // Next steps: only what is left.
    expect(output).toContain('Created the R2 bucket cf-bucket-media');
    expect(output).not.toContain('wrangler login');
    expect(output).not.toContain('bucket create');
    expect(output).toContain(
      'npx wrangler r2 bucket domain add cf-bucket-media --domain media.<your domain> --zone-id <zone id>'
    );
    expect(output).toContain('Then set publicUrl in minimalgallery.config.ts');
    expect(output).toContain('Create an R2 API token');
    expect(output).toContain('gh repo create --private --source . --push');
    expect(output).toContain('Workers and Pages, Create, Import a repository');
  });

  it('writes the bucket answers to the config and the token only to .env', async () => {
    const fake = fakeRunner({
      create: { code: 1, stdout: '', stderr: R2_DISABLED },
    });
    const key = 'f'.repeat(32);
    const secret = 'e'.repeat(64);
    await create(
      [
        'cf-flags',
        '--yes',
        '--bucket',
        'holiday-photos',
        '--media-domain',
        'https://Media.Example.org/',
        '--account-id',
        ACCOUNT,
        '--access-key-id',
        key,
        '--secret-access-key',
        secret,
        '--publish',
        'deploy',
      ],
      fake.run
    );
    const dir = join(tmp, 'cf-flags');

    // The account id was given: no whoami. Deploying: no git.
    expect(fake.wrangler()).toEqual([
      ['--yes', 'wrangler', 'r2', 'bucket', 'create', 'holiday-photos'],
    ]);
    expect(fake.calls.some((c) => c.command === 'git')).toBe(false);

    const config = await loadGalleryConfig(dir);
    expect(config.storage).toEqual({
      mode: 's3',
      bucket: 'holiday-photos',
      endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
      region: 'auto',
      publicUrl: 'https://media.example.org',
    });
    for (const file of [
      'minimalgallery.config.ts',
      '.env.example',
      'package.json',
      'wrangler.jsonc',
    ]) {
      const content = await read(dir, file);
      expect(content, file).not.toContain(key);
      expect(content, file).not.toContain(secret);
    }
    const env = await read(dir, '.env');
    expect(env).toContain(`MG_S3_ACCESS_KEY_ID=${key}\n`);
    expect(env).toContain(`MG_S3_SECRET_ACCESS_KEY=${secret}\n`);
    expect((await stat(join(dir, '.env'))).mode & 0o077).toBe(0);
    expect(output).not.toContain(secret);

    const pkg = JSON.parse(await read(dir, 'package.json'));
    expect(pkg.minimalgallery.publish).toBe('deploy');
    expect(await read(dir, 'wrangler.jsonc')).toContain(
      'npm run publish\n// processes new photos'
    );

    expect(output).toContain(
      'R2 is not enabled on this Cloudflare account yet'
    );
    expect(output).toContain('Enable R2 in the Cloudflare dashboard');
    expect(output).toContain('npx wrangler r2 bucket create holiday-photos');
    expect(output).toContain(
      'npx wrangler r2 bucket domain add holiday-photos --domain media.example.org --zone-id <zone id>'
    );
    expect(output).not.toContain('Create an R2 API token');
    expect(output).not.toContain('gh repo create');
  });

  it('leaves placeholders and the steps when wrangler is not logged in', async () => {
    const fake = fakeRunner({ whoami: ok(WHOAMI_LOGGED_OUT) });
    await create(
      [
        'cf-logged-out',
        '--yes',
        '--storage',
        'bucket',
        '--publish',
        'git',
        '--no-git',
      ],
      fake.run
    );
    const dir = join(tmp, 'cf-logged-out');

    // No bucket creation without a login.
    expect(fake.wrangler()).toEqual([['--yes', 'wrangler', 'whoami']]);
    const config = await loadGalleryConfig(dir);
    expect(config.storage).toMatchObject({
      mode: 's3',
      endpoint: 'https://your-account-id.r2.cloudflarestorage.com',
      publicUrl: 'https://media.example.com',
    });
    const source = await read(dir, 'minimalgallery.config.ts');
    expect(source).toContain('// Placeholder: replace your-account-id');
    // Publish, sync and doctor --bucket refuse to run on these.
    expect(configPlaceholders(config).map((p) => p.key)).toEqual([
      'storage.endpoint',
      'storage.publicUrl',
    ]);

    expect(output).toContain('Not logged in to Cloudflare yet');
    expect(output).toContain('npx wrangler login');
    expect(output).toContain(
      'npx wrangler r2 bucket create cf-logged-out-media'
    );
    expect(output).toContain('copy your account id from npx wrangler whoami');
    expect(output).toContain('git init -b main');
  });

  it('takes the first of several accounts with --yes', async () => {
    const fake = fakeRunner({ whoami: ok(WHOAMI_TWO) });
    await create(['cf-accounts', '--yes', '--storage', 'bucket'], fake.run);
    const config = await loadGalleryConfig(join(tmp, 'cf-accounts'));
    expect(config.storage).toMatchObject({
      endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
    });
    expect(fake.calls.find((c) => c.args.includes('r2'))?.env).toEqual({
      CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    });
    expect(output).toContain('Using the Cloudflare account “Studio”');
  });

  it('publishes repo mode from git with --publish git, without wrangler', async () => {
    const fake = fakeRunner({ git: freshGit });
    await create(
      ['cf-repo', '--yes', '--storage', 'repo', '--publish', 'git'],
      fake.run
    );
    expect(fake.wrangler()).toEqual([]);
    const config = await loadGalleryConfig(join(tmp, 'cf-repo'));
    expect(config.storage).toEqual({ mode: 'repo' });
    expect(await read(join(tmp, 'cf-repo'), '.env.example')).toContain(
      '# MG_S3_ACCESS_KEY_ID='
    );
    expect(output).not.toContain('bucket');
    expect(output).toContain('gh repo create --private --source . --push');
  });

  it('makes a real first commit without the secrets', async () => {
    // git runs for real in the temporary folder, with no user or system config.
    const git: Runner = (command, args, options) =>
      spawnRunner(command, args, {
        ...options,
        env: {
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      });
    const fake = fakeRunner({ git });
    await create(
      [
        'cf-git',
        '--yes',
        '--publish',
        'git',
        '--access-key-id',
        'f'.repeat(32),
        '--secret-access-key',
        'e'.repeat(64),
      ],
      fake.run
    );
    const dir = join(tmp, 'cf-git');
    expect(output).toContain('Created the git repository, with a first commit');
    const files = (await git('git', ['ls-files'], { cwd: dir })).stdout.split(
      '\n'
    );
    expect(files).toContain('minimalgallery.config.ts');
    expect(files).toContain('.env.example');
    expect(files).toContain('.gitignore');
    expect(files).not.toContain('.env');
    const branch = await git('git', ['branch', '--show-current'], { cwd: dir });
    expect(branch.stdout.trim()).toBe('main');
  });

  it('keeps GitHub Pages, Netlify and local builds in repo mode, with no bucket questions', async () => {
    const fake = fakeRunner({ git: freshGit });
    await create(['gh-cli', '--yes', '--host', 'github'], fake.run);
    expect(fake.wrangler()).toEqual([]);
    expect(output).toContain('gh repo create --public --source . --push');
    expect(output).toContain('set the source to GitHub Actions');
    expect(output).not.toContain('bucket');
    const ghPkg = JSON.parse(await read(join(tmp, 'gh-cli'), 'package.json'));
    expect(ghPkg.minimalgallery.publish).toBe('git');

    const base = {
      name: 'Photos',
      author: '',
      storage: 'repo' as const,
      packageManager: 'pnpm' as const,
    };
    const opts = { version: '1.2.3', platform: 'linux' as const };

    const gh = await scaffold(
      join(tmp, 'gh'),
      { ...base, host: 'github', publish: 'git' },
      { ...opts, packageManager: 'pnpm@10.20.0' }
    );
    expect(gh).toContain('.github/workflows/deploy.yml');
    expect(gh).not.toContain(LAUNCHER_NAME);
    expect(gh).not.toContain('.env');
    const workflow = await read(
      join(tmp, 'gh'),
      '.github/workflows/deploy.yml'
    );
    // pushes to either first branch name deploy
    expect(workflow).toContain('branches: [main, master]');
    expect(workflow).toContain('uses: actions/configure-pages@v6');
    expect(workflow).toContain('uses: withastro/action@v6');
    expect(workflow).toContain('uses: actions/deploy-pages@v5');
    // site and base come from the Pages settings, not from astro.config.mjs
    expect(workflow).toContain(
      `build-cmd: pnpm run build --site "\${{ steps.pages.outputs.origin }}" --base "\${{ steps.pages.outputs.base_path || '/' }}"`
    );
    expect(workflow).toContain('url: ${{ steps.deployment.outputs.page_url }}');
    expect(
      JSON.parse(await read(join(tmp, 'gh'), 'package.json')).packageManager
    ).toBe('pnpm@10.20.0');
    const ghAstro = await read(join(tmp, 'gh'), 'astro.config.mjs');
    expect(ghAstro).toContain(
      'the workflow (.github/workflows/deploy.yml) passes'
    );
    expect(ghAstro).toContain("  // base: '/<repo>',");
    const ghConfig = await loadGalleryConfig(join(tmp, 'gh'));
    expect(ghConfig.author).toBeUndefined();
    expect(ghConfig.storage).toEqual({ mode: 'repo' });

    const nl = await scaffold(
      join(tmp, 'nl'),
      { ...base, host: 'netlify', publish: 'git' },
      opts
    );
    expect(nl).toContain('netlify.toml');
    const toml = await read(join(tmp, 'nl'), 'netlify.toml');
    expect(toml).toContain('for = "/_mg/*"');
    expect(toml).toContain('for = "/_astro/*"');
    const nlPkg = JSON.parse(await read(join(tmp, 'nl'), 'package.json'));
    expect(nlPkg.dependencies.minimalgallery).toBe('^1.2.3');
    expect(nlPkg.minimalgallery.publish).toBe('git');
    expect(nlPkg.devDependencies).toBeUndefined();
    expect((await loadGalleryConfig(join(tmp, 'nl'))).storage.mode).toBe(
      'repo'
    );

    const local = await scaffold(
      join(tmp, 'local'),
      { ...base, host: 'local', publish: 'build' },
      opts
    );
    expect(
      local.filter((f) => /wrangler|netlify|workflows|_headers/.test(f))
    ).toEqual([]);
    expect((await loadGalleryConfig(join(tmp, 'local'))).storage.mode).toBe(
      'repo'
    );
    for (const name of ['gh', 'nl', 'local'])
      expect(await read(join(tmp, name), '.env.example')).not.toContain(
        'not available yet'
      );
  });

  it('lists every file it writes', async () => {
    const dir = join(tmp, 'listed');
    const written = await scaffold(
      dir,
      {
        name: 'Photos',
        author: '',
        host: 'cloudflare',
        storage: 'repo',
        publish: 'deploy',
        packageManager: 'npm',
      },
      { version: '1.2.3', platform: 'linux' }
    );
    const onDisk = (
      await readdir(dir, { recursive: true, withFileTypes: true })
    )
      .filter((e) => e.isFile())
      .map((e) =>
        relative(dir, join(e.parentPath, e.name)).split(sep).join('/')
      )
      .filter((f) => !f.endsWith('.DS_Store'))
      .sort();
    expect(written).toEqual(onDisk);
    expect(written).toContain('src/pages/404.astro');
    expect(written).toContain('.gitignore');
  });

  it('pins pnpm and Yarn in package.json, from the user agent or --version', async () => {
    const fromAgent = fakeRunner();
    await main(['pm-agent', '--yes', '--no-install', '--host', 'github'], {
      run: fromAgent.run,
      interactive: false,
      cwd: tmp,
      platform: 'linux',
      env: { npm_config_user_agent: 'pnpm/10.21.1 npm/? node/v24.11.0' },
    });
    expect(fromAgent.calls.some((c) => c.args[0] === '--version')).toBe(false);
    const agentPkg = JSON.parse(
      await read(join(tmp, 'pm-agent'), 'package.json')
    );
    expect(agentPkg.packageManager).toBe('pnpm@10.21.1');
    expect(
      await read(join(tmp, 'pm-agent'), '.github/workflows/deploy.yml')
    ).toContain('build-cmd: pnpm run build --site');

    const asked = fakeRunner();
    await create(
      ['pm-asked', '--yes', '--no-install', '--pm', 'yarn'],
      asked.run
    );
    expect(asked.calls.find((c) => c.args[0] === '--version')?.command).toBe(
      'yarn'
    );
    const askedPkg = JSON.parse(
      await read(join(tmp, 'pm-asked'), 'package.json')
    );
    expect(askedPkg.packageManager).toBe('yarn@10.20.0');

    // not installed: no field, and the scaffold goes on
    const missing: Runner = async (command, args) =>
      args[0] === '--version'
        ? { code: 127, stdout: '', stderr: `spawn ${command} ENOENT` }
        : ok();
    await create(
      ['pm-missing', '--yes', '--no-install', '--pm', 'pnpm'],
      missing
    );
    const missingPkg = JSON.parse(
      await read(join(tmp, 'pm-missing'), 'package.json')
    );
    expect(missingPkg.packageManager).toBeUndefined();
  });

  it('refuses flags that do not fit together', async () => {
    const fake = fakeRunner();
    await expect(
      create(
        ['x1', '--yes', '--host', 'github', '--storage', 'bucket'],
        fake.run
      )
    ).rejects.toThrow(Exit);
    await expect(
      create(['x2', '--yes', '--access-key-id', 'abc'], fake.run)
    ).rejects.toThrow('together');
    await expect(
      create(['x3', '--yes', '--bucket', 'Not_A_Bucket'], fake.run)
    ).rejects.toThrow('R2 bucket names');
    await expect(
      create(['x4', '--yes', '--media-domain', 'not a domain'], fake.run)
    ).rejects.toThrow('--media-domain');
    await expect(
      create(
        ['x5', '--yes', '--host', 'netlify', '--publish', 'deploy'],
        fake.run
      )
    ).rejects.toThrow('--host cloudflare');
    expect(fake.calls).toEqual([]);
    expect(await exists(join(tmp, 'x1'))).toBe(false);
  });

  it('writes the feed, sitemap, robots and random routes, built only once the site is known', async () => {
    const fake = fakeRunner();
    await create(['routes', '--yes'], fake.run);
    const pages = join(tmp, 'routes', 'src', 'pages');
    const written = await readdir(pages);
    // Every route of the demo, but its v0.8 redirect map.
    const demo = (
      await readdir(
        fileURLToPath(
          new URL('../../../examples/demo/src/pages', import.meta.url)
        )
      )
    ).filter((f) => f !== 'legacy-ids.json.ts');
    expect(written.sort()).toEqual(demo.sort());
    for (const f of ['feed.xml.ts', 'feed.json.ts', 'sitemap.xml.ts']) {
      const route = await read(pages, f);
      expect(route).toContain('siteOf(site)');
      expect(route).toContain('new Response(null, { status: 404 })');
    }
    expect(await read(pages, 'random.astro')).toContain('RandomPage');
    expect(await read(pages, 'robots.txt.ts')).toContain('robotsTxt({ site })');
  });

  it('makes valid Cloudflare Worker and R2 bucket names', () => {
    expect(projectName('My Gallery')).toBe('my-gallery');
    expect(projectName('Café ’25')).toBe('cafe-25');
    expect(projectName('***')).toBe('my-gallery');
    expect(bucketName('my-gallery')).toBe('my-gallery-media');
    const long = bucketName(projectName('a'.repeat(80)));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith('-media')).toBe(true);
  });
});
