import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { AlbumFrontmatter, PhotoOverrides } from './schema.ts';
import type { Layer } from './layers.ts';
import { parseUserDate, toKeywords } from './normalize.ts';
import { xmpToLayer } from './xmp.ts';

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return undefined;
    throw e;
  }
}

/** Convert validated overrides (sidecar or album map entry) into a layer. */
export function overridesToLayer(o: PhotoOverrides, where: string): Layer {
  const layer: Layer = {};
  if (o.title !== undefined) layer.title = o.title;
  if (o.caption !== undefined) layer.caption = o.caption;
  if (o.date !== undefined) {
    const d = parseUserDate(o.date);
    if (!d)
      throw new Error(`${where}: cannot read date ${JSON.stringify(o.date)}`);
    layer.date = d;
  }
  if (o.keywords !== undefined) layer.keywords = toKeywords(o.keywords);
  if (o.copyright !== undefined) layer.copyright = o.copyright;
  if (o.author !== undefined) layer.author = o.author;
  if (o.hidden !== undefined) layer.hidden = o.hidden;
  if (o.camera !== undefined) layer.camera = o.camera;
  if (o.lens !== undefined) layer.lens = o.lens;
  if (o.place !== undefined) {
    const { city, state, country, location } = o.place;
    layer.place = {
      city: city ?? undefined,
      state: state ?? undefined,
      country: country ?? undefined,
      location: location ?? undefined,
    };
  }
  if (o.gps !== undefined) layer.gps = o.gps;
  return layer;
}

export interface PhotoSidecars {
  sidecar: Layer;
  xmpSidecar: Layer;
  /** Raw text of every sidecar read, for the inputs hash. */
  raw: string;
}

/**
 * Read `<name>.md`, `<name>.json` and `<name>.xmp` next to a photo. When both
 * `.md` and `.json` exist, `.md` wins field by field.
 */
export async function readPhotoSidecars(
  absNoExt: string,
  label: string
): Promise<PhotoSidecars> {
  const [md, json, xmp] = await Promise.all([
    readText(`${absNoExt}.md`),
    readText(`${absNoExt}.json`),
    readText(`${absNoExt}.xmp`).then(
      async (t) => t ?? (await readText(`${absNoExt}.XMP`))
    ),
  ]);
  let sidecar: Layer = {};
  if (json !== undefined) {
    const parsed = PhotoOverrides.safeParse(JSON.parse(json));
    if (!parsed.success)
      throw new Error(`${label}.json: ${parsed.error.message}`);
    sidecar = overridesToLayer(parsed.data, `${label}.json`);
  }
  if (md !== undefined) {
    const fm = matter(md);
    const parsed = PhotoOverrides.safeParse(fm.data);
    if (!parsed.success)
      throw new Error(`${label}.md: ${parsed.error.message}`);
    const layer = overridesToLayer(parsed.data, `${label}.md`);
    const body = fm.content.trim();
    if (body) layer.caption = body;
    sidecar = { ...sidecar, ...layer };
  }
  return {
    sidecar,
    xmpSidecar: xmp ? xmpToLayer(xmp) : {},
    raw: JSON.stringify([md ?? null, json ?? null, xmp ?? null]),
  };
}

export interface AlbumFile {
  frontmatter: AlbumFrontmatter;
  description: string | null;
}

export async function readAlbumFile(
  path: string
): Promise<AlbumFile | undefined> {
  const t = await readText(path);
  if (t === undefined) return undefined;
  const fm = matter(t);
  const parsed = AlbumFrontmatter.safeParse(fm.data);
  if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
  return { frontmatter: parsed.data, description: fm.content.trim() || null };
}
