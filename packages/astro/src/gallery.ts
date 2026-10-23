/**
 * Contexts and page helpers. A context is the whole archive, an album or a
 * facet value; every context page uses one template (the viewer on top, the
 * context's photos below), and a photo page shows its album unless `?in=`
 * names another context. These helpers read the `photos` and `albums`
 * collections, so they only work inside Astro (pages, components,
 * endpoints).
 */
import { getCollection } from 'astro:content';
import { createHash } from 'node:crypto';
import config from 'virtual:minimalgallery/config';
import { compareNewestFirst } from '@minimalgallery/pipeline/facets';
import {
  compareValues,
  FACETS,
  FACET_BY_KEY,
  MONTHS,
  RESERVED_SEGMENTS,
  type FacetKey,
  type FacetValue,
} from './data/facets.ts';
import type { AlbumEntryData, PhotoEntryData } from './loader.ts';

export type Photo = PhotoEntryData;
export type Album = AlbumEntryData;
export { FACETS, type FacetKey, type FacetValue };

export interface Context {
  /** `grid` (the archive), an album id, or `<facet route>/<value slug>`. */
  id: string;
  kind: 'archive' | 'album' | 'facet';
  facet?: FacetKey;
  /** Null for the archive, which has no middle crumb. */
  title: string | null;
  /** The title, or “All photos” for the archive. */
  label: string;
  /** The context page. */
  href: string;
  /** The context JSON read by the theme script for `?in=`. */
  json: string;
  photos: Photo[];
}

export interface PaletteGroup {
  heading: string;
  contexts: Context[];
}

interface Index {
  key: string;
  photos: Photo[];
  byId: Map<string, Photo>;
  albums: Album[];
  contexts: Context[];
  byContextId: Map<string, Context>;
  palette: PaletteGroup[];
  digests: Map<string, string>;
}

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** A site path with the configured base; a full URL (a bucket's) as it is. */
export const withBase = (path: string) =>
  /^[a-z][a-z\d+.-]*:/i.test(path) ? path : BASE + path.replace(/^\//, '');

/**
 * The site's public URL: Astro's `site`, else the config file's. Feeds,
 * the sitemap and social previews need it; pages only use it when set.
 */
export const siteOf = (site?: URL | string) =>
  site ? new URL(site) : config.site ? new URL(config.site) : undefined;

/** A site path (or a full URL) as an absolute URL. */
export const absolute = (path: string, site: URL) =>
  new URL(withBase(path), site).href;

export const ARCHIVE_ID = 'grid';

let cached: Index | undefined;

async function index(): Promise<Index> {
  const photoEntries = (await getCollection('photos' as never)) as Array<{
    data: Photo;
  }>;
  const albumEntries = (await getCollection('albums' as never)) as Array<{
    data: Album;
  }>;
  const key = hash(
    photoEntries.map((e) => e.data.digest).join(),
    albumEntries.map((e) => e.data.digest).join()
  );
  if (cached?.key === key) return cached;

  const albumsById = new Map(albumEntries.map((e) => [e.data.id, e.data]));
  const photos = photoEntries
    .map((e) => e.data)
    .filter((p) => !p.hidden && !albumsById.get(p.album)?.hidden)
    .sort((a, b) =>
      compareNewestFirst(
        { ...a, date: a.date ?? '' },
        { ...b, date: b.date ?? '' }
      )
    );
  const byId = new Map(photos.map((p) => [p.id, p]));
  const albums = [...albumsById.values()].filter(
    (a) => !a.hidden && a.photoIds.some((id) => byId.has(id))
  );

  const contexts: Context[] = [
    {
      id: ARCHIVE_ID,
      kind: 'archive',
      title: null,
      label: 'All photos',
      href: withBase('/'),
      json: withBase(`/${ARCHIVE_ID}.json`),
      photos,
    },
  ];
  // ALBUMS keep the pipeline's display order (chronological, like a roll)
  for (const a of albums) {
    const top = a.id.split('/')[0];
    if (RESERVED_SEGMENTS.has(top))
      throw new Error(
        `album “${a.id}” uses the reserved URL segment “${top}”; rename the folder`
      );
    contexts.push({
      id: a.id,
      kind: 'album',
      title: a.title,
      label: a.title,
      href: withBase(`/${a.id}/`),
      json: withBase(`/${a.id}.json`),
      photos: a.photoIds.map((id) => byId.get(id)).filter((p) => !!p),
    });
  }
  // FACETS: every value is a context, newest photos first
  const palette: PaletteGroup[] = [
    { heading: 'Albums', contexts: contexts.slice(1) },
  ];
  for (const def of FACETS) {
    const values = new Map<string, { value: FacetValue; photos: Photo[] }>();
    for (const p of photos)
      for (const v of p.facets[def.key] ?? []) {
        const b = values.get(v.slug) ?? { value: v, photos: [] };
        b.photos.push(p);
        values.set(v.slug, b);
      }
    const group = [...values.values()]
      .sort((a, b) => compareValues(def, a.value, b.value))
      .map(({ value, photos }): Context => ({
        id: `${def.route}/${value.slug}`,
        kind: 'facet',
        facet: def.key,
        title: value.label,
        label: value.label,
        href: withBase(`/${def.route}/${value.slug}/`),
        json: withBase(`/${def.route}/${value.slug}.json`),
        photos,
      }));
    contexts.push(...group);
    if (def.palette && group.length)
      palette.push({ heading: def.heading, contexts: group });
  }

  cached = {
    key,
    photos,
    byId,
    albums,
    contexts,
    byContextId: new Map(contexts.map((c) => [c.id, c])),
    palette,
    digests: new Map(),
  };
  return cached;
}

/** Visible photos, newest first (undated last). */
export async function getPhotos(): Promise<Photo[]> {
  return (await index()).photos;
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return (await index()).byId.get(id);
}

/** Visible albums with at least one visible photo. */
export async function getAlbums(): Promise<Album[]> {
  return (await index()).albums;
}

/** Every context: the archive, then albums, then facet values by facet. */
export async function getContexts(): Promise<Context[]> {
  return (await index()).contexts;
}

/** One context and its ordered photo list. */
export async function getContext(id: string): Promise<Context | undefined> {
  return (await index()).byContextId.get(id);
}

/** The palette's chip groups: albums, then each facet shown there. */
export async function getPalette(): Promise<PaletteGroup[]> {
  return (await index()).palette;
}

/** The photo's album as a context: the default context of its page. */
export async function albumContextOf(photo: Photo): Promise<Context> {
  const c = await getContext(photo.album);
  if (!c) throw new Error(`no album context for ${photo.id}`);
  return c;
}

/**
 * Previous and next photo inside a context. No wrapping: null past either
 * end, so the last photo has no next and the first no previous.
 */
export async function neighbors(contextId: string, photoId: string) {
  const ctx = await getContext(contextId);
  const list = ctx?.photos ?? [];
  const i = list.findIndex((p) => p.id === photoId);
  return {
    prev: i > 0 ? list[i - 1] : null,
    next: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
    index: i,
    count: list.length,
  };
}

/** A photo's page inside a context: albums need no `?in=`, they are the default. */
export const photoHref = (photo: Photo, ctx: Context) =>
  withBase(photo.url) +
  (ctx.kind === 'album' && ctx.id === photo.album ? '' : `?in=${ctx.id}`);

/** A context page, scrolled to its photos. */
export const contextHref = (ctx: Context) => `${ctx.href}#grid`;

/** A facet value's page, for links in the info pane and the list. */
export const facetHref = (key: FacetKey, slug: string) =>
  withBase(`/${FACET_BY_KEY.get(key)!.route}/${slug}/`);

/** The first value of a facet on a photo. */
export const facetOf = (p: Photo, key: FacetKey) => p.facets[key]?.[0];

// IMAGES from the derivative ladder

const avif = (p: Photo) =>
  p.variants
    .filter((v) => v.format === 'avif')
    .sort((a, b) => a.width - b.width);

/** The grid thumbnail: the `grid` variant, else the smallest image. */
export const thumbOf = (p: Photo) =>
  p.variants.find((v) => v.name === 'grid') ?? avif(p)[0] ?? p.variants[0];

/** The list's hover print (320px): the 1280 variant, else the largest up to it. */
export const previewOf = (p: Photo) =>
  p.variants.find((v) => v.name === 'w1280') ??
  [...p.variants]
    .filter((v) => v.width <= 1600)
    .sort((a, b) => b.width - a.width)[0] ??
  thumbOf(p);

/**
 * Every image of the photo as a srcset, smallest first, and the largest.
 * The JPEG joins as the widest candidate unless `jpeg` is false (the grid:
 * a 900px JPEG is no better a thumbnail than the AVIF, and with a single
 * candidate the srcset is left out, which keeps the grid's markup small).
 */
export function srcsetOf(
  p: Photo,
  maxWidth = Infinity,
  { jpeg: withJpeg = true } = {}
) {
  const list = avif(p).filter((v) => v.width <= maxWidth);
  const jpeg = p.variants.find((v) => v.format === 'jpeg');
  if (
    withJpeg &&
    jpeg &&
    jpeg.width > (list.at(-1)?.width ?? 0) &&
    jpeg.width <= maxWidth
  )
    list.push(jpeg);
  const largest = list.at(-1) ?? thumbOf(p);
  return {
    srcset:
      list.length > 1
        ? list.map((v) => `${withBase(v.url)} ${v.width}w`).join(', ')
        : '',
    src: withBase((jpeg ?? largest).url),
    largest,
  };
}

/**
 * The photo as a social preview and in feeds: the `jpeg1600` variant, else
 * the largest JPEG (link previews and feed readers rarely show AVIF), else
 * the largest image.
 */
export function shareImageOf(p: Photo) {
  const jpegs = p.variants
    .filter((v) => v.format === 'jpeg')
    .sort((a, b) => b.width - a.width);
  return (
    p.variants.find((v) => v.name === 'jpeg1600') ??
    jpegs[0] ??
    [...p.variants].sort((a, b) => b.width - a.width)[0]
  );
}

// TEXT shared by the static markup and the context JSON

export const ratioOf = (p: Photo) => +(p.width / p.height).toFixed(4);

/** `Jan 30, 2005`, or `Undated`. */
export function shortDate(p: Photo) {
  if (!p.date) return 'Undated';
  const m = MONTHS[+p.date.slice(5, 7) - 1].slice(0, 3);
  return `${m} ${+p.date.slice(8, 10)}, ${p.date.slice(0, 4)}`;
}

/**
 * The viewer image as the context JSON carries it, for an in-page step and
 * the neighbor preloads: srcset and src, the largest size, the zoom width.
 */
export function heroOf(p: Photo) {
  const { srcset, src, largest } = srcsetOf(p);
  return {
    src,
    srcset,
    w: largest.width,
    h: largest.height,
    // 1:1 of the largest derivative; one under 1600px (small sources) is
    // doubled so zoom still magnifies
    zoom: largest.width < 1600 ? largest.width * 2 : largest.width,
  };
}

const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (text: string, href?: string) =>
  href ? `<a href="${escHtml(href)}">${escHtml(text)}</a>` : escHtml(text);

export interface InfoRow {
  term: string;
  /** The value's markup: links to its contexts, spans for the rest. */
  html: string;
  exposure?: boolean;
}

/**
 * The info pane's rows for a photo, as markup. One source for the static
 * pane and the context JSON, so a step inside the page shows exactly what
 * the photo's own page shows.
 */
export function infoOf(p: Photo): InfoRow[] {
  const href = (key: FacetKey) => {
    const v = facetOf(p, key);
    return v ? `${facetHref(key, v.slug)}#grid` : undefined;
  };
  const rows: InfoRow[] = [];
  if (p.date) {
    const time = p.date.slice(11, 16);
    rows.push({
      term: 'Date',
      html:
        `<span>${link(MONTHS[+p.date.slice(5, 7) - 1], href('month'))} ` +
        `${link(String(+p.date.slice(8, 10)), href('day'))}, ` +
        `${link(p.date.slice(0, 4), href('year'))}</span>` +
        (time && time !== '00:00' ? `<span>${time}</span>` : ''),
    });
  }
  if (p.place)
    rows.push({
      term: 'Place',
      html:
        (p.placeDetail ? `<span>${escHtml(p.placeDetail)},</span>` : '') +
        link(p.place, href('place')),
    });
  if (p.camera)
    rows.push({ term: 'Camera', html: link(p.camera, href('camera')) });
  if (p.lens) rows.push({ term: 'Lens', html: link(p.lens, href('lens')) });
  const exposure: Array<[FacetKey, string | null]> = [
    ['shutter', p.shutter],
    ['aperture', p.aperture],
    ['focal', p.focal],
    ['iso', p.iso && `ISO ${p.iso}`],
  ];
  if (exposure.some(([, v]) => v))
    rows.push({
      term: 'Exposure',
      exposure: true,
      html: exposure
        .map(([key, text]) => (text ? link(text, href(key)) : ''))
        .join(''),
    });
  if (p.keywords.length)
    rows.push({
      term: 'Keywords',
      html: (p.facets.keyword ?? [])
        .map((k) => link(k.label, `${facetHref('keyword', k.slug)}#grid`))
        .join(''),
    });
  if (!p.camera && !p.date)
    rows.push({
      term: 'Capture',
      html: '<span class="info_empty">No camera data in this file</span>',
    });
  rows.push({ term: 'Size', html: `<span>${p.width} × ${p.height} px</span>` });
  rows.push({
    term: 'File',
    html: `<span class="info_path">${escHtml(p.source)}</span>`,
  });
  return rows;
}

/**
 * The caption as one line of plain text (markup and entities out), cut at
 * a word near `max` characters; null without a caption.
 */
export function captionText(p: Photo, max = 200) {
  const text = (p.captionHtml ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
      (m, dec?: string, hex?: string, name?: string) =>
        dec || hex
          ? String.fromCodePoint(dec ? +dec : parseInt(hex!, 16))
          : (ENTITIES[name!.toLowerCase()] ?? m)
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text || null;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The thumbnail tooltip's second line: date and place. */
export const tipOf = (p: Photo) =>
  [shortDate(p), p.place].filter(Boolean).join(' · ');

/** The rail and grid group a photo falls in. */
export const yearOf = (p: Photo) => p.date?.slice(0, 4) ?? 'undated';

export type Cell = Array<[string] | [string, string]>;

/**
 * The list's cells after the title: Date, Place, Camera, Lens, Shutter,
 * Aperture, Focal, ISO; each a list of [text, href] pairs (href absent for
 * plain text). Shared by the static list and the context JSON.
 */
export function cellsOf(p: Photo): Cell[] {
  const link = (key: FacetKey, text: string | null): Cell => {
    const v = facetOf(p, key);
    return text && v ? [[text, facetHref(key, v.slug)]] : text ? [[text]] : [];
  };
  const day = facetOf(p, 'day');
  const year = facetOf(p, 'year');
  return [
    p.date && day && year
      ? [
          [`${shortDate(p).split(',')[0]},`, facetHref('day', day.slug)],
          [year.label, facetHref('year', year.slug)],
        ]
      : [['Undated']],
    link('place', p.place),
    link('camera', p.camera),
    link('lens', p.lens),
    link('shutter', p.shutter),
    link('aperture', p.aperture),
    link('focal', p.focal),
    link('iso', p.iso),
  ];
}

export const SORT_COLUMNS: Array<[string, 'text' | 'num']> = [
  ['Title', 'text'],
  ['Date', 'text'],
  ['Place', 'text'],
  ['Camera', 'text'],
  ['Lens', 'text'],
  ['Shutter', 'num'],
  ['Aperture', 'num'],
  ['Focal', 'num'],
  ['ISO', 'num'],
];

/**
 * The context JSON (`<context>.json`) the theme script reads for `?in=`:
 * the context title (null for the archive), its page, and per photo what
 * the strip, the grid, the list and the rail need, and everything the
 * viewer shows, so a step happens inside the page: the hero image, its
 * size, color and zoom width, the title, the caption and the info rows.
 */
export function contextJson(ctx: Context) {
  return {
    title: ctx.title,
    href: ctx.href,
    photos: ctx.photos.map((p) => ({
      slug: p.slug,
      href: withBase(p.url),
      thumb: withBase(thumbOf(p).url),
      preview: withBase(previewOf(p).url),
      ...heroOf(p),
      title: p.title,
      info: infoOf(p),
      caption: p.captionHtml,
      ar: ratioOf(p),
      color: p.color,
      year: yearOf(p),
      tip: tipOf(p),
      cells: cellsOf(p),
      sort: p.sortKeys,
    })),
  };
}

// INCREMENTAL BUILDS

/** A short stable hash of strings. */
export function hash(...parts: Array<string | number | null | undefined>) {
  return createHash('sha1')
    .update(parts.map((p) => String(p ?? '')).join('\u0000'))
    .digest('base64url')
    .slice(0, 16);
}

/** Digest of everything a context contributes to a page (its JSON). */
export async function contextDigest(ctx: Context): Promise<string> {
  const idx = await index();
  let d = idx.digests.get(ctx.id);
  if (!d) {
    d = hash(JSON.stringify(contextJson(ctx)));
    idx.digests.set(ctx.id, d);
  }
  return d;
}

/** Digest of the palette (every chip and count), shown on every page. */
export async function paletteDigest(): Promise<string> {
  const idx = await index();
  let d = idx.digests.get('\0palette');
  if (!d) {
    d = hash(
      JSON.stringify(
        idx.palette.map((g) => [
          g.heading,
          g.contexts.map((c) => [c.id, c.label, c.photos.length]),
        ])
      )
    );
    idx.digests.set('\0palette', d);
  }
  return d;
}

/**
 * A page's incremental-build cacheKey: the photo it shows, the context
 * whose photos it lists, the palette and the gallery config. A page whose
 * key and code are unchanged is not rendered again.
 */
export async function pageCacheKey(photo: Photo, ctx: Context) {
  return hash(
    photo.digest,
    await contextDigest(ctx),
    await paletteDigest(),
    JSON.stringify(config)
  );
}

/** Legacy v0.8 links (`/?id=colors__red_door`): photo id to page URL. */
export async function legacyIds(): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await getPhotos()).map((p) => [p.id, withBase(p.url)])
  );
}
