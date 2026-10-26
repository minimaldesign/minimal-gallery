/**
 * HEIC/HEIF decoding. Sharp’s prebuilt libheif reads HEIC headers but has no
 * HEVC decoder, so the pixels are decoded here first and handed to Sharp as
 * an uncompressed TIFF that carries the photo’s ICC profile (Display P3 on an
 * iPhone). The rest of the encode treats it like any other TIFF.
 *
 * Two decoders, whose results differ by less than one level in 255 on
 * average (chroma upsampling differs at sharp edges):
 * - `sips`, macOS’s own ImageIO, on macOS: about 0.2 s for 12 or 24 MP.
 * - libheif with libde265 compiled to WebAssembly (`libheif-js`) everywhere
 *   else, and on macOS when `sips` fails: about 0.5 s for 12 MP, 0.9 s for
 *   24 MP. It returns 8 bits per channel.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

export type HeicDecoder = 'sips' | 'libheif';

/** `sips` on macOS, libheif elsewhere. */
export const defaultHeicDecoder = (): HeicDecoder =>
  process.platform === 'darwin' ? 'sips' : 'libheif';

/**
 * Decode an HEIC/HEIF file to TIFF bytes that Sharp can read. The TIFF keeps
 * the ICC profile and the orientation: `sips` writes the EXIF orientation as a
 * TIFF tag, libheif applies the HEIF rotation and mirroring to the pixels.
 */
export async function decodeHeic(
  bytes: Uint8Array,
  decoder: HeicDecoder = defaultHeicDecoder()
): Promise<Uint8Array> {
  if (decoder === 'sips') {
    try {
      return await decodeWithSips(bytes);
    } catch {
      // No `sips`, or ImageIO refused the file: libheif may still read it.
    }
  }
  return decodeWithLibheif(bytes);
}

const run = promisify(execFile);

async function decodeWithSips(bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'mg-heic-'));
  try {
    const input = join(dir, 'in.heic');
    const output = join(dir, 'out.tiff');
    await writeFile(input, bytes);
    await run('sips', ['-s', 'format', 'tiff', input, '--out', output]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The part of the libheif-js API used here. */
interface Libheif {
  heif_error_code: { heif_error_Ok: unknown };
  heif_colorspace: { heif_colorspace_RGB: unknown };
  heif_chroma: { heif_chroma_interleaved_RGB: unknown };
  heif_channel: { heif_channel_interleaved: unknown };
  heif_context_alloc(): unknown;
  heif_context_free(ctx: unknown): void;
  heif_context_read_from_memory(
    ctx: unknown,
    bytes: Uint8Array
  ): { code: unknown; message: string };
  heif_js_context_get_primary_image_handle(ctx: unknown): any;
  heif_image_handle_release(handle: unknown): void;
  heif_js_decode_image2(handle: unknown, space: unknown, chroma: unknown): any;
  heif_image_release(image: unknown): void;
}

interface LibheifChannel {
  id: unknown;
  width: number;
  height: number;
  stride: number;
  bits_per_pixel: number;
  data: Uint8Array;
}

let factory: (() => Libheif) | undefined;

async function decodeWithLibheif(bytes: Uint8Array): Promise<Uint8Array> {
  const icc = await headerIcc(bytes);
  // The bundle carries its WebAssembly inline and instantiates synchronously,
  // in a few milliseconds. A new instance per photo lets its memory, which
  // grows to hold the decoded pixels and never shrinks, be collected after.
  factory ??= createRequire(import.meta.url)(
    'libheif-js/libheif-wasm/libheif-bundle.js'
  );
  const heif = factory!();
  const ctx = heif.heif_context_alloc();
  let handle: any;
  let image: any;
  try {
    const err = heif.heif_context_read_from_memory(ctx, bytes);
    if (err.code !== heif.heif_error_code.heif_error_Ok)
      throw new Error(`HEIC: ${err.message}`);
    handle = heif.heif_js_context_get_primary_image_handle(ctx);
    if (!handle || handle.code) throw new Error('HEIC: no primary image');
    image = heif.heif_js_decode_image2(
      handle,
      heif.heif_colorspace.heif_colorspace_RGB,
      heif.heif_chroma.heif_chroma_interleaved_RGB
    );
    if (!image || image.code)
      throw new Error(`HEIC: ${image?.message ?? 'cannot decode'}`);
    const ch: LibheifChannel | undefined = image.channels.find(
      (c: LibheifChannel) => c.id === heif.heif_channel.heif_channel_interleaved
    );
    if (!ch || ch.bits_per_pixel !== 8)
      throw new Error('HEIC: unexpected pixel layout');
    const { width, height, stride, data } = ch;
    return rgbTiff(width, height, icc, (dst) => {
      const row = width * 3;
      if (stride === row) dst.set(data.subarray(0, row * height));
      else
        for (let y = 0; y < height; y++)
          dst.set(data.subarray(y * stride, y * stride + row), y * row);
    });
  } finally {
    if (image?.image) heif.heif_image_release(image.image);
    if (handle) heif.heif_image_handle_release(handle);
    heif.heif_context_free(ctx);
  }
}

/** The ICC profile, read by Sharp from the HEIF header (no decode needed). */
async function headerIcc(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    return (await sharp(bytes).metadata()).icc;
  } catch {
    return undefined;
  }
}

/**
 * A baseline TIFF: one uncompressed strip of 8-bit interleaved RGB, with the
 * ICC profile (tag 34675) when there is one. `fill` writes the pixels.
 */
export function rgbTiff(
  width: number,
  height: number,
  icc: Uint8Array | undefined,
  fill: (pixels: Uint8Array) => void
): Uint8Array {
  const SHORT = 3;
  const LONG = 4;
  const UNDEFINED = 7;
  const pixelBytes = width * height * 3;
  const count = icc ? 11 : 10;
  const bitsOffset = 8 + 2 + count * 12 + 4;
  const iccOffset = bitsOffset + 6;
  const pixelOffset = iccOffset + (icc ? icc.length + (icc.length % 2) : 0);
  const tags: Array<[number, number, number, number]> = [
    [256, LONG, 1, width],
    [257, LONG, 1, height],
    [258, SHORT, 3, bitsOffset],
    [259, SHORT, 1, 1], // no compression
    [262, SHORT, 1, 2], // RGB
    [273, LONG, 1, pixelOffset],
    [277, SHORT, 1, 3],
    [278, LONG, 1, height],
    [279, LONG, 1, pixelBytes],
    [284, SHORT, 1, 1], // interleaved
  ];
  if (icc) tags.push([34675, UNDEFINED, icc.length, iccOffset]);

  const out = Buffer.alloc(pixelOffset + pixelBytes);
  out.write('II', 0, 'latin1');
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  out.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, type, n, value], i) => {
    const at = 10 + i * 12;
    out.writeUInt16LE(tag, at);
    out.writeUInt16LE(type, at + 2);
    out.writeUInt32LE(n, at + 4);
    if (type === SHORT && n === 1) out.writeUInt16LE(value, at + 8);
    else out.writeUInt32LE(value, at + 8);
  });
  for (let i = 0; i < 3; i++) out.writeUInt16LE(8, bitsOffset + i * 2);
  if (icc) out.set(icc, iccOffset);
  fill(out.subarray(pixelOffset));
  return out;
}
