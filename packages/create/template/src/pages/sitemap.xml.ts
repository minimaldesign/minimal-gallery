// Every context page and photo page, for search engines. A sitemap needs
// the site’s address: without it the build writes none.
import type { APIRoute } from 'astro';
import { sitemap } from '@minimalgallery/astro/feeds';
import { siteOf } from '@minimalgallery/astro/gallery';

export const GET: APIRoute = async ({ site }) =>
  siteOf(site)
    ? new Response(await sitemap({ site }), {
        headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      })
    : new Response(null, { status: 404 });
