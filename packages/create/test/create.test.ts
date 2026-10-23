import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createJiti } from 'jiti';
import { GalleryConfigSchema } from '@minimalgallery/pipeline/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAUNCHER_NAME, scaffold } from '../src/scaffold.ts';
import { projectName } from '../src/templates.ts';

const run = promisify(execFile);
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

/** Import the generated config the way the pipeline does, and parse it with the schema. */
async function parseConfig(dir: string) {
  await mkdir(join(dir, 'node_modules', '@minimalgallery'), {
    recursive: true,
  });
  await symlink(
    pipelineDir,
    join(dir, 'node_modules', '@minimalgallery', 'pipeline')
  );
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
    interopDefault: true,
  });
  const mod = await jiti.import(join(dir, 'minimalgallery.config.ts'), {
    default: true,
  });
  return GalleryConfigSchema.parse(mod);
}

describe('create-minimalgallery', () => {
  it('scaffolds a Cloudflare gallery with --yes --no-install', async () => {
    const dir = join(tmp, 'My Gallery');
    const { stdout } = await run(
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
      ],
      { env: { ...process.env, npm_config_user_agent: 'npm/11.0.0 node/v24' } }
    );
    expect(stdout).toContain('npm install');
    expect(stdout).toContain('npm run admin');

    for (const file of [
      'package.json',
      'astro.config.mjs',
      'minimalgallery.config.ts',
      'src/content.config.ts',
      'src/pages/index.astro',
      'src/pages/[...album]/[photo].astro',
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

    if (process.platform === 'darwin') {
      const mode = (await stat(join(dir, LAUNCHER_NAME))).mode;
      expect(mode & 0o111).toBeTruthy();
    }

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
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
    const wrangler = await readFile(join(dir, 'wrangler.jsonc'), 'utf8');
    expect(wrangler).toContain('"name": "my-gallery"');
    expect(wrangler).toContain(
      '"assets": { "directory": "./dist", "not_found_handling": "404-page" }'
    );
    expect(wrangler).not.toContain('pages_build_output_dir');
    const headers = await readFile(join(dir, 'public/_headers'), 'utf8');
    for (const path of ['/_mg/*', '/_astro/*'])
      expect(headers).toContain(
        `${path}\n  Cache-Control: public, max-age=31536000, immutable`
      );

    const config = await parseConfig(dir);
    expect(config.name).toBe('Yann’s photos');
    expect(config.author).toBe("O'Neil");
    expect(config.storage.mode).toBe('repo');
  });

  it('refuses a folder that is not empty', async () => {
    await expect(
      run(process.execPath, [
        entry,
        join(tmp, 'My Gallery'),
        '--yes',
        '--no-install',
      ])
    ).rejects.toMatchObject({ code: 1 });
  });

  it('writes the host files for GitHub Pages, Netlify and local builds', async () => {
    const base = {
      name: 'Photos',
      author: '',
      size: 'large' as const,
      packageManager: 'pnpm' as const,
    };
    const opts = { version: '1.2.3', platform: 'linux' as const };

    const gh = await scaffold(
      join(tmp, 'gh'),
      { ...base, host: 'github' },
      opts
    );
    expect(gh).toContain('.github/workflows/deploy.yml');
    expect(gh).not.toContain(LAUNCHER_NAME);
    expect(
      await readFile(join(tmp, 'gh', '.github/workflows/deploy.yml'), 'utf8')
    ).toContain('pnpm install --frozen-lockfile');
    const ghConfig = await parseConfig(join(tmp, 'gh'));
    expect(ghConfig.author).toBeUndefined();

    const nl = await scaffold(
      join(tmp, 'nl'),
      { ...base, host: 'netlify' },
      opts
    );
    expect(nl).toContain('netlify.toml');
    const toml = await readFile(join(tmp, 'nl', 'netlify.toml'), 'utf8');
    expect(toml).toContain('for = "/_mg/*"');
    expect(toml).toContain('for = "/_astro/*"');
    const nlPkg = JSON.parse(
      await readFile(join(tmp, 'nl', 'package.json'), 'utf8')
    );
    expect(nlPkg.dependencies.minimalgallery).toBe('^1.2.3');
    expect(nlPkg.minimalgallery.publish).toBe('git');
    expect(nlPkg.devDependencies).toBeUndefined();

    const local = await scaffold(
      join(tmp, 'local'),
      { ...base, host: 'local' },
      opts
    );
    expect(
      local.filter((f) => /wrangler|netlify|workflows|_headers/.test(f))
    ).toEqual([]);
  });

  it('makes valid Cloudflare Worker names', () => {
    expect(projectName('My Gallery')).toBe('my-gallery');
    expect(projectName('Café ’25')).toBe('cafe-25');
    expect(projectName('***')).toBe('my-gallery');
  });
});
