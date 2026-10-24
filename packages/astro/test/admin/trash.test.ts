import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, rename } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { processGallery } from '@minimalgallery/pipeline';
import {
  settled,
  startServer,
  tempGallery,
  write,
  writeJpeg,
  type TestServer,
} from './helpers.ts';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false
  );

/** A Trash inside the gallery’s temporary folder, recording what it got. */
function fakeTrash(dir: string) {
  const given: string[] = [];
  const trash = async (paths: string[]) => {
    for (const path of paths) {
      given.push(relative(dir, path));
      const to = join(dir, '.trash', relative(dir, path));
      await mkdir(dirname(to), { recursive: true });
      await rename(path, to);
    }
  };
  return { given, trash };
}

describe('POST /photos/:id/trash', () => {
  it('moves a duplicate and its sidecars to the Trash, never the last copy', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/colors/Red.jpg'), { color: '#c33' });
    // the same pixels in another album, with a sidecar of its own
    await writeJpeg(join(dir, 'photos/japan/Copy.jpg'), { color: '#c33' });
    await write(join(dir, 'photos/japan/Copy.md'), '---\ntitle: Copy\n---\n');
    await processGallery(dir, { concurrency: 2 });
    const bin = fakeTrash(dir);
    server = await startServer({ galleryDir: dir, trash: bin.trash });
    const events = await server.events();

    const moved = await server.call('POST', '/photos/japan__copy/trash');
    expect(moved.status).toBe(200);
    expect(moved.body.trashed).toEqual([
      'photos/japan/Copy.jpg',
      'photos/japan/Copy.md',
    ]);
    expect(bin.given).toEqual(moved.body.trashed);
    // the run that follows prunes it
    await events.waitFor(
      (e) => e.event === 'photo-removed' && e.data.id === 'japan__copy'
    );
    await settled(dir);
    const { body } = await server.call('GET', '/state');
    expect(body.photos.map((p: any) => p.id)).toEqual(['colors__red']);
    expect(body.photos[0].attention).not.toContain('duplicate');

    // the copy that is left is the only one: refused, nothing moved
    const last = await server.call('POST', '/photos/colors__red/trash');
    expect(last.status).toBe(409);
    expect(last.body.error).toMatch(/only copy/);
    expect(bin.given).toHaveLength(2);
    expect(await exists(join(dir, 'photos/colors/Red.jpg'))).toBe(true);

    const unknown = await server.call('POST', '/photos/colors__blue/trash');
    expect(unknown.status).toBe(404);
  });
});
