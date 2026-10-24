import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitOriginalsSetting,
  gitChanges,
  publishCommand,
  selectChanges,
} from '../src/commands/publish.ts';
import { syncCommand } from '../src/commands/sync.ts';

const TEMPLATE_GITIGNORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../create/template/_gitignore'
);

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'mg-publish-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)('git', args, { cwd });
  return stdout;
}

async function file(path: string, content: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const jpeg = (r: number, g: number, b: number) =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r, g, b } },
  })
    .jpeg()
    .toBuffer();

/**
 * A gallery repository pushed to a bare `origin`, as the hosting guides set
 * it up: package.json and .gitignore committed by hand, photos not yet.
 */
async function galleryRepo(
  minimalgallery: object = { publish: 'git' },
  gitignore?: string
) {
  const remote = join(tmp, 'remote.git');
  const dir = join(tmp, 'gallery');
  await mkdir(dir);
  await git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', remote);
  await file(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'g', minimalgallery })
  );
  await file(
    join(dir, '.gitignore'),
    gitignore ?? (await readFile(TEMPLATE_GITIGNORE, 'utf8'))
  );
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', 'Gallery');
  await git(dir, 'push', '-q', '-u', 'origin', 'main');
  await file(join(dir, 'photos/trip/a.jpg'), await jpeg(200, 40, 40));
  await file(join(dir, 'photos/trip/a.md'), '---\ntitle: First\n---\n');
  await file(join(dir, 'photos/trip/b.jpg'), await jpeg(40, 200, 40));
  await file(join(dir, 'photos/trip/_album.md'), '---\ntitle: Trip\n---\n');
  return { dir, remote };
}

const isOriginal = (f: string) => f.startsWith('photos/') && f.endsWith('.jpg');

const tree = async (dir: string) =>
  (await git(dir, 'ls-tree', '-r', '--name-only', 'HEAD')).split('\n');

/** What clack and the commands print, while `fn` runs. */
async function output(fn: () => Promise<unknown>): Promise<string> {
  let text = '';
  const keep = (chunk: unknown) => {
    text += String(chunk);
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(keep);
  vi.spyOn(console, 'log').mockImplementation((...a) => keep(a.join(' ')));
  try {
    await fn();
  } finally {
    vi.restoreAllMocks();
  }
  return text;
}

describe('publish --git', () => {
  it('commits the sidecars, manifests and resized photos, not the originals', async () => {
    const { dir } = await galleryRepo();
    await output(() => publishCommand(['--git', '--yes'], dir));
    const files = await tree(dir);
    expect(files).toEqual(
      expect.arrayContaining([
        'photos/trip/a.md',
        'photos/trip/_album.md',
        '.minimalgallery/manifest/_albums.json',
        '.minimalgallery/manifest/trip__a.json',
        '.minimalgallery/manifest/trip__b.json',
      ])
    );
    expect(files.some((f) => f.startsWith('public/_mg/trip__b/'))).toBe(true);
    expect(files.filter((f) => isOriginal(f) || f.includes('cache'))).toEqual(
      []
    );
    expect(await git(dir, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('leaves a clone without the originals unchanged, through publish and sync --prune', async () => {
    const { dir, remote } = await galleryRepo();
    await output(() => publishCommand(['--git', '--yes'], dir));
    const copy = join(tmp, 'copy');
    await git(tmp, 'clone', '-q', remote, copy);
    const head = await git(copy, 'rev-parse', 'HEAD');

    const said = await output(() => publishCommand(['--git', '--yes'], copy));
    expect(said).toMatch(/Nothing to publish/);
    expect(said).toMatch(/The originals of 2 photo\(s\) are not on this/);
    await output(() => syncCommand(['--prune'], copy));
    expect(await git(copy, 'status', '--porcelain')).toBe('');
    expect(await git(copy, 'rev-parse', 'HEAD')).toBe(head);
  }, 30_000);

  it('keeps committing edits and deletions of originals tracked from before, and adds none', async () => {
    const { dir } = await galleryRepo(
      { publish: 'git' },
      'node_modules\n.minimalgallery/cache\n'
    );
    await git(dir, 'add', 'photos');
    await git(dir, 'commit', '-q', '-m', 'Originals, as before');
    await rm(join(dir, 'photos/trip/b.jpg'));
    await file(join(dir, 'photos/trip/c.jpg'), await jpeg(40, 40, 200));

    const said = await output(() => publishCommand(['--git', '--yes'], dir));
    expect(said).toMatch(
      /2 original\(s\) under photos\/ are in git from before/
    );
    expect(said).toMatch(/git rm -r --cached --quiet photos/);
    const files = await tree(dir);
    expect(files).toContain('photos/trip/a.jpg');
    expect(files).not.toContain('photos/trip/b.jpg');
    expect(files).not.toContain('photos/trip/c.jpg');
    expect(files).toContain('.minimalgallery/manifest/trip__c.json');
    expect(await git(dir, 'status', '--porcelain')).toBe(
      '?? photos/trip/c.jpg\n'
    );
  }, 30_000);

  it('commits the originals with commitOriginals, and says when .gitignore keeps them out', async () => {
    const { dir } = await galleryRepo({
      publish: 'git',
      commitOriginals: true,
    });
    const said = await output(() => publishCommand(['--git', '--yes'], dir));
    expect(said).toMatch(/"commitOriginals" is on, but \.gitignore keeps 2/);
    expect((await tree(dir)).filter(isOriginal)).toEqual([]);

    await file(
      join(dir, '.gitignore'),
      'node_modules\n.minimalgallery/cache\n'
    );
    await output(() => publishCommand(['--git', '--yes'], dir));
    expect((await tree(dir)).filter(isOriginal)).toEqual([
      'photos/trip/a.jpg',
      'photos/trip/b.jpg',
    ]);
  }, 30_000);
});

describe('publish --git helpers', () => {
  it('reads commitOriginals from package.json', async () => {
    const pkg = (minimalgallery: object) =>
      writeFile(join(tmp, 'package.json'), JSON.stringify({ minimalgallery }));
    expect(await commitOriginalsSetting(tmp)).toBe(false);
    await pkg({ commitOriginals: true });
    expect(await commitOriginalsSetting(tmp)).toBe(true);
    await pkg({ commitOriginals: 'yes' });
    await expect(commitOriginalsSetting(tmp)).rejects.toThrow(/true or false/);
  });

  it('takes sidecars and tracked files from photos/, and never the cache', () => {
    const changes = gitChanges(
      [
        '?? photos/a/new.jpg',
        '?? photos/a/new.md',
        '?? photos/a/NEW.XMP',
        ' M photos/a/old.jpg',
        'D  photos/a/gone.json',
        'R  photos/a/moved.md',
        'photos/a/before.md',
        '?? .minimalgallery/cache/seen.json',
        '?? .minimalgallery/manifest/a__new.json',
        '',
      ].join('\0')
    );
    expect(changes[5]).toEqual({
      path: 'photos/a/moved.md',
      status: 'R ',
      from: 'photos/a/before.md',
    });
    const off = selectChanges(changes, false);
    expect(off.leftOut).toEqual(['photos/a/new.jpg']);
    expect(off.stage).toEqual([
      'photos/a/new.md',
      'photos/a/NEW.XMP',
      'photos/a/old.jpg',
      '.minimalgallery/manifest/a__new.json',
    ]);
    expect(off.commit).toEqual([
      'photos/a/new.md',
      'photos/a/NEW.XMP',
      'photos/a/old.jpg',
      'photos/a/gone.json',
      'photos/a/moved.md',
      'photos/a/before.md',
      '.minimalgallery/manifest/a__new.json',
    ]);
    const on = selectChanges(changes, true);
    expect(on.leftOut).toEqual([]);
    expect(on.stage[0]).toBe('photos/a/new.jpg');
  });

  it('commits through paths with pathspec characters in them', async () => {
    const { dir } = await galleryRepo();
    await file(join(dir, 'photos/[x]/*.md'), 'odd\n');
    await output(() => publishCommand(['--git', '--yes'], dir));
    expect(await tree(dir)).toContain('photos/[x]/*.md');
  }, 30_000);
});
