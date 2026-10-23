import type { z } from 'zod';
import type { Exposure, Gps, Place } from './schema.ts';

/**
 * One source of metadata (a sidecar, the album map, XMP, IPTC, EXIF, the file
 * name). Fields that the source does not set are left undefined.
 */
export interface Layer {
  title?: string;
  caption?: string;
  /** Wall-clock time, no offset. */
  date?: string;
  keywords?: string[];
  /** 0 means unrated and is stored as null. */
  rating?: number;
  copyright?: string;
  author?: string;
  hidden?: boolean;
  camera?: string;
  lens?: string;
  place?: Partial<Record<keyof Place, string | undefined>>;
  gps?: z.infer<typeof Gps>;
  exposure?: Partial<z.infer<typeof Exposure>>;
}

export type LayerName =
  'sidecar' | 'album' | 'xmp-sidecar' | 'xmp' | 'iptc' | 'exif' | 'filename';
