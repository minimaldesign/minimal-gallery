// The RSS feed of the newest photos, linked from every page's head. A feed
// needs the gallery's public address: until `site` is set (in the admin's
// settings, minimalgallery.config.ts or astro.config.mjs), it is not built.
import type { APIRoute } from 'astro';
import { rssFeed } from '@minimalgallery/astro/feeds';
import { siteOf } from '@minimalgallery/astro/gallery';

export const GET: APIRoute = async ({ site }) =>
  siteOf(site)
    ? new Response(await rssFeed({ site }), {
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
      })
    : new Response(null, { status: 404 });
