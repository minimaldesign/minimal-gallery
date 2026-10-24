import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STAGE_DIR } from '@minimalgallery/pipeline/schema';
import { startMockS3, type MockS3 } from '../../pipeline/test/mock-s3.ts';
import { adminDevArgs } from '../src/commands/admin.ts';
import { lastUrl, publishCommand, siteUrl } from '../src/commands/publish.ts';
import { syncCommand } from '../src/commands/sync.ts';

let dir: string;
let s3: MockS3;
const saved = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mg-cli-bucket-'));
  s3 = await startMockS3({ publicRead: true });
  // git with no global or system config, and a fixed identity.
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  });
  delete process.env.MG_S3_ACCESS_KEY_ID;
  delete process.env.MG_S3_SECRET_ACCESS_KEY;
});
afterEach(async () => {
  process.env = { ...saved };
  await s3.close();
  await rm(dir, { recursive: true, force: true });
});

const jpeg = (r: number, g: number, b: number) =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: { r, g, b } },
  })
    .jpeg()
    .toBuffer();

async function bucketGallery(credentials = true) {
  const root = join(dir, 'gallery');
  await mkdir(join(root, 'photos', 'trip'), { recursive: true });
  await writeFile(join(root, 'photos', 'trip', 'a.jpg'), await jpeg(200, 0, 0));
  await writeFile(join(root, 'photos', 'trip', 'b.jpg'), await jpeg(0, 0, 200));
  await writeFile(
    join(root, 'minimalgallery.config.mjs'),
    `export default ${JSON.stringify({
      name: 'Test',
      site: 'https://photos.example.com',
      storage: {
        mode: 's3',
        bucket: s3.bucket,
        endpoint: s3.endpoint,
        region: s3.region,
        publicUrl: s3.publicUrl,
      },
    })};\n`
  );
  await writeFile(join(root, '.gitignore'), '.env\n.minimalgallery/cache\n');
  if (credentials)
    await writeFile(
      join(root, '.env'),
      `MG_S3_ACCESS_KEY_ID=${s3.accessKeyId}\nMG_S3_SECRET_ACCESS_KEY=${s3.secretAccessKey}\n`
    );
  return root;
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function withRemote(root: string) {
  const remote = join(dir, 'remote.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'add', '.gitignore');
  git(root, 'commit', '-q', '-m', 'start');
  git(root, 'push', '-q', '-u', 'origin', 'main');
  return remote;
}

async function stageFiles(root: string): Promise<string[]> {
  try {
    return (
      await readdir(join(root, STAGE_DIR), {
        recursive: true,
        withFileTypes: true,
      })
    )
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

describe('sync in bucket mode', () => {
  it('stages, then uploads with the credentials from .env', async () => {
    const root = await bucketGallery();
    expect(await syncCommand([], root)).toBe(0);
    // Two photos, two derivatives each at this size (grid and jpeg1600).
    expect(s3.objects.size).toBe(4);
    for (const o of s3.objects.values())
      expect(o.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(await stageFiles(root)).toEqual([]);

    // Nothing new: no request writes anything.
    const before = s3.requests.length;
    expect(await syncCommand([], root)).toBe(0);
    expect(s3.requests.slice(before).filter((r) => r.method === 'PUT')).toEqual(
      []
    );
  });

  it('keeps files staged and fails without credentials', async () => {
    const root = await bucketGallery(false);
    expect(await syncCommand([], root)).toBe(1);
    expect(s3.objects.size).toBe(0);
    expect(await stageFiles(root)).toHaveLength(4);
  });

  it('prunes bucket files no photo uses, only with --prune --yes', async () => {
    const root = await bucketGallery();
    await syncCommand([], root);
    await rm(join(root, 'photos', 'trip', 'b.jpg'));
    await syncCommand([], root);
    expect(s3.objects.size).toBe(4);
    await syncCommand(['--prune', '--yes'], root);
    expect([...s3.objects.keys()].every((k) => k.startsWith('trip__a/'))).toBe(
      true
    );
    expect(s3.objects.size).toBe(2);
  });
});

describe('publish in bucket mode', () => {
  it('uploads before the commit and the push, and names the site', async () => {
    const root = await bucketGallery();
    const remote = await withRemote(root);
    await writeFile(
      join(root, 'package.json'),
      '{"minimalgallery":{"publish":"git"}}'
    );

    expect(await publishCommand(['--yes'], root)).toBe(0);
    expect(s3.objects.size).toBe(4);
    const pushed = git(remote, 'ls-tree', '-r', '--name-only', 'main');
    expect(pushed).toContain('.minimalgallery/manifest/trip__a.json');
    // The originals stay on this computer, even with no .gitignore rule.
    expect(pushed).not.toContain('photos/trip/a.jpg');
    expect(pushed).not.toContain('.env');
    expect(pushed).not.toContain('cache/media');
  });

  it('commits nothing when the upload cannot happen', async () => {
    const root = await bucketGallery(false);
    const remote = await withRemote(root);
    await expect(publishCommand(['--git', '--yes'], root)).rejects.toThrow(
      /nothing was published/
    );
    expect(git(remote, 'rev-list', '--count', 'main')).toBe('1');
    expect(git(root, 'status', '--porcelain')).not.toBe('');
  });
});

describe('publish and admin helpers', () => {
  it('finds the site address in the configs, else in the output', async () => {
    expect(await siteUrl(dir, { site: 'https://a.example' })).toBe(
      'https://a.example'
    );
    await writeFile(
      join(dir, 'astro.config.mjs'),
      "export default {\n  // site: 'https://no.example',\n  site: 'https://b.example',\n};\n"
    );
    expect(await siteUrl(dir, {})).toBe('https://b.example');
    expect(
      lastUrl(
        'Uploaded x\nDeployed minimalgallery-demo triggers\n  https://x.y.workers.dev\n  https://minimalgallery.net (custom domain)\n'
      )
    ).toBe('https://minimalgallery.net');
    expect(lastUrl('nothing here')).toBeNull();
  });

  it('opens the admin unless asked otherwise', () => {
    expect(adminDevArgs([])).toEqual(['dev', '--open', '/_mg/admin/']);
    expect(adminDevArgs(['--port', '4421'])).toEqual([
      'dev',
      '--open',
      '/_mg/admin/',
      '--port',
      '4421',
    ]);
    expect(adminDevArgs(['--open=/'])).toEqual(['dev', '--open=/']);
  });
});
