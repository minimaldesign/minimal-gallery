import { describe, expect, it } from 'vitest';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { iccDescription } from '../src/encode.ts';
import { hashBytes } from '../src/hash.ts';
import { decodeHeic } from '../src/heic.ts';
import { processGallery } from '../src/process.ts';
import { tempGallery } from './helpers.ts';

// 240 × 159, Display P3, made with `sips -s format heic` from a demo JPEG
// (Nikon D70, 2005:02:27 18:16:10), with a GPS position added by ExifTool.
// HEVC codes 240 × 160; a clean aperture box crops it to 159 rows.
const FIXTURE = new URL('./fixtures/ronin.heic', import.meta.url);

const pixels = async (tiff: Uint8Array) =>
  sharp(tiff).autoOrient().toColourspace('srgb').removeAlpha().raw().toBuffer();

describe('HEIC', () => {
  it('decodes with libheif to a TIFF that keeps the profile', async () => {
    const tiff = await decodeHeic(await readFile(FIXTURE), 'libheif');
    const m = await sharp(tiff).metadata();
    expect(m).toMatchObject({ format: 'tiff', width: 240, height: 159 });
    expect(m.channels).toBe(3);
    expect(iccDescription(m.icc)).toBe('Display P3');
  });

  it.skipIf(process.platform !== 'darwin')(
    'gives the same pixels with sips and libheif',
    async () => {
      const bytes = await readFile(FIXTURE);
      const a = await pixels(await decodeHeic(bytes, 'sips'));
      const b = await pixels(await decodeHeic(bytes, 'libheif'));
      expect(a.length).toBe(b.length);
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      expect(sum / a.length).toBeLessThan(1.5);
    }
  );

  it('processes an HEIC photo like a JPEG, under any extension', async () => {
    const dir = await tempGallery();
    await mkdir(join(dir, 'photos/kyoto'), { recursive: true });
    await copyFile(FIXTURE, join(dir, 'photos/kyoto/IMG_0001.HEIC'));
    // Some transfer tools save HEIC with a `.jpg` name.
    await copyFile(FIXTURE, join(dir, 'photos/kyoto/renamed.jpg'));
    const s = await processGallery(dir, { concurrency: 2 });
    expect(s.errors).toEqual([]);
    expect(s.encoded).toBe(2);

    const m = JSON.parse(
      await readFile(
        join(dir, '.minimalgallery/manifest/kyoto__img_0001.json'),
        'utf8'
      )
    );
    expect(m).toMatchObject({
      file: 'IMG_0001.HEIC',
      width: 240,
      height: 159,
      date: '2005-02-27T18:16:10',
      camera: 'Nikon D70',
      original: { width: 240, height: 159, icc: 'Display P3' },
    });
    expect(m.gps.lat).toBeCloseTo(35.0116, 3);
    expect(m.gps.lon).toBeCloseTo(135.7681, 3);
    // The source hash is the hash of the HEIC file, not of the decoded pixels.
    expect(m.sourceHash).toBe(await hashBytes(await readFile(FIXTURE)));
    expect(m.variants.length).toBeGreaterThan(0);
    const grid = await readFile(join(dir, 'public', m.variants[0].url));
    const v = await sharp(grid).metadata();
    expect(v.format).toBe('heif'); // AVIF
    expect(v.width).toBe(240);
  });
});
