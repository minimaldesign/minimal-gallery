/**
 * What the admin’s photo inspector shows: the metadata a photo has without
 * its own sidecar (`<file>.xmp`), field by field, and what that sidecar sets
 * now. Nothing is written and nothing is encoded.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readEmbedded } from './embedded.ts';
import type { Layer, LayerName } from './layers.ts';
import { mergeLayers, type MergedMetadata } from './merge.ts';
import type { PhotoOverrides } from './schema.ts';
import { overridesToLayer, readAlbumFile, sidecarPath } from './sidecars.ts';
import { fileSlug, stripExtension, titleFromFile } from './slug.ts';
import { xmpToLayer } from './xmp.ts';

export { PHOTO_EXTENSIONS } from './walk.ts';
export { parseUserDate } from './normalize.ts';

/** Where an extracted value came from: a layer below the sidecar, or `none` for a date no layer has. */
export type ExtractedSource = Exclude<LayerName, 'sidecar'> | 'none';

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
  /**
   * What the admin manages now: the fields `<file>.xmp` sets, and `hidden`
   * from the photo’s entry in `_album.md`.
   */
  overrides: Record<string, unknown>;
  /** `<file>.xmp` relative to the gallery directory, or null when there is none. */
  overridesFile: string | null;
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

/** The fields the admin edits, as `<file>.xmp` sets them. */
const OVERRIDE_FIELDS = [
  'title',
  'caption',
  'date',
  'keywords',
  'copyright',
  'author',
  'place',
  'gps',
] as const;

/**
 * Read `<file>.xmp` (`abs` is the photo’s path) as the pipeline reads it: the
 * fields the admin edits that it sets. Undefined when the file does not
 * exist.
 */
export async function readPhotoOverrides(
  abs: string
): Promise<Record<string, unknown> | undefined> {
  const xml = await readText(sidecarPath(abs));
  if (xml === undefined) return undefined;
  const layer = xmpToLayer(xml);
  const out: Record<string, unknown> = {};
  for (const key of OVERRIDE_FIELDS)
    if (isSet(layer[key])) out[key] = layer[key];
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
  const relPath = ['photos', ...parts, file].join('/');

  const [bytes, album, xmp, overrides] = await Promise.all([
    readFile(abs),
    readAlbumFile(join(albumDir, '_album.md')),
    readText(`${absNoExt}.xmp`).then(
      async (t) => t ?? (await readText(`${absNoExt}.XMP`))
    ),
    readPhotoOverrides(abs),
  ]);
  const embedded = await readEmbedded(bytes);

  const map = album?.frontmatter.photos;
  const albumEntry: PhotoOverrides | undefined = map
    ? (map[file] ?? map[stripExtension(file)] ?? map[fileSlug(file)])
    : undefined;
  // `hidden` from the album entry is reported as an override: the admin
  // writes it there.
  const { hidden, ...albumFields } = albumEntry ?? {};
  const layers: Array<[Exclude<LayerName, 'sidecar'>, Layer]> = [
    [
      'album',
      albumEntry
        ? overridesToLayer(albumFields, `${parts.join('/')}/_album.md`)
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
    : (dateFallbacks.find(([, d]) => d)?.[0] ?? 'none');
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
    overrides: {
      ...overrides,
      ...(hidden !== undefined ? { hidden } : {}),
    },
    overridesFile: overrides ? `${relPath}.xmp` : null,
  };
}
