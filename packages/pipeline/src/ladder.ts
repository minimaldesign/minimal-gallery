import { hashString, stableStringify } from './hash.ts';

export type VariantFormat = 'avif' | 'jpeg' | 'webp';
export type ColorSpace = 'srgb' | 'p3';

/**
 * Bump when the encoder’s output changes for the same ladder (a new resize
 * kernel, a different analysis). Part of the ladder hash, so a bump
 * re-encodes every photo. Metadata-only changes bump PIPELINE_VERSION instead.
 */
export const ENCODER_VERSION = '2';

export interface VariantSpec {
  name: string;
  /** Target long edge in pixels. */
  longEdge: number;
  format: VariantFormat;
  /** Emit even when the source is smaller than `longEdge` (at source size). */
  always?: boolean;
  quality: number;
  /** Chroma subsampling for AVIF and JPEG, default 4:2:0. Lossy WebP is always 4:2:0. */
  chroma?: '4:2:0' | '4:4:4';
}

export interface LadderConfig {
  variants: VariantSpec[];
  avifEffort: number;
  placeholderWidth: number;
}

export const defaultLadder: LadderConfig = {
  variants: [
    {
      name: 'grid',
      longEdge: 640,
      format: 'avif',
      always: true,
      quality: 55,
      chroma: '4:2:0',
    },
    {
      name: 'w1280',
      longEdge: 1280,
      format: 'avif',
      quality: 55,
      chroma: '4:2:0',
    },
    {
      name: 'w2048',
      longEdge: 2048,
      format: 'avif',
      quality: 55,
      chroma: '4:2:0',
    },
    {
      name: 'w3200',
      longEdge: 3200,
      format: 'avif',
      quality: 60,
      chroma: '4:4:4',
    },
    {
      name: 'jpeg1600',
      longEdge: 1600,
      format: 'jpeg',
      always: true,
      quality: 80,
    },
  ],
  avifEffort: 3,
  placeholderWidth: 16,
};

/**
 * Hash of everything that shapes the derivatives: the ladder, the output
 * colour space and ENCODER_VERSION. A change re-encodes every photo.
 */
export function ladderHash(
  ladder: LadderConfig,
  color: ColorSpace = 'srgb'
): Promise<string> {
  const variants = ladder.variants.map((v) => ({
    name: v.name,
    longEdge: v.longEdge,
    format: v.format,
    quality: v.quality,
    chroma: v.chroma ?? '4:2:0',
    always: v.always ?? false,
  }));
  return hashString(
    stableStringify({
      variants,
      avifEffort: ladder.avifEffort,
      placeholderWidth: ladder.placeholderWidth,
      color,
      encoder: ENCODER_VERSION,
    })
  );
}

/** Variants to emit for a source of the given long edge: never upscale. */
export function variantsFor(
  ladder: LadderConfig,
  sourceLongEdge: number
): VariantSpec[] {
  return ladder.variants.filter(
    (v) => v.always || v.longEdge <= sourceLongEdge
  );
}
