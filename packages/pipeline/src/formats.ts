/**
 * Input formats the pipeline cannot decode, and the messages that tell the
 * person what to do instead.
 */

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
  heic: 'HEIC is not supported. Export the photo as JPEG and put the JPEG in its place (Photos on macOS: File > Export, JPEG; on iPhone, Settings > Camera > Formats > Most Compatible shoots JPEG).',
  raw: 'RAW files are not supported. Export a JPEG from Lightroom, Capture One or your RAW editor and put it next to the RAW file (the RAW file is then ignored).',
};

export function unsupportedKindOfExtension(
  ext: string
): UnsupportedKind | undefined {
  const e = ext.toLowerCase();
  if (HEIC_EXTENSIONS.has(e)) return 'heic';
  if (RAW_EXTENSIONS.has(e)) return 'raw';
  return undefined;
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
 * phones and transfer tools save HEIC with a `.jpg` name). AVIF also uses the
 * HEIF container, with the `avif` brand, and is not matched.
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

/** An input the pipeline cannot read, with the fix in the message. */
export class UnsupportedInputError extends Error {
  readonly kind: UnsupportedKind;
  constructor(path: string, kind: UnsupportedKind) {
    super(`${path}: ${UNSUPPORTED_MESSAGES[kind]}`);
    this.kind = kind;
    this.name = 'UnsupportedInputError';
  }
}
