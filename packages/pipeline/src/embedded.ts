import exifr from 'exifr';
import type { Layer } from './layers.ts';
import {
  flashFired,
  formatShutter,
  lensFromInfo,
  normalizeCamera,
  parseExifDate,
  parseIptcDate,
  parseOffset,
  parseShutter,
  toKeywords,
  toNumber,
} from './normalize.ts';
import { lacksMetaBox } from './formats.ts';
import { xmpToLayer } from './xmp.ts';

export interface EmbeddedLayers {
  xmp: Layer;
  iptc: Layer;
  exif: Layer;
  /**
   * EXIF OffsetTimeOriginal, the only UTC offset the pipeline trusts. It
   * applies to EXIF DateTimeOriginal (`exif.date`).
   */
  exifOffset?: string;
  /** EXIF CreateDate, used for the date only when nothing above sets one. */
  exifCreateDate?: string;
  /** IPTC DateCreated, often date-only, used only before falling back to mtime. */
  iptcDate?: string;
}

type Tags = Record<string, any>;

/**
 * Read embedded EXIF and IPTC with exifr. Embedded XMP is read separately from
 * the raw packet, because exifr merges the XMP `exif:` namespace into its EXIF
 * output and the two then cannot be told apart.
 */
export async function readEmbedded(bytes: Uint8Array): Promise<EmbeddedLayers> {
  // A truncated HEIC or AVIF would hang exifr; its decode reports the error.
  if (lacksMetaBox(bytes)) return { xmp: {}, iptc: {}, exif: {} };
  const raw: Tags =
    (await exifr
      .parse(bytes, {
        tiff: true,
        exif: true,
        gps: true,
        iptc: true,
        xmp: false,
        icc: false,
        ifd1: false,
        interop: false,
        makerNote: false,
        userComment: false,
        mergeOutput: false,
        translateValues: true,
        reviveValues: false,
        sanitize: true,
      })
      .catch(() => undefined)) ?? {};
  const ifd0: Tags = raw.ifd0 ?? {};
  const exif: Tags = raw.exif ?? {};
  const gps: Tags = raw.gps ?? {};
  const iptc: Tags = raw.iptc ?? {};

  const exifLayer: Layer = {};
  const camera = normalizeCamera(ifd0.Make, ifd0.Model);
  if (camera) exifLayer.camera = camera;
  const lens =
    [exif.LensMake, exif.LensModel]
      .filter((s) => typeof s === 'string' && s.trim())
      .join(' ')
      .trim() || lensFromInfo(exif.LensInfo);
  if (lens) exifLayer.lens = lens;
  const date = parseExifDate(exif.DateTimeOriginal);
  if (date) exifLayer.date = date;
  exifLayer.exposure = {
    shutter: formatShutter(exif.ExposureTime),
    shutterSeconds: parseShutter(exif.ExposureTime),
    aperture: toNumber(exif.FNumber),
    focal: toNumber(exif.FocalLength),
    focal35: toNumber(exif.FocalLengthIn35mmFormat),
    iso: toNumber(
      exif.ISO ?? exif.ISOSpeedRatings ?? exif.PhotographicSensitivity
    ),
    ev: toNumber(exif.ExposureCompensation),
    metering:
      typeof exif.MeteringMode === 'string' ? exif.MeteringMode : undefined,
    flash: flashFired(exif.Flash),
  };
  if (typeof ifd0.Artist === 'string' && ifd0.Artist.trim())
    exifLayer.author = ifd0.Artist.trim();
  if (typeof ifd0.Copyright === 'string' && ifd0.Copyright.trim())
    exifLayer.copyright = ifd0.Copyright.trim();
  const lat = toNumber(gps.latitude);
  const lon = toNumber(gps.longitude);
  if (lat !== undefined && lon !== undefined) {
    const alt = toNumber(gps.GPSAltitude);
    exifLayer.gps = {
      lat,
      lon,
      ...(alt !== undefined
        ? { alt: gps.GPSAltitudeRef === 1 ? -alt : alt }
        : {}),
    };
  }

  const iptcLayer: Layer = {};
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  if (str(iptc.ObjectName)) iptcLayer.title = str(iptc.ObjectName);
  if (str(iptc.Caption)) iptcLayer.caption = str(iptc.Caption);
  if (iptc.Keywords) {
    const k = toKeywords(iptc.Keywords);
    if (k.length) iptcLayer.keywords = k;
  }
  if (str(iptc.Byline)) iptcLayer.author = str(iptc.Byline);
  if (str(iptc.CopyrightNotice))
    iptcLayer.copyright = str(iptc.CopyrightNotice);
  const place = {
    city: str(iptc.City),
    state: str(iptc.State),
    country: str(iptc.Country),
    location: str(iptc.Sublocation),
  };
  if (Object.values(place).some(Boolean)) iptcLayer.place = place;

  const xmpString = await readXmpPacket(bytes);
  return {
    exif: exifLayer,
    iptc: iptcLayer,
    xmp: xmpString ? xmpToLayer(xmpString) : {},
    exifOffset: date ? parseOffset(exif.OffsetTimeOriginal) : undefined,
    exifCreateDate: parseExifDate(exif.CreateDate),
    iptcDate: parseIptcDate(iptc.DateCreated, iptc.TimeCreated),
  };
}

/** The raw XMP packet from a JPEG APP1 segment, or undefined. */
async function readXmpPacket(bytes: Uint8Array): Promise<string | undefined> {
  const out = await exifr
    .parse(bytes, {
      tiff: false,
      exif: false,
      gps: false,
      iptc: false,
      icc: false,
      xmp: { parse: false } as any,
      mergeOutput: false,
    })
    .catch(() => undefined);
  const x = out?.xmp;
  return typeof x === 'string' ? x : undefined;
}
