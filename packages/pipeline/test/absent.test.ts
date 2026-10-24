import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEEN_FILE, withAbsentAlbums } from '../src/absent.ts';
import { doctor, formatDoctorReport } from '../src/doctor.ts';
import { processGallery } from '../src/process.ts';
import { walkPhotos } from '../src/walk.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';

const MANIFESTS = '.minimalgallery/manifest';

/** A gallery with a nested album, a sidecar and an `_album.md`, processed once. */
async function gallery(): Promise<string> {
  const dir = await tempGallery();
  await writeJpeg(join(dir, 'photos/trip/b.jpg'));
  await writeJpeg(join(dir, 'photos/trip/a.jpg'), {
    color: '#3c3',
    date: '2005:02:28 10:00:00',
  });
  await write(join(dir, 'photos/trip/a.md'), '---\ntitle: First\n---\n');
  await writeJpeg(join(dir, 'photos/trip/day 2/c.jpg'), { color: '#c3c' });
  await writeJpeg(join(dir, 'photos/home/d.jpg'), { color: '#33c' });
  await write(join(dir, 'photos/home/_album.md'), '---\ntitle: Home\n---\n');
  await processGallery(dir, { concurrency: 2 });
  return dir;
}

/** Remove the empty folders under `dir`, as a git checkout has none. */
async function dropEmptyFolders(dir: string): Promise<boolean> {
  let empty = true;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && (await dropEmptyFolders(join(dir, e.name))))
      await rmdir(join(dir, e.name));
    else empty = false;
  }
  return empty;
}

/**
 * What git gives another computer with the scaffold’s .gitignore: the
 * gallery without its photo files and without the pipeline’s cache.
 */
async function clone(dir: string, { cache = false } = {}): Promise<string> {
  const to = await tempGallery();
  await cp(dir, to, {
    recursive: true,
    filter: (src) =>
      !src.endsWith('.jpg') &&
      (cache || !src.includes('.minimalgallery/cache')),
  });
  await dropEmptyFolders(join(to, 'photos'));
  return to;
}

/** Every file in a folder, by name. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of (await readdir(dir)).sort())
    out[f] = await readFile(join(dir, f), 'utf8');
  return out;
}

const ALL = ['home__d', 'trip__a', 'trip__b', 'trip_day_2__c'];

describe('photos whose originals are not here', () => {
  it('are kept by a clone, which prunes nothing and rewrites no manifest', async () => {
    const dir = await gallery();
    const before = await snapshot(join(dir, MANIFESTS));
    const copy = await clone(dir);
    expect(await readdir(join(copy, 'photos/trip'))).toEqual(['a.md']);

    const s = await processGallery(copy, { concurrency: 1, prune: true });
    expect(s).toMatchObject({
      photos: 0,
      albums: 3,
      absent: ALL,
      orphans: [],
      pruned: { ids: [], manifests: 0, files: 0 },
      warnings: [],
    });
    // _albums.json included: the album with no folder in the clone
    // (trip/day 2) is back, with the same children and photo order.
    expect(await snapshot(join(copy, MANIFESTS))).toEqual(before);
    expect(await readdir(join(copy, 'public/_mg'))).toEqual(
      await readdir(join(dir, 'public/_mg'))
    );
  });

  it('are pruned once deleted from the folder that had them', async () => {
    const dir = await gallery();
    const seen = () =>
      readFile(join(dir, SEEN_FILE), 'utf8').then((t) => JSON.parse(t).photos);
    expect(await seen()).toEqual(ALL);
    await rm(join(dir, 'photos/trip/b.jpg'));

    const kept = await processGallery(dir, { concurrency: 1 });
    expect(kept).toMatchObject({ orphans: ['trip__b'], absent: [] });
    const albums = JSON.parse(
      await readFile(join(dir, MANIFESTS, '_albums.json'), 'utf8')
    );
    expect(albums.albums[1]).toMatchObject({
      id: 'trip',
      photoIds: ['trip__a'],
    });

    const s = await processGallery(dir, { concurrency: 1, prune: true });
    expect(s.pruned.ids).toEqual(['trip__b']);
    expect(await readdir(join(dir, MANIFESTS))).not.toContain('trip__b.json');
    expect(await seen()).toEqual(ALL.filter((id) => id !== 'trip__b'));
  });

  it('are not taken for deleted by a copy that carries another folder’s record', async () => {
    const dir = await gallery();
    const copy = await clone(dir, { cache: true });
    expect(await readFile(join(copy, SEEN_FILE), 'utf8')).toContain('trip__b');
    const s = await processGallery(copy, { concurrency: 1, prune: true });
    expect(s).toMatchObject({ absent: ALL, pruned: { ids: [] } });
  });

  it('join the albums of photos added in the clone as they would at home', async () => {
    const dir = await gallery();
    const copy = await clone(dir);
    const extra = join(await tempGallery(), 'e.jpg');
    await writeJpeg(extra, { color: '#cc3', date: '2005:02:28 10:00:00' });
    for (const d of [dir, copy]) {
      await mkdir(join(d, 'photos/trip/day 2'), { recursive: true });
      await copyFile(extra, join(d, 'photos/trip/day 2/e.jpg'));
    }
    await processGallery(dir, { concurrency: 1 });
    const s = await processGallery(copy, { concurrency: 1 });
    expect(s).toMatchObject({ photos: 1, encoded: 1, absent: ALL });
    const albumsFile = (d: string) =>
      readFile(join(d, MANIFESTS, '_albums.json'), 'utf8');
    expect(await albumsFile(copy)).toEqual(await albumsFile(dir));
    const day2 = JSON.parse(await albumsFile(copy)).albums.find(
      (a: { id: string }) => a.id === 'trip/day_2'
    );
    // Newest first: e is dated a day after c.
    expect(day2.photoIds).toEqual(['trip_day_2__e', 'trip_day_2__c']);
  });

  it('are reported by doctor as kept, not as orphans', async () => {
    const dir = await gallery();
    const copy = await clone(dir);
    const r = await doctor(copy);
    expect(r).toMatchObject({
      photos: 4,
      albums: 3,
      orphans: [],
      absent: ALL,
      missingManifests: [],
      derivatives: (await doctor(dir)).derivatives,
    });
    expect(r.issues.join()).not.toMatch(/orphaned/);
    expect(formatDoctorReport(r)).toMatch(
      /4 in 3 album\(s\), 0 undated, 4 with no original on this computer/
    );

    await rm(join(dir, 'photos/home/d.jpg'));
    const home = await doctor(dir);
    expect(home).toMatchObject({ orphans: ['home__d'], absent: [] });
    expect(home.issues.join()).toMatch(/1 orphaned manifest/);
  });

  it('count towards the repository size with commitOriginals', async () => {
    const dir = await gallery();
    const pkg = (minimalgallery: object) =>
      writeFile(join(dir, 'package.json'), JSON.stringify({ minimalgallery }));
    await pkg({ publish: 'git' });
    const without = await doctor(dir);
    expect(without).toMatchObject({
      commitOriginals: false,
      repo: { originals: 0 },
    });
    await pkg({ publish: 'git', commitOriginals: true });
    const r = await doctor(dir);
    expect(r.commitOriginals).toBe(true);
    expect(r.repo.originals).toBeGreaterThan(0);
    expect(r.repo.bytes).toBe(without.repo.bytes + r.repo.originals);
    expect(formatDoctorReport(r)).toMatch(/of it originals/);
  });
});

describe('withAbsentAlbums', () => {
  it('orders and links albums as the walk does', async () => {
    const leaves = ['b/x', 'a b', 'a/c/d', 'a/B', 'é'];
    const dir = await tempGallery();
    for (const p of leaves) await write(join(dir, 'photos', p, 'f.md'), '');
    const walked = (await walkPhotos(dir)).albums;
    const rebuilt = withAbsentAlbums(
      walked.filter((a) => a.path === 'a b'),
      leaves,
      join(dir, 'photos')
    );
    expect(rebuilt).toEqual(walked);
    expect(withAbsentAlbums(walked, [], '/x')).toBe(walked);
  });
});
