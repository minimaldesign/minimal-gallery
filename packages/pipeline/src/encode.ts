import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { oklch } from 'culori';
import {
  variantsFor,
  type ColorSpace,
  type LadderConfig,
  type VariantFormat,
} from './ladder.ts';

export interface EncodeTask {
  bytes: Uint8Array;
  ladder: LadderConfig;
  /** Output colour space of the variants. Default sRGB. */
  color?: ColorSpace;
}

export interface EncodedVariant {
  name: string;
  width: number;
  height: number;
  format: VariantFormat;
  data: Uint8Array;
}

export interface EncodeResult {
  /** Display dimensions of the source, after orientation. */
  width: number;
  height: number;
  /** ICC profile description of the source, or null when untagged. */
  iccIn: string | null;
  variants: EncodedVariant[];
  color: { l: number; c: number; h: number };
  thumbhash: string;
  placeholder: string;
  seconds: number;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Read the description tag (`desc`) of an ICC profile. Enough to report
 * “Adobe RGB (1998)” or “sRGB IEC61966-2.1” without another dependency.
 */
export function iccDescription(icc: Uint8Array | undefined): string | null {
  if (!icc || icc.length < 132) return null;
  const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const count = view.getUint32(128);
  for (let i = 0; i < count; i++) {
    const base = 132 + i * 12;
    if (base + 12 > icc.length) break;
    const sig = String.fromCharCode(...icc.subarray(base, base + 4));
    if (sig !== 'desc') continue;
    const off = view.getUint32(base + 4);
    const type = String.fromCharCode(...icc.subarray(off, off + 4));
    if (type === 'desc') {
      const len = view.getUint32(off + 8);
      return new TextDecoder('latin1')
        .decode(icc.subarray(off + 12, off + 12 + len))
        .replace(/\0+$/, '');
    }
    if (type === 'mluc') {
      const recLen = view.getUint32(off + 20);
      const strOff = view.getUint32(off + 24);
      const bytes = icc.subarray(off + strOff, off + strOff + recLen);
      let s = '';
      for (let j = 0; j + 1 < bytes.length; j += 2)
        s += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
      return s.replace(/\0+$/, '');
    }
  }
  return null;
}

/**
 * Encode one photo. Runs in a piscina worker.
 *
 * The source is decoded once, oriented, converted to sRGB using its embedded
 * ICC profile (untagged sources are treated as sRGB), and resized to the
 * largest variant needed. Every variant and the analysis derive from that
 * 8-bit sRGB master. Outputs carry only the sRGB ICC profile: no EXIF, no GPS.
 *
 * With `color: 'p3'`, a second master is made in Display P3 and the variants
 * are encoded from it with the P3 profile attached, so wide-gamut sources
 * (Adobe RGB, P3) keep colours outside sRGB. The analysis stays sRGB.
 */
export default async function encode(task: EncodeTask): Promise<EncodeResult> {
  const started = performance.now();
  const { bytes, ladder, color = 'srgb' } = task;
  const meta = await sharp(bytes).metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;
  const longEdge = Math.max(width, height);
  const specs = variantsFor(ladder, longEdge);
  const masterEdge = Math.min(
    longEdge,
    Math.max(...specs.map((s) => s.longEdge))
  );

  const base = () =>
    sharp(bytes, { failOn: 'none' }).autoOrient().resize({
      width: masterEdge,
      height: masterEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
  const master = await base()
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = {
    width: master.info.width,
    height: master.info.height,
    channels: 3 as const,
  };
  const fromMaster = () => sharp(master.data, { raw });
  // P3: an uncompressed TIFF tagged Display P3. Converting it to P3 again
  // below is an identity transform, so the pixels are not touched twice.
  const p3Master =
    color === 'p3'
      ? await base()
          .removeAlpha()
          .withIccProfile('p3')
          .tiff({ compression: 'none' })
          .toBuffer()
      : undefined;
  const variantSource = () => (p3Master ? sharp(p3Master) : fromMaster());

  const variants: EncodedVariant[] = [];
  for (const spec of specs) {
    const edge = Math.min(spec.longEdge, longEdge);
    let p = variantSource()
      .resize({
        width: edge,
        height: edge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .withIccProfile(color);
    const chroma = spec.chroma ?? '4:2:0';
    p =
      spec.format === 'avif'
        ? p.avif({
            quality: spec.quality,
            effort: ladder.avifEffort,
            chromaSubsampling: chroma,
          })
        : spec.format === 'webp'
          ? p.webp({
              quality: spec.quality,
              effort: 4,
              smartSubsample: chroma === '4:4:4',
            })
          : p.jpeg({
              quality: spec.quality,
              progressive: true,
              mozjpeg: true,
              chromaSubsampling: chroma,
            });
    const { data, info } = await p.toBuffer({ resolveWithObject: true });
    variants.push({
      name: spec.name,
      width: info.width,
      height: info.height,
      format: spec.format,
      data,
    });
  }

  // Analysis on a 256 px version.
  const small = await fromMaster()
    .resize({ width: 256, height: 256, fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stats = await sharp(small.data, {
    raw: { width: small.info.width, height: small.info.height, channels: 3 },
  }).stats();
  const d = stats.dominant;
  const ok = oklch({ mode: 'rgb', r: d.r / 255, g: d.g / 255, b: d.b / 255 });

  const tiny = await fromMaster()
    .resize({ width: 100, height: 100, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const thumbhash = Buffer.from(
    rgbaToThumbHash(tiny.info.width, tiny.info.height, tiny.data)
  ).toString('base64');

  const ph = await fromMaster()
    .resize({ width: ladder.placeholderWidth })
    .jpeg({ quality: 70, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return {
    width,
    height,
    iccIn: iccDescription(meta.icc),
    variants,
    color: { l: round(ok.l), c: round(ok.c), h: round(ok.h ?? 0, 2) },
    thumbhash,
    placeholder: `data:image/jpeg;base64,${ph.toString('base64')}`,
    seconds: (performance.now() - started) / 1000,
  };
}
