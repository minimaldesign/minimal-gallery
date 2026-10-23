/**
 * Feeds and the sitemap, for a site's routes to serve (the demo's are in
 * `examples/demo/src/pages`): RSS 2.0 at `/feed.xml` and JSON Feed 1.1 at
 * `/feed.json` with the newest photos, each with its JPEG as the image and
 * the enclosure, and `/sitemap.xml` with every context page and photo page
 * (and the photo's image). They need absolute URLs: Astro's `site`, or
 * `site` in the config file. Like the helpers in `gallery.ts` they read the
 * collections, so they only work inside Astro.
 */
import config from 'virtual:minimalgallery/config';
import {
  absolute,
  captionText,
  getContexts,
  getPhotos,
  shareImageOf,
  siteOf,
  type Photo,
} from './gallery.ts';

export interface FeedOptions {
  /** Astro's `site` (the endpoint's `site`); the config file's otherwise. */
  site?: URL | string;
  /** How many photos, newest first. Default 50. */
  limit?: number;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? '&apos;'
  );

function requireSite(site?: URL | string) {
  const url = siteOf(site);
  if (!url)
    throw new Error(
      'minimalgallery: feeds and the sitemap need absolute URLs; set `site` in astro.config.mjs or minimalgallery.config.ts'
    );
  return url;
}

/**
 * Capture times are wall-clock, with no zone: they are given as UTC, which
 * keeps the date and the hour a reader shows.
 */
const utc = (p: Photo) => (p.date ? new Date(`${p.date}Z`) : null);

/** What both feeds say about one photo. */
async function items(site: URL, limit: number) {
  const albums = new Map(
    (await getContexts())
      .filter((c) => c.kind === 'album')
      .map((c) => [c.id, c.label])
  );
  return (await getPhotos()).slice(0, limit).map((p) => {
    const img = shareImageOf(p);
    const src = absolute(img.url, site);
    const html =
      `<p><img src="${esc(src)}" width="${img.width}" height="${img.height}" alt="${esc(p.title)}"></p>` +
      (p.captionHtml ?? '');
    return {
      photo: p,
      url: absolute(p.url, site),
      album: albums.get(p.album) ?? null,
      date: utc(p),
      summary: captionText(p),
      html,
      image: { ...img, src, type: `image/${img.format}` },
    };
  });
}

/** The RSS 2.0 feed (`/feed.xml`): serve it as `application/rss+xml`. */
export async function rssFeed({ site, limit = 50 }: FeedOptions = {}) {
  const url = requireSite(site);
  const home = absolute('/', url);
  const self = absolute('/feed.xml', url);
  const list = await items(url, limit);
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
    '<channel>',
    `<title>${esc(config.title)}</title>`,
    `<link>${esc(home)}</link>`,
    `<description>${esc(config.description)}</description>`,
    `<atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>`,
    `<generator>minimal gallery ${esc(config.version)}</generator>`,
  ];
  const newest = list.find((i) => i.date)?.date;
  if (newest) out.push(`<pubDate>${newest.toUTCString()}</pubDate>`);
  for (const i of list) {
    out.push(
      '<item>',
      `<title>${esc(i.photo.title)}</title>`,
      `<link>${esc(i.url)}</link>`,
      `<guid isPermaLink="true">${esc(i.url)}</guid>`
    );
    if (i.date) out.push(`<pubDate>${i.date.toUTCString()}</pubDate>`);
    if (i.album) out.push(`<category>${esc(i.album)}</category>`);
    out.push(
      `<description>${esc(i.html)}</description>`,
      `<enclosure url="${esc(i.image.src)}" length="${i.image.bytes}" type="${i.image.type}"/>`,
      `<media:content url="${esc(i.image.src)}" type="${i.image.type}" medium="image" width="${i.image.width}" height="${i.image.height}"/>`,
      '</item>'
    );
  }
  out.push('</channel>', '</rss>', '');
  return out.join('\n');
}

/** The JSON Feed 1.1 (`/feed.json`): serve it as `application/feed+json`. */
export async function jsonFeed({ site, limit = 50 }: FeedOptions = {}) {
  const url = requireSite(site);
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: config.title,
    home_page_url: absolute('/', url),
    feed_url: absolute('/feed.json', url),
    description: config.description,
    ...(config.author && { authors: [{ name: config.author }] }),
    language: 'en',
    items: (await items(url, limit)).map((i) => ({
      id: i.url,
      url: i.url,
      title: i.photo.title,
      content_html: i.html,
      ...(i.summary && { summary: i.summary }),
      image: i.image.src,
      ...(i.date && { date_published: i.date.toISOString() }),
      ...(i.photo.keywords.length && { tags: i.photo.keywords }),
    })),
  };
}

/**
 * The sitemap (`/sitemap.xml`): the home page, every album and facet page,
 * and every photo page with its image. Under 50,000 URLs, a single file.
 */
export async function sitemap({ site }: Pick<FeedOptions, 'site'> = {}) {
  const url = requireSite(site);
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ];
  for (const c of await getContexts())
    out.push(`<url><loc>${esc(new URL(c.href, url).href)}</loc></url>`);
  for (const p of await getPhotos())
    out.push(
      `<url><loc>${esc(absolute(p.url, url))}</loc><image:image><image:loc>${esc(absolute(shareImageOf(p).url, url))}</image:loc></image:image></url>`
    );
  out.push('</urlset>', '');
  return out.join('\n');
}

/** `robots.txt`: everything may be crawled; the sitemap's address. */
export function robotsTxt({ site }: Pick<FeedOptions, 'site'> = {}) {
  const url = siteOf(site);
  return [
    'User-agent: *',
    'Allow: /',
    ...(url ? [`Sitemap: ${absolute('/sitemap.xml', url)}`] : []),
    '',
  ].join('\n');
}
