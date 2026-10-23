import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@minimalgallery/pipeline/config';
import { galleryConfig } from '../../../create/src/templates.ts';
import {
  REPO_DIR,
  startServer,
  tempGallery,
  type TestServer,
} from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('settings', () => {
  it('edits the demo config in place, keeping its comments', async () => {
    const dir = await tempGallery();
    const file = join(dir, 'minimalgallery.config.ts');
    await copyFile(
      join(REPO_DIR, 'examples/demo/minimalgallery.config.ts'),
      file
    );
    server = await startServer({ galleryDir: dir });
    const events = await server.events();

    const before = await server.call('GET', '/settings');
    expect(before.body).toMatchObject({
      name: 'minimal gallery',
      author: null,
      site: null,
      albumsSort: 'date',
      defaults: { fit: 'fill', size: 2, backdrop: 'neutral' },
      about: '',
      customCss: '',
    });

    const put = await server.call('PUT', '/settings', {
      name: 'Yann’s “photos”',
      site: 'https://photos.example.com',
      description: null,
      albumsSort: 'name',
      defaults: { size: 3, backdrop: 'photo' },
      about: 'I take *pictures*.',
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      name: 'Yann’s “photos”',
      site: 'https://photos.example.com',
      description: null,
      albumsSort: 'name',
      defaults: { fit: 'fill', size: 3, backdrop: 'photo' },
      about: 'I take *pictures*.\n',
    });
    const text = await readFile(file, 'utf8');
    expect(text).toContain(
      "import { defineConfig } from '@minimalgallery/pipeline/config';"
    );
    expect(text).toContain(
      '// The viewer as a first-time visitor sees it; visitors can switch each'
    );
    expect(text).toContain("name: 'Yann’s “photos”'");
    expect(text).not.toContain('description');
    expect(text).toMatch(/strip: false/);
    const config = await loadConfig(dir);
    expect(config).toMatchObject({
      name: 'Yann’s “photos”',
      site: 'https://photos.example.com',
      albums: { sort: 'name' },
      defaults: { size: 3, backdrop: 'photo', crop: 'square' },
    });
    expect(await readFile(join(dir, 'about.md'), 'utf8')).toBe(
      'I take *pictures*.\n'
    );
    const settings = await events.waitFor((e) => e.event === 'settings');
    expect(settings.data.name).toBe('Yann’s “photos”');

    // Removing a key brings the default back.
    await server.call('PUT', '/settings', { name: null, about: null });
    expect((await loadConfig(dir)).name).toBe('Photos');
    await expect(stat(join(dir, 'about.md'))).rejects.toThrow();
  });

  it('edits a scaffolded config and refuses bad values', async () => {
    const dir = await tempGallery();
    const file = join(dir, 'minimalgallery.config.ts');
    const scaffold = galleryConfig({
      name: 'Test',
      author: 'Yann',
      host: 'cloudflare',
      size: 'small',
      packageManager: 'npm',
    });
    await writeFile(file, scaffold);
    server = await startServer({ galleryDir: dir });

    const put = await server.call('PUT', '/settings', {
      author: 'Someone else',
      defaults: { fit: 'fit' },
    });
    expect(put.status).toBe(200);
    const text = await readFile(file, 'utf8');
    for (const line of scaffold.split('\n').filter((l) => l.includes('//')))
      expect(text).toContain(line.trim());
    expect(text).toContain("storage: { mode: 'repo' }");
    expect(text).toContain("author: 'Someone else'");
    expect(await loadConfig(dir)).toMatchObject({
      name: 'Test',
      author: 'Someone else',
      storage: { mode: 'repo' },
      defaults: { fit: 'fit' },
    });

    for (const body of [
      { site: 'not a url' },
      { albumsSort: 'random' },
      { defaults: { size: 9 } },
      { defaults: { zoom: true } },
      { name: '' },
      { colour: 'red' },
    ]) {
      const r = await server.call('PUT', '/settings', body);
      expect(r.status).toBe(400);
    }
    expect(await readFile(file, 'utf8')).toBe(text);
  });

  it('creates the config when there is none, and restarts once for a new custom.css', async () => {
    const dir = await tempGallery();
    const restart = vi.fn();
    server = await startServer({ galleryDir: dir, restart });
    await server.call('PUT', '/settings', { name: 'Fresh' });
    expect((await loadConfig(dir)).name).toBe('Fresh');
    expect(restart).not.toHaveBeenCalled();

    await server.call('PUT', '/settings', {
      customCss: ':root { --mg-grid-gap: 6px; }\n',
    });
    expect(restart).toHaveBeenCalledTimes(1);
    await server.call('PUT', '/settings', {
      customCss: ':root { --mg-grid-gap: 8px; }\n',
    });
    expect(restart).toHaveBeenCalledTimes(1);
    expect(await readFile(join(dir, 'custom.css'), 'utf8')).toBe(
      ':root { --mg-grid-gap: 8px; }\n'
    );
    expect((await server.call('GET', '/settings')).body.customCss).toBe(
      ':root { --mg-grid-gap: 8px; }\n'
    );
  });
});
