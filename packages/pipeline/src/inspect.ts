/**
 * What the admin’s photo inspector shows: the metadata a photo has without
 * its own sidecar (`<name>.md` or `<name>.json`), field by field, and what
 * those sidecars set now. Nothing is written and nothing is encoded.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { readEmbedded } from './embedded.ts';
import type { Layer, LayerName } from './layers.ts';
import { mergeLayers, type MergedMetadata } from './merge.ts';
import { dateToLocal, parseUserDate } from './normalize.ts';
import type { PhotoOverrides } from './schema.ts';
import { overridesToLayer, readAlbumFile } from './sidecars.ts';
import { fileSlug, stripExtension, titleFromFile } from './slug.ts';
import { xmpToLayer } from './xmp.ts';

export { PHOTO_EXTENSIONS } from './walk.ts';
export { parseUserDate } from './normalize.ts';

/** Where an extracted value came from: a layer below the sidecar, or the file’s mtime. */
export type ExtractedSource = Exclude<LayerName, 'sidecar'> | 'mtime';

/** The fields `from` reports. `place` and `exposure` report per sub-field (`place.city`). */
export type InspectedField =
  | 'title'
  | 'caption'
  | 'date'
  | 'keywords'
  | 'copyright'
  | 'author'
  | 'hidden'
  | 'camera'
  | 'lens'
  | 'gps'
  | `place.${'city' | 'state' | 'country' | 'location'}`
  | `exposure.${string}`;

export interface InspectedPhoto {
  /** The merged metadata of every layer below the photo’s own sidecar. */
  extracted: MergedMetadata & {
    from: Partial<Record<InspectedField, ExtractedSource>>;
  };
  /** What `<name>.md` sets now: its frontmatter as written, and its body as `caption`. */
  overrides: Record<string, unknown>;
  /** `<name>.md` relative to the gallery directory, or null when there is none. */
  overridesFile: string | null;
  /** What `<name>.json` sets, or null when there is none. */
  jsonSidecar: Record<string, unknown> | null;
}

const isSet = (v: unknown) =>
  v !== undefined &&
  v !== null &&
  !(typeof v === 'string' && v.trim() === '') &&
  !(Array.isArray(v) && v.length === 0);

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return undefined;
    throw e;
  }
}

/** YAML reads `2005-02-27` as a Date; show it as the wall-clock string the pipeline keeps. */
function plainValues(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data))
    out[k] = v instanceof Date ? (parseUserDate(v) ?? null) : v;
  return out;
}

/**
 * Read `<name>.md` as the pipeline reads it (gray-matter): the frontmatter
 * keys as written, plus the trimmed body as `caption` when there is one.
 * Undefined when the file does not exist.
 */
export async function readPhotoOverrides(
  absNoExt: string
): Promise<Record<string, unknown> | undefined> {
  const md = await readText(`${absNoExt}.md`);
  if (md === undefined) return undefined;
  const fm = matter(md);
  const out = plainValues(fm.data);
  const body = fm.content.trim();
  if (body) out.caption = body;
  return out;
}

/**
 * Inspect one photo. `source` is its path relative to `photos/`, as in the
 * manifest (`colors/Red_door.jpg`).
 */
export async function inspectPhoto(
  galleryDir: string,
  source: string
): Promise<InspectedPhoto> {
  const parts = source.split('/');
  const file = parts.pop()!;
  const albumDir = join(galleryDir, 'photos', ...parts);
  const abs = join(albumDir, file);
  const absNoExt = join(albumDir, stripExtension(file));
  const relNoExt = ['photos', ...parts, stripExtension(file)].join('/');

  const [bytes, st, album, xmp, overrides, json] = await Promise.all([
    readFile(abs),
    stat(abs),
    readAlbumFile(join(albumDir, '_album.md')),
    readText(`${absNoExt}.xmp`).then(
      async (t) => t ?? (await readText(`${absNoExt}.XMP`))
    ),
    readPhotoOverrides(absNoExt),
    readText(`${absNoExt}.json`),
  ]);
  const embedded = await readEmbedded(bytes);

  const map = album?.frontmatter.photos;
  const albumEntry: PhotoOverrides | undefined = map
    ? (map[file] ?? map[stripExtension(file)] ?? map[fileSlug(file)])
    : undefined;
  const layers: Array<[Exclude<LayerName, 'sidecar'>, Layer]> = [
    [
      'album',
      albumEntry
        ? overridesToLayer(albumEntry, `${parts.join('/')}/_album.md`)
        : {},
    ],
    ['xmp-sidecar', xmp ? xmpToLayer(xmp) : {}],
    ['xmp', embedded.xmp],
    ['iptc', embedded.iptc],
    ['exif', embedded.exif],
    ['filename', { title: titleFromFile(file) }],
  ];
  const dateFallbacks: Array<['exif' | 'iptc', string | undefined]> = [
    ['exif', embedded.exifCreateDate],
    ['iptc', embedded.iptcDate],
  ];
  const merged = mergeLayers({
    layers,
    dateFallbacks,
    mtimeDate: dateToLocal(st.mtime),
    exifOffset:
      embedded.exif.date && embedded.exifOffset
        ? { date: embedded.exif.date, offset: embedded.exifOffset }
        : undefined,
  });

  const from: InspectedPhoto['extracted']['from'] = {};
  const top = [
    'title',
    'caption',
    'keywords',
    'copyright',
    'author',
    'hidden',
    'camera',
    'lens',
    'gps',
  ] as const;
  for (const key of top) {
    const hit = layers.find(([, l]) => isSet(l[key]));
    if (hit) from[key] = hit[0];
  }
  const dateHit = layers.find(([, l]) => isSet(l.date));
  from.date = dateHit
    ? dateHit[0]
    : (dateFallbacks.find(([, d]) => d)?.[0] ?? 'mtime');
  for (const group of ['place', 'exposure'] as const) {
    const keys = new Set(
      layers.flatMap(([, l]) => Object.keys((l[group] as object) ?? {}))
    );
    for (const sub of keys) {
      const hit = layers.find(([, l]) =>
        isSet((l[group] as Record<string, unknown> | undefined)?.[sub])
      );
      if (hit) from[`${group}.${sub}` as InspectedField] = hit[0];
    }
  }

  return {
    extracted: { ...merged, from },
    overrides: overrides ?? {},
    overridesFile: overrides ? `${relNoExt}.md` : null,
    jsonSidecar: json === undefined ? null : plainValues(JSON.parse(json)),
  };
}
