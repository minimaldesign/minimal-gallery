/**
 * Input formats that need care: HEIC, which is read but loses to a photo of
 * the same name, and RAW, which cannot be decoded. The messages tell the
 * person what happens or what to do instead.
 */

/** HEIC/HEIF (iPhone photos). Decoded by `heic.ts` before Sharp. */
export const HEIC_EXTENSIONS = new Set(['.heic', '.heif', '.hif']);

/** Camera RAW and DNG files. Sharp’s prebuilt binaries cannot develop them. */
export const RAW_EXTENSIONS = new Set([
  '.3fr',
  '.arw',
  '.cr2',
  '.cr3',
  '.crw',
  '.dcr',
  '.dng',
  '.erf',
  '.iiq',
  '.k25',
  '.kdc',
  '.mef',
  '.mos',
  '.mrw',
  '.nef',
  '.nrw',
  '.orf',
  '.pef',
  '.raf',
  '.raw',
  '.rw2',
  '.rwl',
  '.sr2',
  '.srf',
  '.srw',
  '.x3f',
]);

export type UnsupportedKind = 'heic' | 'raw';

export const UNSUPPORTED_MESSAGES: Record<UnsupportedKind, string> = {
  heic: 'HEIC file ignored: a JPEG or other photo with the same name is next to it, and that one is used.',
  raw: 'RAW files are not supported. Export a JPEG from Lightroom, Capture One or your RAW editor and put it next to the RAW file (the RAW file is then ignored).',
};

/** `raw` for a RAW extension. HEIC is read, so it is not one of these. */
export function unsupportedKindOfExtension(
  ext: string
): UnsupportedKind | undefined {
  return RAW_EXTENSIONS.has(ext.toLowerCase()) ? 'raw' : undefined;
}

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
]);

/**
 * True when the bytes are an HEIF/HEIC file, whatever the extension (some
 * phones and transfer tools save HEIC with a `.jpg` name), so it is decoded
 * as HEIC. AVIF also uses the HEIF container, with the `avif` brand, and is
 * not matched: Sharp decodes AVIF itself.
 */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = String.fromCharCode(...bytes.subarray(4, 8));
  if (tag !== 'ftyp') return false;
  const major = String.fromCharCode(...bytes.subarray(8, 12));
  if (major === 'avif' || major === 'avis') return false;
  if (HEIC_BRANDS.has(major)) {
    // `mif1` is shared with AVIF; look for an AVIF compatible brand.
    const boxSize = Math.min(
      bytes.length,
      (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
    );
    for (let i = 16; i + 4 <= boxSize; i += 4) {
      const b = String.fromCharCode(...bytes.subarray(i, i + 4));
      if (b === 'avif' || b === 'avis') return false;
    }
    return true;
  }
  return false;
}

/**
 * True when the bytes start with an ISO BMFF `ftyp` box (HEIC, AVIF) and no
 * top-level `meta` box follows, as in a truncated file. exifr walks the same
 * boxes looking for `meta` and never returns on such a file.
 */
export function lacksMetaBox(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (kind === 'meta') return false;
    let size = view.getUint32(offset);
    if (size === 1) {
      if (offset + 16 > bytes.length) return true;
      size = Number(view.getBigUint64(offset + 8));
    }
    if (size < 8) return true;
    offset += size;
  }
  return true;
}

/** An input the pipeline cannot read, with the fix in the message. */
export class UnsupportedInputError extends Error {
  readonly kind: UnsupportedKind;
  constructor(path: string, kind: UnsupportedKind) {
    super(`${path}: ${UNSUPPORTED_MESSAGES[kind]}`);
    this.kind = kind;
    this.name = 'UnsupportedInputError';
  }
}
