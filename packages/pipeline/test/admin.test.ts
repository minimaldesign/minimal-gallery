import { describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { adminPath } from '../src/admin.ts';
import { tempGallery, write } from './helpers.ts';

describe('admin path', () => {
  it('is /admin/ unless the gallery uses it', async () => {
    const dir = await tempGallery();
    expect(adminPath(dir)).toBe('/admin/');
    await mkdir(join(dir, 'photos', 'Administration'), { recursive: true });
    expect(adminPath(dir)).toBe('/admin/');
  });

  it('moves to /mg/admin/ for an album named admin', async () => {
    const dir = await tempGallery();
    await mkdir(join(dir, 'photos', 'Admin'), { recursive: true });
    expect(adminPath(dir)).toBe('/mg/admin/');
  });

  it('moves to /mg/admin/ for an admin page of the site', async () => {
    const dir = await tempGallery();
    const root = await tempGallery();
    await write(join(root, 'src', 'pages', 'admin.astro'), '');
    expect(adminPath(dir)).toBe('/admin/');
    expect(adminPath(dir, root)).toBe('/mg/admin/');
  });
});
