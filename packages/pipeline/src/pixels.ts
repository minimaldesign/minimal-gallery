/**
 * A hash of a photo’s image data without its metadata, so that writing a
 * title or a caption into the file does not count as new pixels and the
 * derivatives are kept.
 */
import { hashBytes, hashString } from './hash.ts';

/** JPEG segments that hold only metadata: APP1 (EXIF, XMP), APP13 (IPTC), COM. */
const JPEG_METADATA = new Set([0xe1, 0xed, 0xfe]);

/** PNG chunks that hold only metadata: text, EXIF and the modification time. */
const PNG_METADATA = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The bytes of a JPEG without its metadata segments, or undefined when the
 * file does not parse as a JPEG. Segments are walked up to the start of the
 * scan; everything from there on is image data.
 */
function jpegImageData(bytes: Uint8Array): Uint8Array[] | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda) {
      parts.push(bytes.subarray(i));
      return parts;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) return undefined;
    if (!JPEG_METADATA.has(marker)) parts.push(bytes.subarray(i, end));
    i = end;
  }
  return undefined;
}

/** The chunks of a PNG without its metadata chunks, or undefined when it does not parse. */
function pngImageData(bytes: Uint8Array): Uint8Array[] | undefined {
  if (!PNG_SIGNATURE.every((b, n) => bytes[n] === b)) return undefined;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length =
      ((bytes[i] << 24) |
        (bytes[i + 1] << 16) |
        (bytes[i + 2] << 8) |
        bytes[i + 3]) >>>
      0;
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    const end = i + 12 + length;
    if (end > bytes.length) return undefined;
    if (!PNG_METADATA.has(type)) parts.push(bytes.subarray(i, end));
    if (type === 'IEND') return parts;
    i = end;
  }
  return undefined;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/**
 * Hash of the image data of a JPEG or PNG, with the EXIF orientation, which
 * lives in the metadata but turns the pixels. Other formats, and files that
 * do not parse, hash whole: an edit to their metadata encodes them again.
 */
export async function imageDataHash(
  bytes: Uint8Array,
  orientation: unknown
): Promise<string> {
  const parts = jpegImageData(bytes) ?? pngImageData(bytes);
  if (!parts) return hashBytes(bytes);
  return hashString(
    `${await hashBytes(concat(parts))}\n${String(orientation ?? '')}`
  );
}
