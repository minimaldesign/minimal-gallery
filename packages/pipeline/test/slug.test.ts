import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  albumIdFromPath,
  photoIdFor,
  slugify,
  titleFromFile,
  titleFromFolder,
} from '../src/slug.ts';
import { normalizeCamera } from '../src/normalize.ts';
import { walkPhotos } from '../src/walk.ts';
import { tempGallery, write, writeJpeg } from './helpers.ts';

describe('slugs and ids', () => {
  it('lowercases and collapses runs of non-alphanumerics', () => {
    expect(slugify('A Quiet Evening')).toBe('a_quiet_evening');
    expect(slugify('Get your strap on')).toBe('get_your_strap_on');
    expect(slugify('Café -- au lait!')).toBe('cafe_au_lait_');
  });

  it('builds photo ids like v0.8', () => {
    expect(photoIdFor('colors', 'Red_Door.jpg')).toBe('colors__red_door');
    expect(photoIdFor('light', 'Central Park.jpg')).toBe('light__central_park');
  });

  it('keeps / in nested album ids and joins with _ inside photo ids', () => {
    const album = albumIdFromPath('Japan 2025/Kyoto');
    expect(album).toBe('japan_2025/kyoto');
    expect(photoIdFor(album, 'DSC_0412.JPG')).toBe(
      'japan_2025_kyoto__dsc_0412'
    );
  });

  it('titles from file names', () => {
    expect(titleFromFile('Heavy_Clouds_but-No_Rain.jpg')).toBe(
      'Heavy Clouds but No Rain'
    );
    expect(titleFromFile('lazy-sunday-afternoons.jpg')).toBe(
      'Lazy sunday afternoons'
    );
  });

  it('titles albums from folder names, one segment at a time', () => {
    expect(titleFromFolder('light')).toBe('Light');
    expect(titleFromFolder('heavy_clouds-but-no_rain')).toBe(
      'Heavy clouds but no rain'
    );
    expect(titleFromFolder('japan-2025/kyoto_east')).toBe('Kyoto east');
    expect(titleFromFolder('été')).toBe('Été');
  });

  it('normalises camera names', () => {
    expect(normalizeCamera('NIKON CORPORATION', 'NIKON D70')).toBe('Nikon D70');
    expect(normalizeCamera('NIKON', 'Nikon  D200')).toBe('Nikon D200');
    expect(normalizeCamera('Canon', 'Canon PowerShot S95')).toBe(
      'Canon PowerShot S95'
    );
    expect(normalizeCamera('FUJIFILM', 'X-T5')).toBe('Fujifilm X-T5');
  });

  it('errors on id collisions', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/trip/Red Door.jpg'));
    await writeJpeg(join(dir, 'photos/trip/red-door.jpeg'));
    await expect(walkPhotos(dir)).rejects.toThrow(/trip__red_door/);
  });

  it('skips dotfiles and sidecars', async () => {
    const dir = await tempGallery();
    await writeJpeg(join(dir, 'photos/a/one.jpg'));
    await write(join(dir, 'photos/a/one.jpg.xmp'), '<x/>');
    await write(join(dir, 'photos/a/one.xmp'), '<x/>');
    await write(join(dir, 'photos/a/.DS_Store'), '');
    await writeJpeg(join(dir, 'photos/a/b/two.jpg'));
    const { albums, photos } = await walkPhotos(dir);
    expect(albums.map((a) => a.id)).toEqual(['a', 'a/b']);
    expect(photos.map((p) => p.id)).toEqual(['a_b__two', 'a__one']);
  });
});
