import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_ID_PLACEHOLDER,
  PUBLIC_URL_PLACEHOLDER,
} from '@minimalgallery/pipeline/config';
import { STAGE_DIR } from '@minimalgallery/pipeline/schema';
import { startMockS3, type MockS3 } from '../../pipeline/test/mock-s3.ts';
import { adminDevArgs } from '../src/commands/admin.ts';
import { doctorCommand } from '../src/commands/doctor.ts';
import { lastUrl, publishCommand, siteUrl } from '../src/commands/publish.ts';
import { syncCommand } from '../src/commands/sync.ts';

let dir: string;
let s3: MockS3;
const saved = { ...process.env };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mg-cli-bucket-'));
  s3 = await startMockS3({ publicRead: true });
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

async function bucketGallery(credentials = true, storage: object = {}) {
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
        ...storage,
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

/** A stand-in for astro in the gallery: `astro build` writes dist/index.html. */
async function fakeAstro(root: string) {
  const bin = join(root, 'node_modules', '.bin');
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, 'astro'),
    '#!/bin/sh\nmkdir -p dist && echo built > dist/index.html\n',
    { mode: 0o755 }
  );
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
  it('uploads before the build', async () => {
    const root = await bucketGallery();
    await fakeAstro(root);
    expect(await publishCommand(['--build', '--yes'], root)).toBe(0);
    expect(s3.objects.size).toBe(4);
    expect(await stageFiles(root)).toEqual([]);
    expect(existsSync(join(root, 'dist', 'index.html'))).toBe(true);
  });

  it('builds nothing when the upload cannot happen', async () => {
    const root = await bucketGallery(false);
    await fakeAstro(root);
    await expect(publishCommand(['--build', '--yes'], root)).rejects.toThrow(
      /nothing was published/
    );
    expect(existsSync(join(root, 'dist'))).toBe(false);
  });
});

describe('scaffold stand-ins in the config', () => {
  const standInEndpoint = {
    endpoint: `https://${ACCOUNT_ID_PLACEHOLDER}.r2.cloudflarestorage.com`,
  };
  const standInPublicUrl = { publicUrl: PUBLIC_URL_PLACEHOLDER };

  it('stop publish before the pipeline, the upload, the build and the deploy', async () => {
    const root = await bucketGallery(true, standInPublicUrl);
    await expect(publishCommand(['--deploy', '--yes'], root)).rejects.toThrow(
      /storage\.publicUrl: replace https:\/\/media\.example\.com .*Custom Domains.*\nNothing was published\.$/s
    );
    expect(s3.requests).toEqual([]);
    expect(await stageFiles(root)).toEqual([]);

    await bucketGallery(true, standInEndpoint);
    await expect(publishCommand(['--build', '--yes'], root)).rejects.toThrow(
      /storage\.endpoint: replace your-account-id .*npx wrangler whoami/
    );
  });

  it('let sync encode but not upload, and fail', async () => {
    const root = await bucketGallery(true, standInPublicUrl);
    expect(await syncCommand(['--no-upload'], root)).toBe(0);
    expect(await syncCommand([], root)).toBe(1);
    await expect(syncCommand(['--prune', '--yes'], root)).rejects.toThrow(
      /storage\.publicUrl.*\nNothing was deleted from the bucket\.$/s
    );
    expect(s3.requests).toEqual([]);
    expect(await stageFiles(root)).toHaveLength(4);
  });

  it('stop doctor --bucket before the probe', async () => {
    const root = await bucketGallery(true, standInEndpoint);
    await expect(doctorCommand(['--bucket'], root)).rejects.toThrow(
      /storage\.endpoint.*\nThe bucket was not checked\.$/s
    );
    expect(s3.requests).toEqual([]);
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
