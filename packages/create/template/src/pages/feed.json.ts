// The same feed as JSON Feed 1.1. Not built until `site` is set.
import type { APIRoute } from 'astro';
import { jsonFeed } from '@minimalgallery/astro/feeds';
import { siteOf } from '@minimalgallery/astro/gallery';

export const GET: APIRoute = async ({ site }) =>
  siteOf(site)
    ? new Response(JSON.stringify(await jsonFeed({ site })), {
        headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
      })
    : new Response(null, { status: 404 });
