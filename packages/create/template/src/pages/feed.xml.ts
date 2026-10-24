// The RSS feed of the newest photos, linked from every page’s head. Feeds
// need the site’s address (`site` in astro.config.mjs or
// minimalgallery.config.ts): without it the build writes no feed.
import type { APIRoute } from 'astro';
import { rssFeed } from '@minimalgallery/astro/feeds';
import { siteOf } from '@minimalgallery/astro/gallery';

export const GET: APIRoute = async ({ site }) =>
  siteOf(site)
    ? new Response(await rssFeed({ site }), {
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
      })
    : new Response(null, { status: 404 });
