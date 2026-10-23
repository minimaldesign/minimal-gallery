import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

export async function tempGallery(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'mg-test-'));
}

/** A small JPEG with EXIF camera and date tags. */
export async function writeJpeg(
  path: string,
  {
    color = '#c33',
    date = '2005:02:27 18:16:10' as string | null,
    width = 96,
    height = 64,
    exif = {} as Record<string, string>,
  } = {}
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const buf = await sharp({
    create: { width, height, channels: 3, background: color },
  })
    .withExif({
      IFD0: { Make: 'NIKON CORPORATION', Model: 'NIKON D70' },
      IFD2: {
        ...(date ? { DateTimeOriginal: date } : {}),
        ExposureTime: '1/60',
        FNumber: '56/10',
        ...exif,
      },
    })
    .jpeg()
    .toBuffer();
  await writeFile(path, buf);
}

export async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
