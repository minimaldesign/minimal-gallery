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

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** An XMP packet with a title, a caption and a capture date, as ExifTool writes them. */
export function xmp({
  title,
  caption,
  date,
}: {
  title?: string;
  caption?: string;
  date?: string;
}): string {
  const alt = (tag: string, v: string) =>
    `<${tag}><rdf:Alt><rdf:li xml:lang="x-default">${escape(v)}</rdf:li></rdf:Alt></${tag}>`;
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/">
   ${title ? alt('dc:title', title) : ''}
   ${caption ? alt('dc:description', caption) : ''}
   ${date ? `<exif:DateTimeOriginal>${date}</exif:DateTimeOriginal>` : ''}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
}

/** A JPEG with an XMP packet put in an APP1 segment after its start marker. */
export function withXmp(jpeg: Uint8Array, packet: string): Uint8Array {
  const payload = Buffer.concat([
    Buffer.from('http://ns.adobe.com/xap/1.0/\0'),
    Buffer.from(packet),
  ]);
  const header = Buffer.from([
    0xff,
    0xe1,
    (payload.length + 2) >> 8,
    (payload.length + 2) & 0xff,
  ]);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    header,
    payload,
    jpeg.subarray(2),
  ]);
}
