/**
 * The photo inspector’s writer. Metadata edits go to `<file>.xmp` next to the
 * photo (`DSC_0412.jpg.xmp`), or into the photo file itself when the config
 * says `saveEdits: 'photo'`; ExifTool writes both. `hidden` has no standard
 * tag, so it goes to the photo’s entry in `_album.md`.
 *
 * A field saved into the photo is removed from the sidecar and from the
 * album entry, which both rank above the file: a saved value is never hidden
 * by an older copy.
 */
import { rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ExifTool, type WriteTags } from 'exiftool-vendored';
import {
  parseUserDate,
  readPhotoOverrides,
  sidecarPath,
} from '@minimalgallery/pipeline';
import { fileSlug, stripExtension } from '@minimalgallery/pipeline/slug';
import { badRequest, onlyKeys } from './http.ts';
import {
  getValue,
  readMarkdown,
  setValue,
  writeMarkdown,
} from './frontmatter.ts';

const TEXT_KEYS = ['title', 'copyright', 'author'] as const;
const PLACE_KEYS = ['city', 'state', 'country', 'location'] as const;
export const OVERRIDE_KEYS = [
  ...TEXT_KEYS,
  'caption',
  'date',
  'keywords',
  'place',
  'gps',
  'hidden',
] as const;

/** A validated patch: each key present is a value to write, or null to remove. */
export type OverridesPatch = Partial<Record<string, unknown>>;

const text = (key: string, v: unknown): string | null => {
  if (v === null) return null;
  if (typeof v !== 'string')
    throw badRequest(`${key} must be a string or null.`);
  return v.trim() ? v.trim() : null;
};

/** Check a `PUT /photos/:id/overrides` body. Throws 400 with the bad key. */
export function validateOverrides(
  body: Record<string, unknown>
): OverridesPatch {
  onlyKeys(body, OVERRIDE_KEYS);
  const out: OverridesPatch = {};
  for (const key of TEXT_KEYS) if (key in body) out[key] = text(key, body[key]);
  if ('caption' in body) {
    const v = body.caption;
    if (v !== null && typeof v !== 'string')
      throw badRequest('caption must be a string or null.');
    out.caption = v && v.trim() ? v.trim() : null;
  }
  if ('date' in body) {
    const v = text('date', body.date);
    if (
      v !== null &&
      (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(v) ||
        !parseUserDate(v))
    )
      throw badRequest(
        'date must look like 2005-02-27, 2005-02-27T18:16 or 2005-02-27T18:16:10.'
      );
    out.date = v?.replace(' ', 'T') ?? null;
  }
  if ('keywords' in body) {
    const v = body.keywords;
    if (v === null) out.keywords = null;
    else if (Array.isArray(v) && v.every((k) => typeof k === 'string')) {
      const list = [...new Set(v.map((k) => k.trim()).filter(Boolean))];
      out.keywords = list.length ? list : null;
    } else throw badRequest('keywords must be an array of strings or null.');
  }
  if ('hidden' in body) {
    const v = body.hidden;
    if (v !== null && typeof v !== 'boolean')
      throw badRequest('hidden must be true, false or null.');
    out.hidden = v;
  }
  if ('place' in body) {
    const v = body.place;
    if (v === null) out.place = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const place = v as Record<string, unknown>;
      const extra = Object.keys(place).filter(
        (k) => !(PLACE_KEYS as readonly string[]).includes(k)
      );
      if (extra.length)
        throw badRequest(`place has unknown keys: ${extra.join(', ')}.`);
      const sub: Record<string, string | null> = {};
      for (const k of PLACE_KEYS)
        if (k in place) sub[k] = text(`place.${k}`, place[k]);
      out.place = sub;
    } else throw badRequest('place must be an object or null.');
  }
  if ('gps' in body) {
    const v = body.gps;
    if (v === null) out.gps = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const { lat, lon, ...extra } = v as Record<string, unknown>;
      if (Object.keys(extra).length)
        throw badRequest('gps takes lat and lon only.');
      if (
        typeof lat !== 'number' ||
        typeof lon !== 'number' ||
        !(lat >= -90 && lat <= 90) ||
        !(lon >= -180 && lon <= 180)
      )
        throw badRequest(
          'gps needs a latitude from -90 to 90 and a longitude from -180 to 180.'
        );
      // Six decimals is about 10 cm: more than any photo needs.
      const round = (n: number) => Math.round(n * 1e6) / 1e6;
      out.gps = { lat: round(lat), lon: round(lon) };
    } else throw badRequest('gps must be { lat, lon } or null.');
  }
  return out;
}

let tool: ExifTool | undefined;

/** One ExifTool process for the admin, started on the first write. */
function exiftool(): ExifTool {
  // An idle process exits after a minute; the next write starts another.
  tool ??= new ExifTool({ maxProcs: 1, maxIdleMsPerProcess: 60_000 });
  return tool;
}

/** End the ExifTool process (the admin’s `close({ dispose: true })`, tests). */
export async function endExiftool(): Promise<void> {
  const t = tool;
  tool = undefined;
  await t?.end();
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

/** `2005-02-27T18:16:00` as ExifTool writes dates: `2005:02:27 18:16:00`. */
const exifDate = (iso: string) =>
  parseUserDate(iso)!.replace(/^(\d{4})-(\d{2})-(\d{2})T/, '$1:$2:$3 ');

const PLACE_TAGS: Record<string, string> = {
  city: 'XMP-photoshop:City',
  state: 'XMP-photoshop:State',
  country: 'XMP-photoshop:Country',
  location: 'XMP-iptcCore:Location',
};

/** The same fields as MWG tags, which ExifTool keeps in step across EXIF, IPTC and XMP. */
const PLACE_MWG: Record<string, string> = {
  city: 'MWG:City',
  state: 'MWG:State',
  country: 'MWG:Country',
  location: 'MWG:Location',
};

type Tags = Record<string, string | string[] | number | null>;

/**
 * The XMP tags of a patch, for a sidecar. A null value removes the tag.
 * Keys are the patch’s fields, so a caller can tell which tags belong to
 * which field.
 */
function xmpTags(patch: OverridesPatch): Map<string, Tags> {
  const out = new Map<string, Tags>();
  for (const [key, value] of Object.entries(patch)) {
    const v = value as any;
    if (key === 'title') out.set(key, { 'XMP-dc:Title': v });
    else if (key === 'caption') out.set(key, { 'XMP-dc:Description': v });
    else if (key === 'keywords') out.set(key, { 'XMP-dc:Subject': v });
    else if (key === 'author') out.set(key, { 'XMP-dc:Creator': v });
    else if (key === 'copyright') out.set(key, { 'XMP-dc:Rights': v });
    else if (key === 'date')
      out.set(key, { 'XMP-exif:DateTimeOriginal': v && exifDate(v) });
    else if (key === 'gps')
      out.set(key, {
        'XMP-exif:GPSLatitude': v?.lat ?? null,
        'XMP-exif:GPSLongitude': v?.lon ?? null,
      });
    else if (key === 'place') {
      const tags: Tags = {};
      const subs = v === null ? Object.keys(PLACE_TAGS) : Object.keys(v);
      for (const sub of subs) tags[PLACE_TAGS[sub]] = v?.[sub] ?? null;
      out.set(key, tags);
    }
  }
  return out;
}

/**
 * The tags of a patch for the photo file: XMP and, through MWG, the EXIF and
 * IPTC copies of the same fields, so other apps agree with the gallery. Only
 * values: a null in the patch never deletes anything from the photo.
 */
function photoTags(patch: OverridesPatch, iptcTitle: boolean): WriteTags {
  const tags: Tags = {};
  for (const [key, value] of Object.entries(patch)) {
    const v = value as any;
    if (v === null) continue;
    if (key === 'title') {
      tags['XMP-dc:Title'] = v;
      if (iptcTitle) tags['IPTC:ObjectName'] = v;
    } else if (key === 'caption') tags['MWG:Description'] = v;
    else if (key === 'keywords') tags['MWG:Keywords'] = v;
    else if (key === 'author') tags['MWG:Creator'] = v;
    else if (key === 'copyright') tags['MWG:Copyright'] = v;
    else if (key === 'date') {
      // MWG leaves an XMP exif:DateTimeOriginal as it was, and the gallery
      // reads that one first.
      tags['MWG:DateTimeOriginal'] = exifDate(v);
      tags['XMP-exif:DateTimeOriginal'] = exifDate(v);
    } else if (key === 'gps') {
      tags['EXIF:GPSLatitude'] = v.lat;
      tags['EXIF:GPSLatitudeRef'] = v.lat;
      tags['EXIF:GPSLongitude'] = v.lon;
      tags['EXIF:GPSLongitudeRef'] = v.lon;
      tags['XMP-exif:GPSLatitude'] = v.lat;
      tags['XMP-exif:GPSLongitude'] = v.lon;
    } else if (key === 'place')
      for (const [sub, s] of Object.entries(v))
        if (s != null) tags[PLACE_MWG[sub]] = s as string;
  }
  return tags as WriteTags;
}

/** Write tags to an `.xmp` sidecar, and delete the file when no XMP is left in it. */
async function writeSidecar(path: string, tags: Tags): Promise<boolean> {
  const had = await exists(path);
  const anyValue = Object.values(tags).some((v) => v !== null);
  if (!had && !anyValue) return false;
  if (Object.keys(tags).length)
    await exiftool().write(path, tags as WriteTags, {
      writeArgs: ['-overwrite_original'],
    });
  // Another app’s fields in the same file count: only an empty packet goes.
  const left = await exiftool().read(path, { readArgs: ['-XMP:all', '-G1'] });
  const keys = Object.keys(left).filter(
    (k) => k.startsWith('XMP-') && k !== 'XMP-x:XMPToolkit'
  );
  if (keys.length) return true;
  await rm(path, { force: true });
  return false;
}

/** The key of a photo’s entry in `_album.md` `photos:`, as the pipeline looks it up. */
function albumKey(photos: unknown, file: string): string {
  const map = (photos ?? {}) as Record<string, unknown>;
  return (
    [file, stripExtension(file), fileSlug(file)].find((k) => k in map) ?? file
  );
}

export interface WriteResult {
  /** `<file>.xmp` exists afterwards. */
  sidecar: boolean;
}

/**
 * Apply a patch for the photo at `abs`. With `saveEdits: 'sidecar'`, values
 * and removals go to `<file>.xmp`. With `'photo'`, values go into the photo
 * and leave the sidecar and the album entry; a removal clears only those
 * two copies.
 */
export async function writeOverrides(
  abs: string,
  patch: OverridesPatch,
  saveEdits: 'sidecar' | 'photo'
): Promise<WriteResult> {
  const { hidden, ...fields } = patch;
  const sidecar = sidecarPath(abs);
  const byField = xmpTags(fields);
  const intoPhoto = saveEdits === 'photo';

  const album = await readMarkdown(join(dirname(abs), '_album.md'));
  const key = albumKey(getValue(album.doc, ['photos']), basename(abs));
  let albumChanged = false;
  if ('hidden' in patch) {
    setValue(album.doc, ['photos', key, 'hidden'], hidden ? true : null);
    albumChanged = true;
  }

  if (intoPhoto) {
    const values = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== null)
    );
    if (Object.keys(values).length) {
      const iptcTitle =
        'title' in values &&
        'ObjectName' in
          (await exiftool().read(abs, { readArgs: ['-IPTC:ObjectName'] }));
      await exiftool().write(abs, photoTags(values, iptcTitle), {
        writeArgs: ['-overwrite_original'],
      });
    }
    // Every field in the patch leaves the copies that would hide the file’s.
    for (const field of Object.keys(fields))
      if (getValue(album.doc, ['photos', key, field]) !== undefined) {
        setValue(album.doc, ['photos', key, field], null);
        albumChanged = true;
      }
  }

  const tags: Tags = {};
  for (const t of byField.values())
    for (const [tag, v] of Object.entries(t)) tags[tag] = intoPhoto ? null : v;
  const kept =
    intoPhoto && !(await exists(sidecar))
      ? false
      : await writeSidecar(sidecar, tags);

  if (albumChanged) await writeMarkdown(album);
  return { sidecar: kept };
}

/** Photos, by path relative to the gallery, whose `<file>.xmp` sets a field the admin edits. */
export async function photosWithSidecarEdits(
  galleryDir: string,
  relativePaths: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const rel of relativePaths) {
    const fields = await readPhotoOverrides(
      join(galleryDir, ...rel.split('/'))
    );
    if (fields && Object.keys(fields).length) out.push(rel);
  }
  return out;
}

export interface EmbedSummary {
  moved: number;
  failed: Array<{ path: string; message: string }>;
}

/**
 * Move the fields of every `<file>.xmp` into its photo, as saving them with
 * `saveEdits: 'photo'` would. A sidecar that holds nothing else is deleted.
 */
export async function embedSidecarEdits(
  galleryDir: string,
  relativePaths: string[]
): Promise<EmbedSummary> {
  const summary: EmbedSummary = { moved: 0, failed: [] };
  for (const rel of await photosWithSidecarEdits(galleryDir, relativePaths)) {
    const abs = join(galleryDir, ...rel.split('/'));
    try {
      const patch = (await readPhotoOverrides(abs)) ?? {};
      await writeOverrides(abs, patch, 'photo');
      summary.moved++;
    } catch (e) {
      summary.failed.push({ path: rel, message: (e as Error).message });
    }
  }
  return summary;
}
